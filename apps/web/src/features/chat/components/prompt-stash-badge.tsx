import { BookmarkSimpleIcon } from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'
import { Popover, PopoverContent, PopoverTrigger } from '@workspace/ui/components/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'

import { PromptStashMenu } from '@/features/chat/components/prompt-stash-menu'
import { usePromptStash } from '@/features/chat/hooks/use-prompt-stash'
import type { ChatInputDraftTarget } from '@/features/chat/state/chat-input-draft-store'

/**
 * The stash counter in the composer footer, and the queue behind it. Renders
 * nothing until something is parked — but the hook still runs, because ⌘S has
 * to work on the first, empty stash.
 */
export function PromptStashBadge({
  disabled,
  draftTarget,
}: {
  readonly disabled: boolean
  readonly draftTarget: ChatInputDraftTarget
}) {
  const { entries, menuOpen, removeEntry, restoreEntry, setMenuOpen } = usePromptStash(draftTarget)
  if (entries.length === 0) return null

  return (
    <Popover open={menuOpen} onOpenChange={setMenuOpen}>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <Button
                  aria-label={`Stashed prompts: ${entries.length}`}
                  className='text-muted-foreground text-2xs shrink-0 gap-1 font-normal'
                  disabled={disabled}
                  focusableWhenDisabled
                  size='sm'
                  type='button'
                  variant='ghost'
                >
                  <BookmarkSimpleIcon className='size-(--icon-size-sm) shrink-0' />
                  <span className='tabular-nums'>{entries.length}</span>
                </Button>
              }
            />
          }
        />
        <TooltipContent>Stashed prompts: {entries.length}</TooltipContent>
      </Tooltip>
      <PopoverContent align='end' className='w-80' side='top'>
        <PromptStashMenu entries={entries} onRemove={removeEntry} onRestore={restoreEntry} />
      </PopoverContent>
    </Popover>
  )
}
