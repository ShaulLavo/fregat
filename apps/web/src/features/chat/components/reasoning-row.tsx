import { BrainIcon, CaretRightIcon } from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'
import { Spinner } from '@workspace/ui/components/spinner'
import { cn } from '@workspace/ui/lib/utils'

import { AssistantMarkdown } from '@/features/chat/components/assistant-markdown'
import { useChatWorkLogExpansionStore } from '@/features/chat/state/chat-work-log-expansion-store'
import { reasoningLabel } from '@/features/chat/utils/reasoning'
import type { ChatWorkLogEntry } from '@/features/chat/utils/work-log'

export function ReasoningRow({
  entry,
  streaming,
}: {
  entry: ChatWorkLogEntry
  streaming: boolean
}) {
  const expanded = useChatWorkLogExpansionStore(
    (state) => state.userExpandedRowIds[entry.id] ?? state.autoExpandedRowIds[entry.id] ?? false,
  )
  const setUserRowExpanded = useChatWorkLogExpansionStore((state) => state.setUserRowExpanded)
  const label = reasoningLabel(entry, streaming)

  return (
    <div className='min-w-0' data-reasoning-row data-work-log-entry-id={entry.id}>
      <Button
        aria-expanded={expanded}
        className='text-muted-foreground h-auto max-w-full justify-start gap-2 px-1 py-1 text-xs font-normal tabular-nums'
        data-scroll-anchor-ignore
        variant='ghost'
        onClick={() => setUserRowExpanded(entry.id, !expanded)}
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
