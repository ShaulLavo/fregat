import { stashMessageLabel } from '../utils/stash-message'
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
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
      <p className='text-muted-foreground text-3xs px-1 font-medium tracking-wide uppercase'>
        Stashed prompts
      </p>
      <ul className='flex max-h-72 min-w-0 flex-col gap-0.5 overflow-y-auto overscroll-contain'>
        {entries.map((entry) => (
          <li className='group/stash flex min-w-0 items-center gap-1' key={entry.id}>
            <Button
              className='h-auto min-w-0 flex-1 justify-start gap-(--density-control-gap) py-(--density-gap-tight) text-left text-xs font-normal'
              title={stashMessageLabel(entry)}
              type='button'
              variant='ghost'
              onClick={() => onRestore(entry)}
            >
              <BookmarkSimpleIcon className='text-muted-foreground size-(--icon-size-sm) shrink-0' />
              <span className='min-w-0 flex-1 truncate'>
                {promptSnippet(stashMessageLabel(entry))}
              </span>
              <span className='text-muted-foreground text-3xs shrink-0 tabular-nums'>
                {formatChatTimestamp(entry.createdAt)}
              </span>
            </Button>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    aria-label={`Delete stashed prompt: ${promptSnippet(stashMessageLabel(entry))}`}
                    className='shrink-0 opacity-0 group-hover/stash:opacity-100 focus-visible:opacity-100'
                    size='icon-sm'
                    type='button'
                    variant='ghost'
                    onClick={() => onRemove(entry)}
                  >
                    <XIcon className='size-(--icon-size-sm)' />
                  </Button>
                }
              />
              <TooltipContent>{`Delete stashed prompt: ${promptSnippet(stashMessageLabel(entry))}`}</TooltipContent>
            </Tooltip>
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
