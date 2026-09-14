import { BookmarkSimpleIcon, XIcon } from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'

import { formatChatTimestamp } from '@/features/chat/utils/formatters'
import type { PromptStashEntry } from '@/features/chat/state/prompt-stash-store'

const SNIPPET_MAX_CHARS = 90

/** The parked prompts, newest first. Clicking one puts it back in the composer. */
export function PromptStashMenu({
  entries,
  onRemove,
  onRestore,
}: {
  readonly entries: readonly PromptStashEntry[]
  readonly onRemove: (entry: PromptStashEntry) => void
  readonly onRestore: (entry: PromptStashEntry) => void
}) {
  return (
    <div className='flex min-w-0 flex-col gap-1'>
      <p className='text-muted-foreground/70 text-3xs px-1 font-medium tracking-wide uppercase'>
        Stashed prompts
      </p>
      <ul className='flex max-h-72 min-w-0 flex-col gap-0.5 overflow-y-auto overscroll-contain'>
        {entries.map((entry) => (
          <li className='group/stash flex min-w-0 items-center gap-1' key={entry.id}>
            <Button
              className='h-auto min-w-0 flex-1 justify-start gap-(--density-control-gap) py-(--density-gap-tight) text-left text-xs font-normal'
              title={entry.prompt}
              type='button'
              variant='ghost'
              onClick={() => onRestore(entry)}
            >
              <BookmarkSimpleIcon className='text-muted-foreground size-3.5 shrink-0' />
              <span className='min-w-0 flex-1 truncate'>{promptSnippet(entry.prompt)}</span>
              <span className='text-muted-foreground text-3xs shrink-0 tabular-nums'>
                {formatChatTimestamp(entry.createdAt)}
              </span>
            </Button>
            <Button
              aria-label={`Delete stashed prompt: ${promptSnippet(entry.prompt)}`}
              className='shrink-0 opacity-0 group-hover/stash:opacity-100 focus-visible:opacity-100'
              size='icon-sm'
              type='button'
              variant='ghost'
              onClick={() => onRemove(entry)}
            >
              <XIcon className='size-3' />
            </Button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function promptSnippet(prompt: string) {
  const collapsed = prompt.trim().replace(/\s+/gu, ' ')
  if (collapsed.length <= SNIPPET_MAX_CHARS) return collapsed

  return `${collapsed.slice(0, SNIPPET_MAX_CHARS)}…`
}
