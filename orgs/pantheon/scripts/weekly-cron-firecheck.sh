#!/usr/bin/env bash
# weekly-cron-firecheck.sh — universal F19 guard for ALL cron cadences.
# (Filename kept for path stability; now covers sub-daily through monthly.)
#
# Run on session start. Detects crons that were SILENTLY DROPPED while the
# agent was down (F19: a cron firing into a dead PTY vanishes with no trace).
#
# Rule: flag when now - last_fired_at > 2 × that cron's own interval.
#   2x = 1 interval of grace for scheduler jitter + boot lag, then flags on
#   the second missed fire. Generalises daily/weekly/monthly/4h/30m/etc.
#   without enumerating cadences.
#
# NOTE: last_fired_at is DISPATCH time, not proof of execution.
#   The scheduler wrote that timestamp; whether the agent actually ran the
#   prompt is a separate question.
#
# Orphan check: flag when heartbeat is fresh (<20min) but pm2 status is not
#   "online" — the session is alive but the daemon scheduler can't reach it,
#   so all dispatches silently drop (hard-restart orphan pattern).
#
# Schedule patterns recognised:
#   Interval strings: 30m, 4h, 7d, etc.
#   */N * * * *           → every N minutes
#   A,B * * * * (uniform) → every (B-A) minutes
#   M */N * * *           → every N hours
#   M * * * *             → every 1 hour
#   M H * * *             → daily
#   M H * * DOW           → weekly
#   M H DOM * *           → monthly
#   Range patterns (8-20) and complex hour-lists are skipped — ambiguous period.
#
# Usage: bash weekly-cron-firecheck.sh <agent-name>
# Interim until F19 (cron catch-up) ships. Author: inari. Rev 3 (sub-daily) 2026-08-05.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

AGENT="${1:-$CTX_AGENT_NAME}"
CRONS_DIR="${CTX_ROOT:-$HOME/.cortextos/default}/.cortextOS/state/agents"
CRONS="$CRONS_DIR/$AGENT/crons.json"
# heartbeat lives in a different subtree than crons.json
HEARTBEAT="${CTX_ROOT:-$HOME/.cortextos/default}/state/$AGENT/heartbeat.json"

[ -f "$CRONS" ] || { echo "F19 GUARD: no crons.json for $AGENT"; exit 0; }

# Agents are Claude sessions spawned by the daemon, never pm2 apps.
# cortextos status is the authoritative running-state source.
# Distinguish CLI failure from a genuinely absent agent: if the CLI fails
# or returns no status rows at all, skip the orphan check (cli-unavailable)
# rather than treating every agent as absent. Empty listing != absent agent
# (brew llhttp outage kills CLI while daemon + agents stay up — without this
# guard, all agents with fresh heartbeats would flood false ORPHAN alerts).
_STATUS_OUT=$(cortextos status 2>/dev/null)
_STATUS_EXIT=$?
if [ $_STATUS_EXIT -ne 0 ] || ! echo "$_STATUS_OUT" | grep -qE 'running|stopped'; then
    RUNNING_STATUS="cli-unavailable"
else
    RUNNING_STATUS=$(echo "$_STATUS_OUT" | awk -v a="$AGENT" '$1==a{print $2}')
    [ -z "$RUNNING_STATUS" ] && RUNNING_STATUS="unknown"
fi
unset _STATUS_OUT _STATUS_EXIT

python3 - "$CRONS" "$HEARTBEAT" "$RUNNING_STATUS" "$AGENT" << 'PYEOF'
import sys, json, re
from datetime import datetime, timezone, timedelta


