import { TerminalWindowIcon } from '@phosphor-icons/react'
import { cn } from '@workspace/ui/lib/utils'

import {
  formatTerminalContextRange,
  terminalContextPreview,
  type TerminalContextSelection,
} from '@workspace/client-core/chat/terminal-context'

/**
 * Attached terminal output, shown the way the composer showed it: which
 * terminal, which lines, and enough of the first line to recognise. The full
 * capture is in the message the agent received — the chip is a receipt, so it
 * stays one line no matter how much was sent.
 */
export function TerminalContextChip({
  className,
  selection,
}: {
  readonly className?: string
  readonly selection: TerminalContextSelection
}) {
  const preview = terminalContextPreview(selection.text)

  return (
    <span
      className={cn(
        'border-border bg-muted text-foreground inline-flex max-w-full items-center gap-1.5 rounded-md border px-1.5 py-0.5 align-baseline font-mono text-[0.9em] leading-tight select-none',
        className,
      )}
      data-terminal-context-source={selection.source}
      title={selection.text}
    >
      <TerminalWindowIcon aria-hidden='true' className='size-(--icon-size-sm) shrink-0' />
      <span className='shrink-0'>{selection.source}</span>
      <span className='text-muted-foreground shrink-0 tabular-nums'>
        {formatTerminalContextRange(selection)}
      </span>
      {preview.length > 0 ? (
        <span className='text-muted-foreground min-w-0 truncate'>{preview}</span>
      ) : null}
    </span>
  )
}
