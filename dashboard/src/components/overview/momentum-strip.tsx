import type { MomentumData } from '@/lib/data/momentum';

interface MomentumStripProps {
  data: MomentumData | null;
}

export function MomentumStrip({ data }: MomentumStripProps) {
  if (!data) return null;

  const { streak, win_bank, study_hours } = data;
  const streakNum = streak?.current_streak ?? 0;
  const winsTotal = win_bank?.total_wins ?? 0;
  const top = win_bank?.top_recent?.[0];

  const weekHours = study_hours?.week_hours ?? 0;
  const weekTarget = study_hours?.week_target ?? 10;
  const weekPct = study_hours?.week_pct ?? 0;
  const todayHours = study_hours?.today_hours ?? 0;
  const zeroDays = study_hours?.zero_days_this_week ?? 0;
  const studyStreakDays = study_hours?.streak_days ?? 0;

  // Color the study hours card based on pace
  const paceColor = weekPct >= 80 ? 'text-green-600' : weekPct >= 40 ? 'text-yellow-600' : 'text-destructive';

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      <div className="rounded-lg border bg-card p-4">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Engagement Streak
        </p>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="text-3xl font-bold tabular-nums">{streakNum}</span>
          <span className="text-2xl">🔥</span>
          <span className="text-xs text-muted-foreground ml-auto self-center">
            longest {streak?.longest_streak ?? 0}
          </span>
        </div>
        {streak?.last_engagement_date && (
          <p className="mt-1 text-xs text-muted-foreground">
            last engagement {streak.last_engagement_date}
          </p>
        )}
      </div>

      <div className="rounded-lg border bg-card p-4">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Fleet Wins (7d)
        </p>
        <div className="mt-1 flex items-baseline gap-2">
          <span className="text-3xl font-bold tabular-nums">{winsTotal}</span>
          <span className="text-sm text-muted-foreground">shipped</span>
        </div>
        {top && (
          <p className="mt-1 text-xs text-muted-foreground truncate">
            latest: {top.agent} → {top.title}
          </p>
        )}
      </div>

      {study_hours && (
        <div className="rounded-lg border bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Study Hours (10h target)
          </p>
          <div className="mt-1 flex items-baseline gap-2">
            <span className={`text-3xl font-bold tabular-nums ${paceColor}`}>
              {weekHours.toFixed(1)}h
            </span>
            <span className="text-xs text-muted-foreground">/ {weekTarget}h</span>
          </div>
          <div className="mt-2 h-1.5 w-full rounded-full bg-muted">
            <div
              className={`h-1.5 rounded-full ${weekPct >= 80 ? 'bg-green-500' : weekPct >= 40 ? 'bg-yellow-500' : 'bg-destructive'}`}
              style={{ width: `${Math.min(weekPct, 100)}%` }}
            />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {todayHours > 0 ? `${todayHours.toFixed(1)}h today` : 'no study today'}
            {zeroDays > 0 ? ` · ${zeroDays} zero-day${zeroDays !== 1 ? 's' : ''} this week` : ''}
            {studyStreakDays > 0 ? ` · ${studyStreakDays}d study streak` : ''}
          </p>
        </div>
      )}
    </div>
  );
}