def parse_interval(sched):
    """Return (timedelta, label) or (None, None) if pattern is unrecognised.
    Skips range patterns (8-20 in hour field) — interval is ambiguous.
    ponytail: only deterministic periods; conservative over aggressive.
    """
    sched = sched.strip()

    # Interval strings: 30m, 4h, 1d, 7d
    m = re.fullmatch(r'(\d+)(m|h|d)', sched)
    if m:
        n, u = int(m.group(1)), m.group(2)
        return {'m': timedelta(minutes=n), 'h': timedelta(hours=n), 'd': timedelta(days=n)}[u], sched

    parts = sched.split()
    if len(parts) != 5:
        return None, None
    minute, hour, dom, month, dow = parts

    # Skip range fields — period is ambiguous (e.g. "8-20" fires hourly within a window)
    if '-' in minute or '-' in hour:
        return None, None

    # Weekly: specific DOW, no DOM restriction, simple value (not comma-list)
    if dow != '*' and dom == '*' and ',' not in dow:
        return timedelta(days=7), 'weekly'

    # Monthly: specific DOM, no DOW restriction
    if dom != '*' and dow == '*' and re.fullmatch(r'\d+', dom):
        return timedelta(days=31), 'monthly'

    # Skip constrained month/dom beyond simple cases
    if dom != '*' or month != '*':
        return None, None

    # From here: dom='*', month='*', dow='*' (sub-daily + daily patterns)

    # Every-N-minutes: */N * * * *
    if re.fullmatch(r'\*/(\d+)', minute) and hour == '*':
        n = int(minute[2:])
        return timedelta(minutes=n), f'{n}m'

    # Uniform multi-minute: "7,37 * * * *" → 30m interval
    if ',' in minute and hour == '*':
        nums = minute.split(',')
        if all(re.fullmatch(r'\d+', x) for x in nums):
            vals = sorted(int(x) for x in nums)
            gaps = [vals[i+1]-vals[i] for i in range(len(vals)-1)]
            if len(set(gaps)) == 1:
                return timedelta(minutes=gaps[0]), f'{gaps[0]}m'

    # Every-N-hours: M */N * * * (heartbeat pattern: "30 */4 * * *")
    if re.fullmatch(r'\*/(\d+)', hour) and dow == '*':
        n = int(hour[2:])
        return timedelta(hours=n), f'{n}h'

    # Hourly at fixed minute: M * * * *
    if hour == '*' and re.fullmatch(r'\d+', minute) and dow == '*':
        return timedelta(hours=1), '1h'

    # Daily: specific minute + specific hour
    if re.fullmatch(r'\d+', minute) and re.fullmatch(r'\d+', hour) and dow == '*':
        return timedelta(days=1), 'daily'

    return None, None


crons_path, hb_path, running_status, agent_name = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
crons = json.load(open(crons_path)).get("crons", [])
now = datetime.now(timezone.utc)
missed = []
skipped_names = []

for c in crons:
    if not c.get("enabled", True):
        continue
    sched = c.get("schedule", "")
    interval, label = parse_interval(sched)
    if interval is None:
        skipped_names.append(f"{c['name']} ({sched!r})")
        continue

    # 2x-interval threshold: 1 full interval grace + 1 interval before flag
    threshold = 2 * interval

    lf = c.get("last_fired_at") or c.get("last_fire") or c.get("lastFire")
    if not lf:
        created = c.get("created_at")
        if created:
            try:
                cdt = datetime.fromisoformat(created.replace("Z", "+00:00"))
                if now - cdt > threshold:
                    missed.append((c["name"], sched, label, "never dispatched (created >2 intervals ago)"))
            except Exception:
                pass
        continue

    try:
        last = datetime.fromisoformat(lf.replace("Z", "+00:00"))
    except Exception:
        continue

    # NOTE: last_fired_at = dispatch timestamp, not proof of execution.
    behind = now - last
    if behind > threshold:
        t_secs = threshold.total_seconds()
        b_secs = behind.total_seconds()
        threshold_str = (f"{int(t_secs//3600)}h" if t_secs >= 3600
                         else f"{int(t_secs//60)}m")
        behind_h = int(b_secs // 3600)
        behind_m = int((b_secs % 3600) // 60)
        behind_str = f"{behind_h}h{behind_m:02d}m" if behind_h else f"{behind_m}m"
        missed.append((c["name"], sched, label,
                       f"last dispatched {behind_str} ago (threshold {threshold_str})"))

# Registry-orphan check: fresh heartbeat + not in daemon registry = crons dispatch to /dev/null.
# Agents are Claude sessions — running_status comes from `cortextos status`, not pm2.
orphan_msg = None
try:
    hb = json.load(open(hb_path))
    hb_ts = datetime.fromisoformat(hb["last_heartbeat"].replace("Z", "+00:00"))
    hb_age = (now - hb_ts).total_seconds()
    # cli-unavailable = cortextos status failed or returned no rows (CLI outage,
    # not agent absence). Skip rather than false-flag every running agent.
    if running_status not in ("running", "cli-unavailable") and hb_age < 1200:
        age_m = int(hb_age // 60)
        orphan_msg = (f"ORPHAN: {agent_name} heartbeat {age_m}m old but "
                      f"daemon status={running_status!r} — session untracked, "
                      f"cron dispatches silently drop")
except FileNotFoundError:
    pass  # no heartbeat file — can't determine orphan state
except Exception as e:
    sys.stderr.write(f"orphan-check error: {e}\n")

if missed:
    print(f"F19 GUARD [{agent_name}]: {len(missed)} cron(s) dropped — re-run manually:")
    for name, sched, label, why in missed:
        print(f"  [{label}] {name} ({sched}): {why}")
    print(f"  (last_fired_at = dispatch time, not execution proof)")
else:
    checked = sum(1 for c in crons
                  if c.get("enabled", True) and parse_interval(c.get("schedule",""))[0] is not None)
    print(f"F19 GUARD [{agent_name}]: {checked} crons OK.")

if skipped_names:
    print(f"  skipped {len(skipped_names)} unrecognised patterns: {', '.join(skipped_names)}")

if orphan_msg:
    print(orphan_msg)
PYEOF
