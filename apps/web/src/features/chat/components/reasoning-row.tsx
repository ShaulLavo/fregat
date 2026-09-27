import { BrainIcon, CaretRightIcon } from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'
import { Spinner } from '@workspace/ui/components/spinner'
import { cn } from '@workspace/ui/lib/utils'

import { AssistantMarkdown } from '@/features/chat/components/assistant-markdown'
import { useChatWorkLogExpansionStore } from '@/features/chat/state/chat-work-log-expansion-store'
import type { ChatWorkLogEntry } from '@/features/chat/utils/work-log'

export function ReasoningRow({
  entry,
  streaming,
  showHeader = true,
}: {
  entry: ChatWorkLogEntry
  streaming: boolean
  showHeader?: boolean
}) {
  const storedExpanded = useChatWorkLogExpansionStore(
    (state) => state.expandedRowIds[entry.id] ?? false,
  )
  const expanded = !showHeader || storedExpanded
  const toggleRowExpanded = useChatWorkLogExpansionStore((state) => state.toggleRowExpanded)
  const label = streaming ? 'Thinking' : 'Thought'

  return (
    <div className='min-w-0' data-reasoning-row data-work-log-entry-id={entry.id}>
      {showHeader ? (
        <Button
          aria-expanded={expanded}
          className='text-muted-foreground h-auto max-w-full justify-start gap-2 px-1 py-1 text-xs font-normal tabular-nums'
          data-scroll-anchor-ignore
          variant='ghost'
          onClick={() => toggleRowExpanded(entry.id)}
        >
          {streaming ? (
            <Spinner size='xs' aria-hidden='true' />
          ) : (
            <BrainIcon aria-hidden='true' className='size-(--icon-size-sm) shrink-0' />
          )}
          <span>{label}</span>
          <CaretRightIcon
            aria-hidden='true'
            className={cn(
              'size-(--icon-size-sm) shrink-0 transition-transform',
              expanded && 'rotate-90',
            )}
          />
        </Button>
      ) : null}
      {expanded ? (
        <div className='ml-4 py-1 pl-3' aria-label='Reasoning' role='region'>
          <AssistantMarkdown
            className='text-muted-foreground text-xs'
            streaming={streaming}
            text={entry.title}
          />
        </div>
      ) : null}
    </div>
  )
}
