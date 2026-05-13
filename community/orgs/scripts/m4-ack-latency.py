#!/usr/bin/env python3
"""M4 ACK-latency parser — cross-org shared.

Version: 0.1
Originating org: foreverdell (raccoon / Randy)
Council location: community/orgs/scripts/ per Maat sync #001 2026-05-11
History:
  0.1  2026-05-11  Initial. Two ACK paths (inbox_ack event + reply_to field on
                   agent_message_sent). Promoted from foreverdell-local to
                   community/orgs/scripts/ for cross-org reuse.

Pairs incoming agent_message_sent events (where to=<target>) with the target's
ACK record for the same msg_id. ACK can come via either:
  - explicit `inbox_ack` event
  - `agent_message_sent` event from the target with `reply_to` == sent.msg_id

Latency = ack.timestamp - sent.timestamp.

Usage:
  m4-ack-latency.py                       # turtle, today, foreverdell
  m4-ack-latency.py --target raccoon      # different target
  m4-ack-latency.py --date 2026-05-10
  m4-ack-latency.py --org actuary-mon
  m4-ack-latency.py --window 24h          # rolling 24h ending now (UTC)
"""

import argparse
import glob
import json
import os
import statistics
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

EVENTS_ROOT = Path.home() / ".cortextos" / "default" / "orgs"


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--target", default="turtle", help="Agent whose ACK latency we measure")
    p.add_argument("--org", default="foreverdell")
    p.add_argument("--date", default=None, help="UTC date YYYY-MM-DD (overrides --window)")
    p.add_argument("--window", default=None, help="Rolling window ending now, e.g. 24h, 6h, 7d")
    p.add_argument("--json", action="store_true", help="Emit JSON for downstream tooling")
    return p.parse_args()


def parse_window(w):
    n, unit = int(w[:-1]), w[-1]
    return {"h": timedelta(hours=n), "d": timedelta(days=n)}[unit]


def load_events(org, agents, dates):
    events = []
    for agent in agents:
        for d in dates:
            f = EVENTS_ROOT / org / "analytics" / "events" / agent / f"{d}.jsonl"
            if not f.exists():
                continue
            with open(f) as fp:
                for line in fp:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        events.append(json.loads(line))
                    except json.JSONDecodeError:
                        pass
    return events


def discover_agents(org):
    base = EVENTS_ROOT / org / "analytics" / "events"
    return [p.name for p in base.iterdir() if p.is_dir()] if base.exists() else []


def main():
    args = parse_args()

    if args.date:
        dates = [args.date]
        cutoff = None
    elif args.window:
        delta = parse_window(args.window)
        now = datetime.now(timezone.utc)
        cutoff = now - delta
        dates = sorted({(now - timedelta(days=i)).strftime("%Y-%m-%d")
                        for i in range(delta.days + 2)})
    else:
        dates = [datetime.now(timezone.utc).strftime("%Y-%m-%d")]
        cutoff = None

    agents = discover_agents(args.org)
    if not agents:
        print(f"No event dirs found for org={args.org}", file=sys.stderr)
        sys.exit(1)

    events = load_events(args.org, agents, dates)

    sent_to_target = {}
    for e in events:
        if e.get("event") == "agent_message_sent" and e.get("metadata", {}).get("to") == args.target:
            msg_id = e["metadata"].get("msg_id")
            if msg_id:
                sent_to_target[msg_id] = e

    acks_by_target = {}
    for e in events:
        if e.get("agent") != args.target:
            continue
        if e.get("event") == "inbox_ack":
            msg_id = e["metadata"].get("msg_id")
            if msg_id and msg_id not in acks_by_target:
                acks_by_target[msg_id] = {"event": e, "via": "inbox_ack"}
        elif e.get("event") == "agent_message_sent":
            reply_to = e["metadata"].get("reply_to")
            if reply_to and reply_to not in acks_by_target:
                acks_by_target[reply_to] = {"event": e, "via": "reply_to"}

    pairs = []
    via_counts = {"inbox_ack": 0, "reply_to": 0}
    for msg_id, sent in sent_to_target.items():
        ack_record = acks_by_target.get(msg_id)
        if not ack_record:
            continue
        ack = ack_record["event"]
        sent_ts = datetime.fromisoformat(sent["timestamp"].replace("Z", "+00:00"))
        ack_ts = datetime.fromisoformat(ack["timestamp"].replace("Z", "+00:00"))
        if cutoff and sent_ts < cutoff:
            continue
        latency_s = (ack_ts - sent_ts).total_seconds()
        via_counts[ack_record["via"]] += 1
        pairs.append({
            "msg_id": msg_id,
            "from": sent["agent"],
            "sent_at": sent["timestamp"],
            "ack_at": ack["timestamp"],
            "latency_s": latency_s,
            "via": ack_record["via"],
        })

    unacked = [m for m in sent_to_target if m not in acks_by_target]

    if not pairs:
        result = {
            "target": args.target,
            "scope": args.date or args.window or "today",
            "msgs_received": len(sent_to_target),
            "msgs_acked": 0,
            "unacked": len(unacked),
            "note": "no ACK pairs in window",
        }
    else:
        latencies = sorted(p["latency_s"] for p in pairs)
        result = {
            "target": args.target,
            "scope": args.date or args.window or "today",
            "msgs_received": len(sent_to_target),
            "msgs_acked": len(pairs),
            "ack_rate": round(len(pairs) / len(sent_to_target), 3),
            "unacked": len(unacked),
            "ack_via_inbox_ack": via_counts["inbox_ack"],
            "ack_via_reply_to": via_counts["reply_to"],
            "latency_s_min": round(latencies[0], 1),
            "latency_s_p50": round(statistics.median(latencies), 1),
            "latency_s_p90": round(latencies[int(0.9 * (len(latencies) - 1))], 1),
            "latency_s_max": round(latencies[-1], 1),
            "latency_s_mean": round(statistics.mean(latencies), 1),
        }

    if args.json:
        print(json.dumps(result, indent=2))
    else:
        print(f"M4 ACK-latency — target={result['target']} scope={result['scope']}")
        print(f"  msgs received: {result['msgs_received']}")
        print(f"  msgs ACKed:    {result['msgs_acked']}  (rate {result.get('ack_rate', 'n/a')})")
        if "ack_via_inbox_ack" in result:
            print(f"    via inbox_ack: {result['ack_via_inbox_ack']}  via reply_to: {result['ack_via_reply_to']}")
        print(f"  unACKed:       {result['unacked']}")
        if "latency_s_p50" in result:
            print(f"  latency (s):   min {result['latency_s_min']}  p50 {result['latency_s_p50']}  p90 {result['latency_s_p90']}  max {result['latency_s_max']}")
            print(f"  latency mean:  {result['latency_s_mean']}s")
        else:
            print(f"  note: {result['note']}")


if __name__ == "__main__":
    main()
