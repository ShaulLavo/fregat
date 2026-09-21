import type { LogDashboardTimelineBucket } from '@workspace/contracts'

import { cn } from '@workspace/ui/lib/utils'

type LogsTimelineBarProps = {
  bucket: LogDashboardTimelineBucket
  maxTotal: number
}

export function LogsTimelineBar({ bucket, maxTotal }: LogsTimelineBarProps) {
  const height = `${Math.max(3, Math.round((bucket.total / maxTotal) * 100))}%`
  const tone = bucketTone(bucket)

  return (
    // h-full gives the bar's percentage height a definite basis; the strip's
    // items-end otherwise leaves this column content-sized, so every bar is 0px.
    <div className='flex h-full min-w-[3px] flex-1 items-end' title={timelineTitle(bucket)}>
      <div
        className={cn(
          'w-full transition-colors',
          tone === 'error' && 'bg-destructive/45',
          tone === 'warn' && 'bg-warning/45',
          tone === 'slow' && 'bg-info/45',
          tone === 'ok' && 'bg-success/30',
        )}
        style={{ height }}
      />
    </div>
  )
}

function bucketTone(bucket: LogDashboardTimelineBucket) {
  if (bucket.error > 0) return 'error'
  if (bucket.warn > 0) return 'warn'
  if (bucket.slow > 0) return 'slow'

  return 'ok'
}

function timelineTitle(bucket: LogDashboardTimelineBucket) {
  return `${bucket.total} events · ${bucket.error} errors · ${bucket.warn} warnings`
}
