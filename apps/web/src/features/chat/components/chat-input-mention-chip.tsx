import { FileCodeIcon } from '@phosphor-icons/react'
import { createRoot } from 'react-dom/client'

import { basename } from '@/lib/path-formatters'

/**
 * The visible half of a mention. The editor paints it over the mention's `@path` text, which stays
 * the message; the node the editor mounts it into already refuses the caret.
 */
export function ChatInputMentionChip({ path }: { readonly path: string }) {
  return (
    <span
      className='bg-muted text-foreground inline-flex max-w-full items-baseline gap-1 rounded-md px-1 align-baseline font-mono text-[0.9em] leading-tight select-none'
      data-chat-input-mention={path}
      title={path}
    >
      <FileCodeIcon aria-hidden='true' className='size-(--icon-size-sm) shrink-0 self-center' />
      <span className='truncate'>{basename(path)}</span>
    </span>
  )
}

/** Mounts a chip into the node the editor gives a mention, and takes it down with it. */
export function mountChatInputMentionChip(path: string) {
  return (container: HTMLElement) => {
    const root = createRoot(container)
    root.render(<ChatInputMentionChip path={path} />)
    // Deferred: the editor retires widgets inside its own passes, which React may be driving.
    return { dispose: () => queueMicrotask(() => root.unmount()) }
  }
}
