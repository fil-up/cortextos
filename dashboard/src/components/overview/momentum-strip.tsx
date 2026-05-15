import type { MomentumData } from '@/lib/data/momentum';

interface MomentumStripProps {
  data: MomentumData | null;
}

export function MomentumStrip({ data }: MomentumStripProps) {
  if (!data) return null;

  const { streak, win_bank, study_hours, study_progress } = data;
  const streakNum = streak?.current_streak ?? 0;
  const winsTotal = win_bank?.total_wins ?? 0;
  const top = win_bank?.top_recent?.[0];

  const weekHours = study_hours?.week_hours ?? 0;
  const weekTarget = study_hours?.week_target ?? 10;
  const weekPct = study_hours?.week_pct ?? 0;
  const todayHours = study_hours?.today_hours ?? 0;
  const zeroDays = study_hours?.zero_days_this_week ?? 0;
  const studyStreakDays = study_hours?.streak_days ?? 0;

  const paceColor = weekPct >= 80 ? 'text-green-600' : weekPct >= 40 ? 'text-yellow-600' : 'text-destructive';

  const currentWeek = study_progress?.current_week ?? 0;
  const totalHours = study_progress?.total_hours_logged ?? 0;
  const phase = study_progress?.phase ?? 'content';
  const examProgressPct = Math.min((totalHours / 150) * 100, 100);
  const currentTopic = study_progress?.by_topic
    ? Object.entries(study_progress.by_topic).find(([, t]) => t.status === 'in_progress')?.[1]?.label
      ?? Object.entries(study_progress.by_topic).find(([, t]) => t.status === 'not_started')?.[1]?.label
    : null;

  const cols = study_progress ? 'md:grid-cols-4' : study_hours ? 'md:grid-cols-3' : 'md:grid-cols-2';

  return (
    <div className={`grid grid-cols-1 ${cols} gap-3`}>
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

      {study_progress && (
        <div className="rounded-lg border bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            GH 301 Progress
          </p>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-3xl font-bold tabular-nums">W{currentWeek}</span>
            <span className="text-xs text-muted-foreground">/ 11</span>
            <span className={`ml-auto text-xs font-medium px-1.5 py-0.5 rounded self-center ${phase === 'practice' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'}`}>
              {phase}
            </span>
          </div>
          <div className="mt-2 h-1.5 w-full rounded-full bg-muted">
            <div
              className="h-1.5 rounded-full bg-primary"
              style={{ width: `${examProgressPct}%` }}
            />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {totalHours.toFixed(1)}h / 150h
            {currentTopic ? ` · ${currentTopic}` : ''}
          </p>
        </div>
      )}
    </div>
  );
}
