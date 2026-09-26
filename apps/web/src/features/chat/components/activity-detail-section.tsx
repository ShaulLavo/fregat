import { cn } from '@workspace/ui/lib/utils'

import { ActivityJsonInput } from '@/features/chat/components/activity-json-input'
import { ActivityOutputText } from '@/features/chat/components/activity-output-text'
import { useWorkLogScroll } from '@/features/chat/hooks/use-work-log-scroll'
import { prettyJsonInput } from '@/features/chat/utils/tool-input'

export function ActivityDetailSection({
  activityId,
  failed,
  label,
  value,
}: {
  activityId: string
  failed: boolean
  label: string
  value: string
}) {
  const { scrollRef } = useWorkLogScroll(`detail:${activityId}:${label}`, value.length, 'text')
  const json = label === 'Input' ? prettyJsonInput(value) : null
  const output = label === 'Output' || label === 'Result'
  const className = cn(
    'focus-ring-inset max-h-64 overflow-auto overscroll-contain font-mono text-xs leading-relaxed break-words whitespace-pre-wrap outline-none',
    failed && output
      ? 'bg-destructive/10 text-destructive rounded-md px-2 py-1'
      : 'text-muted-foreground',
  )

  return (
    <div>
      <p className='text-muted-foreground mb-1 text-xs'>{label}</p>
      {json === null ? (
        <pre
          aria-label={label}
          className={className}
          data-tool-group-scroll
          ref={scrollRef}
          tabIndex={0}
        >
          {output ? <ActivityOutputText text={value} /> : value}
        </pre>
      ) : (
        <ActivityJsonInput className={className} code={json} label={label} scrollRef={scrollRef} />
      )}
    </div>
  )
}
