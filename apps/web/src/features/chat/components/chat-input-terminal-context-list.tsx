import { XIcon } from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'

import { formatTerminalContextLabel } from '@workspace/client-core/chat/terminal-context'
import type { ChatInputTerminalContext } from '../state/chat-input-draft-store'
import { TerminalContextChip } from './terminal-context-chip'

/**
 * Captured terminal output staged for the next message. It is a chip strip
 * rather than text in the editor: the block that reaches the agent is XML, and
 * dropping that into the prompt would make the user edit markup they never
 * wrote.
 */
export function ChatInputTerminalContextList({
  contexts,
  disabled,
  onRemove,
}: {
  readonly contexts: readonly ChatInputTerminalContext[]
  readonly disabled: boolean
  readonly onRemove: (contextId: string) => void
}) {
  if (contexts.length === 0) return null

  return (
    <div className='compact:gap-1 compact:px-2 compact:pb-1.5 flex min-w-0 flex-wrap gap-1.5 px-3 pb-2'>
      {contexts.map((context) => (
        <span className='inline-flex min-w-0 items-center gap-0.5' key={context.id}>
          <TerminalContextChip className='min-w-0' selection={context} />
          <Button
            aria-label={`Remove ${formatTerminalContextLabel(context)}`}
            className='text-muted-foreground hover:text-foreground rounded-md'
            disabled={disabled}
            size='icon-xs'
            type='button'
            variant='ghost'
            onClick={() => onRemove(context.id)}
          >
            <XIcon className='size-3.5' />
          </Button>
        </span>
      ))}
    </div>
  )
}
