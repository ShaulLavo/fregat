import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import { ArchiveIcon, TrashIcon, XIcon } from '@phosphor-icons/react'

import { useSessionActions } from '@/features/chat-mode/hooks/use-session-actions'
import { clearSessionMultiSelect } from '@/features/chat-mode/state/session-commands'
import { useSessionMultiSelectStore } from '@/features/chat-mode/state/session-multi-select-store'
import { Button } from '@workspace/ui/components/button'
import { PaneBar } from '@workspace/ui/components/pane-bar'

/**
 * What a marked set is for. Without it, multi-select is a highlight — the reason to pick
 * ten finished sessions is to file or drop all ten in one gesture.
 */
export function SessionBulkBar() {
  const refs = useSessionMultiSelectStore((state) => state.refs)
  const actions = useSessionActions()

  return (
    <PaneBar aria-label='Selected sessions' role='toolbar'>
      <span className='text-muted-foreground text-2xs min-w-0 flex-1 truncate tabular-nums'>
        {refs.length} selected
      </span>
      <Button
        className='text-muted-foreground hover:text-foreground text-2xs'
        size='sm'
        type='button'
        variant='ghost'
        onClick={() => actions.archiveSessions(refs)}
      >
        <ArchiveIcon className='size-(--icon-size-sm)' />
        Archive
      </Button>
      <Button
        className='text-destructive hover:text-destructive text-2xs'
        size='sm'
        type='button'
        variant='ghost'
        onClick={() => actions.deleteSessions(refs)}
      >
        <TrashIcon className='size-(--icon-size-sm)' />
        Delete
      </Button>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              aria-label='Clear selection'
              className='text-muted-foreground hover:text-foreground shrink-0'
              size='icon-sm'
              type='button'
              variant='ghost'
              onClick={clearSessionMultiSelect}
            >
              <XIcon className='size-(--icon-size-sm)' />
            </Button>
          }
        />{' '}
        <TooltipContent>{'Clear selection'}</TooltipContent>
      </Tooltip>
    </PaneBar>
  )
}
