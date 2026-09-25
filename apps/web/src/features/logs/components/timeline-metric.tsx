import { TickerNumber } from '@/components/ticker-number'
import { cn } from '@workspace/ui/lib/utils'

type LogsTimelineMetricProps = {
  label: string
  tone?: 'error' | 'slow' | 'warn'
  value: number
}

export function LogsTimelineMetric({ label, tone, value }: LogsTimelineMetricProps) {
  return (
    <div className='bg-muted/20 min-w-0 px-1.5 py-1'>
      <div
        className={cn(
          'truncate font-mono text-xs leading-4 text-foreground',
          tone === 'error' && 'text-destructive',
          tone === 'warn' && 'text-warning',
          tone === 'slow' && 'text-info',
        )}
      >
        <TickerNumber size='xs' value={value} />
      </div>
      <div className='text-muted-foreground truncate'>{label}</div>
    </div>
  )
}
