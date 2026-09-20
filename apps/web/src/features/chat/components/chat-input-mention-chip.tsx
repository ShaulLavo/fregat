import { FileCodeIcon } from '@phosphor-icons/react'

import { basename } from '@/lib/path-formatters'

/**
 * The visible half of a mention. It carries `contentEditable={false}` because
 * the caret must step over the chip rather than into it — the node owns the
 * text, and typing inside the pill would desynchronise the two.
 */
export function ChatInputMentionChip({ path }: { readonly path: string }) {
  return (
    <span
      className='bg-muted text-foreground inline-flex max-w-full items-baseline gap-1 rounded-md px-1 align-baseline font-mono text-[0.9em] leading-tight select-none'
      contentEditable={false}
      data-chat-input-mention={path}
      spellCheck={false}
      title={path}
    >
      <FileCodeIcon aria-hidden='true' className='size-(--icon-size-sm) shrink-0 self-center' />
      <span className='truncate'>{basename(path)}</span>
    </span>
  )
}
