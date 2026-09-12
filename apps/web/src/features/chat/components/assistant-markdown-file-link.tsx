import { FileCodeIcon } from '@phosphor-icons/react'
import { cn } from '@workspace/ui/lib/utils'
import { use, type MouseEvent } from 'react'

import type { MarkdownFileReference } from '@/features/chat/utils/markdown-file-links'
import { MarkdownFileLinkContext } from '@/features/chat/providers/markdown-file-link-context'
import { clientErrors } from '@/lib/structured-errors'

/**
 * The transcript's bridge into the editor: a file reference is a real target,
 * not decoration, so it opens the document (and its line) on click.
 */
export function AssistantMarkdownFileLink({
  className,
  copyMarkdown,
  label,
  reference,
}: {
  readonly className?: string
  /** What a markdown copy of the selection should emit for this chip. */
  readonly copyMarkdown: string
  readonly label: string
  readonly reference: MarkdownFileReference
}) {
  const actions = use(MarkdownFileLinkContext)
  if (!actions) {
    throw clientErrors.CONTEXT_MISSING({
      message: 'AssistantMarkdownFileLink must be used within MarkdownFileLinkContext',
    })
  }
  const { openFileReference } = actions

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault()
    event.stopPropagation()
    openFileReference(reference)
  }

  return (
    <a
      className={cn(
        'border-border bg-muted text-foreground hover:bg-accent hover:text-accent-foreground inline-flex max-w-full min-w-0 cursor-pointer items-baseline gap-1 rounded-md border px-1 align-baseline font-mono text-[0.9em] transition-colors',
        className,
      )}
      data-chat-file-link={reference.path}
      data-markdown-copy={copyMarkdown}
      href={reference.path}
      title={referenceTitle(reference)}
      onClick={handleClick}
    >
      <FileCodeIcon aria-hidden='true' className='size-3 shrink-0 self-center' />
      <span className='truncate'>{label}</span>
    </a>
  )
}

function referenceTitle(reference: MarkdownFileReference) {
  if (reference.line === null) return reference.path

  return `${reference.path}:${reference.line}`
}
