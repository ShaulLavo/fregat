import type { LogDashboardSummary } from '@workspace/contracts'
import { LogsTimelineBar } from '@/features/logs/components/timeline-bar'
import { LogsTimelineMetric } from '@/features/logs/components/timeline-metric'

type LogsTimelineProps = {
  summary: LogDashboardSummary | undefined
}

export function LogsTimeline({ summary }: LogsTimelineProps) {
  const maxTotal = Math.max(1, ...(summary?.timeline.map((bucket) => bucket.total) ?? [0]))

  return (
    <div className='px-2 py-2'>
      <div className='text-3xs mb-2 grid grid-cols-4 gap-2'>
        <LogsTimelineMetric label='Events' value={summary?.total ?? 0} />
        <LogsTimelineMetric label='Errors' tone='error' value={summary?.errorCount ?? 0} />
        <LogsTimelineMetric label='Warn' tone='warn' value={summary?.warnCount ?? 0} />
        <LogsTimelineMetric label='Slow' tone='slow' value={summary?.slowCount ?? 0} />
      </div>
      <div className='flex h-14 items-end gap-px overflow-hidden'>
        {(summary?.timeline ?? []).map((bucket) => (
          <LogsTimelineBar bucket={bucket} key={bucket.start} maxTotal={maxTotal} />
        ))}
      </div>
    </div>
  )
}
