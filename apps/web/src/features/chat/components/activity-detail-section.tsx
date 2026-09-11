import { useWorkLogScroll } from '@/features/chat/hooks/use-work-log-scroll'

export function ActivityDetailSection({
  activityId,
  label,
  value,
}: {
  activityId: string
  label: string
  value: string
}) {
  const scrollRef = useWorkLogScroll(`detail:${activityId}:${label}`, value.length)

  return (
    <div>
      <p className='text-muted-foreground mb-1 text-xs'>{label}</p>
      <pre
        aria-label={label}
        className='text-muted-foreground focus-visible:ring-ring max-h-64 overflow-auto font-mono text-xs leading-relaxed break-words whitespace-pre-wrap outline-none focus-visible:ring-1 focus-visible:ring-inset'
        data-tool-group-scroll
        ref={scrollRef}
        tabIndex={0}
      >
        {value}
      </pre>
    </div>
  )
}
