#!/usr/bin/env python3
"""M3 Heartbeat Freshness — cross-org shared.

Version: 0.1
Originating org: foreverdell (raccoon / Randy)
Council location: community/orgs/scripts/ per Maat sync #001 2026-05-11
History:
  0.1  2026-05-12  Initial. Local-time straddle fix vs first-pass inline analysis
                   from foreverdell metrics-2026-05-11.md, which gave false-
                   positive stale flags because the ops window 13:00-06:00 UTC
                   straddles midnight and a naive per-UTC-day bin filter created
                   a 13-14h pseudo-gap. This implementation converts each
                   timestamp to local PT, filters on local 06:00-23:00 hours,
                   and computes gaps on the contiguous local-time series.

For each critter:
  - Read heartbeat events from analytics/events/<critter>/<date>.jsonl
  - Convert each timestamp to the configured local tz (default America/Los_Angeles)
  - Keep only events inside local ops window (default 06:00 .. 23:00)
  - Compute gap between consecutive heartbeats
  - Flag STALE if any gap > threshold (default 5h)

Usage:
  m3-heartbeat-freshness.py                          # foreverdell, today, all critters
  m3-heartbeat-freshness.py --org pantheon
  m3-heartbeat-freshness.py --date 2026-05-11
  m3-heartbeat-freshness.py --critter beaver
  m3-heartbeat-freshness.py --threshold-hours 5
  m3-heartbeat-freshness.py --ops-start 6 --ops-end 23
  m3-heartbeat-freshness.py --tz America/Los_Angeles
  m3-heartbeat-freshness.py --json
"""

import argparse
import glob
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo


def find_events_dir(org):
    base = os.environ.get("CTX_ROOT", os.path.expanduser("~/.cortextos/default"))
    candidate = Path(base) / "orgs" / org / "analytics" / "events"
    if candidate.is_dir():
        return candidate
    # Some instances may use a different layout — fall back to a glob.
    matches = list(Path(base).glob(f"**/orgs/{org}/analytics/events"))
    return matches[0] if matches else None


def load_heartbeats(events_dir, critter, date_str):
    path = events_dir / critter / f"{date_str}.jsonl"
    if not path.exists():
        return []
    out = []
    with open(path) as f:
        for line in f:
            try:
                e = json.loads(line)
            except json.JSONDecodeError:
                continue
            if e.get("category") != "heartbeat":
                continue
            ts = e.get("timestamp")
            if not ts:
                continue
            t = datetime.fromisoformat(ts.replace("Z", "+00:00"))
            out.append(t)
    out.sort()
    return out


def bucket_by_local_ops_day(timestamps, tz, ops_start_h, ops_end_h):
    """Group timestamps into local-ops-day buckets.

    Each timestamp is converted to the local tz. The ops window is interpreted
    in local time as [ops_start_h, ops_end_h) on the local calendar date.
    Timestamps outside the local ops window are dropped (they're night-mode
    pause time, which is not part of M3's measurement intent).

    Gaps that span the night-mode pause (e.g. 22:59 PT → 06:00 PT next day)
    are NOT computed across the boundary — they would conflate legitimate
    sleep time with in-ops staleness. The previous v0 inline implementation
    had this exact bug: it filtered hours in UTC then computed gaps on the
    discontiguous series, producing 13-14h pseudo-gaps every night.

    Returns dict[local_date_str] -> list of timestamps within that local
    ops-day window, sorted.
    """
    buckets = {}
    for t in timestamps:
        local = t.astimezone(tz)
        if ops_start_h <= local.hour < ops_end_h:
            key = local.date().isoformat()
            buckets.setdefault(key, []).append(t)
    for key in buckets:
        buckets[key].sort()
    return buckets


def gaps_seconds(timestamps):
    return [
        (timestamps[i + 1] - timestamps[i]).total_seconds()
        for i in range(len(timestamps) - 1)
    ]


def summarize_critter(critter, buckets, threshold_s):
    """Compute max in-ops-day gap across all buckets."""
    total = sum(len(v) for v in buckets.values())
    if total < 2 or not any(len(v) >= 2 for v in buckets.values()):
        return {
            "critter": critter,
            "heartbeats_in_window": total,
            "ops_days_observed": len(buckets),
            "max_gap_s": None,
            "max_gap_h": None,
            "stale": None,
            "note": "insufficient data (need ≥2 heartbeats in a single ops-day)",
        }
    worst_gap_s = 0.0
    worst_day = None
    for day, ts in buckets.items():
        if len(ts) < 2:
            continue
        for g in gaps_seconds(ts):
            if g > worst_gap_s:
                worst_gap_s = g
                worst_day = day
    return {
        "critter": critter,
        "heartbeats_in_window": total,
        "ops_days_observed": len(buckets),
        "max_gap_s": worst_gap_s,
        "max_gap_h": round(worst_gap_s / 3600, 2),
        "worst_day": worst_day,
        "stale": worst_gap_s > threshold_s,
        "note": "OK" if worst_gap_s <= threshold_s else f"STALE (gap {worst_gap_s/3600:.1f}h > {threshold_s/3600:.0f}h on {worst_day})",
    }


def discover_critters(events_dir):
    if not events_dir or not events_dir.is_dir():
        return []
    return sorted(p.name for p in events_dir.iterdir() if p.is_dir())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--org", default="foreverdell")
    ap.add_argument("--date", default=None, help="YYYY-MM-DD (UTC); default today")
    ap.add_argument("--critter", default=None, help="single critter; omit for all")
    ap.add_argument("--threshold-hours", type=float, default=5.0)
    ap.add_argument("--ops-start", type=int, default=6, help="local hour, inclusive (default 6)")
    ap.add_argument("--ops-end", type=int, default=23, help="local hour, exclusive (default 23)")
    ap.add_argument("--tz", default="America/Los_Angeles")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    date_str = args.date or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    tz = ZoneInfo(args.tz)
    threshold_s = args.threshold_hours * 3600
    events_dir = find_events_dir(args.org)

    if events_dir is None:
        print(f"M3: no events dir found for org={args.org}", file=sys.stderr)
        return 1

    critters = [args.critter] if args.critter else discover_critters(events_dir)
    if not critters:
        print(f"M3: no critters found under {events_dir}", file=sys.stderr)
        return 1

    rows = []
    for c in critters:
        hb = load_heartbeats(events_dir, c, date_str)
        buckets = bucket_by_local_ops_day(hb, tz, args.ops_start, args.ops_end)
        rows.append(summarize_critter(c, buckets, threshold_s))

    if args.json:
        print(json.dumps({
            "org": args.org,
            "date": date_str,
            "tz": args.tz,
            "ops_window_local": f"{args.ops_start:02d}:00-{args.ops_end:02d}:00",
            "threshold_hours": args.threshold_hours,
            "results": rows,
        }, indent=2))
        return 0

    print(f"M3 heartbeat freshness — org={args.org} date={date_str} window={args.ops_start:02d}-{args.ops_end:02d} {args.tz} threshold={args.threshold_hours}h")
    print(f"{'critter':<12} {'in_window':>10} {'max_gap_h':>10}  {'state':<10}")
    print("-" * 50)
    any_stale = False
    for r in rows:
        gap = "—" if r["max_gap_h"] is None else f"{r['max_gap_h']:.2f}"
        state = "OK" if r["stale"] is False else ("STALE" if r["stale"] else "?")
        if r["stale"]:
            any_stale = True
        print(f"  {r['critter']:<10} {r['heartbeats_in_window']:>10} {gap:>10}  {state:<10}  {r['note']}")
    if any_stale:
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
