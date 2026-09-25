import { TickerNumber } from '@/components/ticker-number'
import { useSessionTitleActions } from '@/features/chat-mode/hooks/use-session-title-actions'
import { useSessionTitleSelection } from '@/features/chat-mode/hooks/use-session-title-selection'
import { useIsMutating } from '@tanstack/react-query'
import {
  ArchiveIcon,
  ArrowsClockwiseIcon,
  CheckIcon,
  ClockIcon,
  EnvelopeSimpleIcon,
  TrashIcon,
  XIcon,
} from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'
import { PaneBar } from '@workspace/ui/components/pane-bar'
import { Spinner } from '@workspace/ui/components/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@workspace/ui/components/dropdown-menu'
import { useSessionBulkLifecycle } from '@/features/chat-mode/hooks/use-session-bulk-lifecycle'
import { useSessionActions } from '@/features/chat-mode/hooks/use-session-actions'
import { clearSessionMultiSelect } from '@/features/chat-mode/state/session-commands'
import { useSessionMultiSelectStore } from '@/features/chat-mode/state/session-multi-select-store'
import { chatModeMutationKeys } from '@/features/chat-mode/utils/mutation-keys'
import { primaryQueryClient } from '@/lib/environments/state/query-clients'

export function SessionBulkBar() {
  const refs = useSessionMultiSelectStore((state) => state.refs)
  const actions = useSessionActions()
  const titles = useSessionTitleSelection(refs)
  const titleActions = useSessionTitleActions()
  const lifecycle = useSessionBulkLifecycle(refs)
  const pending =
    useIsMutating({ mutationKey: chatModeMutationKeys.session() }, primaryQueryClient()) > 0
  return (
    <PaneBar aria-label='Selected sessions' role='toolbar'>
      <span className='text-muted-foreground text-2xs min-w-0 flex-1 truncate tabular-nums'>
        <TickerNumber value={refs.length} /> selected
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button size='sm' variant='ghost' disabled={pending}>
              {pending ? <Spinner /> : null}Actions
            </Button>
          }
        />
        <DropdownMenuContent align='end'>
          {lifecycle.settlement ? (
            <DropdownMenuItem
              disabled={!lifecycle.settleEnabled}
              onClick={() => void actions.applyLifecycleToSessions(refs, { type: 'settle' })}
            >
              <CheckIcon />
              Settle
            </DropdownMenuItem>
          ) : null}
          {lifecycle.snooze ? (
            <DropdownMenuItem
              disabled={!lifecycle.snoozeEnabled}
              onClick={() => actions.requestSnooze(refs, 'Selected sessions')}
            >
              <ClockIcon />
              Snooze…
            </DropdownMenuItem>
          ) : null}
          {titles.supported > 0 ? (
            <DropdownMenuItem
              disabled={titles.eligible === 0}
              onClick={() => titleActions.mutate(refs)}
            >
              <ArrowsClockwiseIcon />
              {titles.eligible ? `Regenerate titles (${titles.eligible})` : 'Regenerating titles…'}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onClick={() => actions.markSessionsUnread(refs)}>
            <EnvelopeSimpleIcon />
            Mark as unread
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => void actions.archiveSessions(refs)}>
            <ArchiveIcon />
            Archive
          </DropdownMenuItem>
          <DropdownMenuItem
            className='text-destructive'
            onClick={() => actions.deleteSessions(refs)}
          >
            <TrashIcon />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              aria-label='Clear selection'
              focusableWhenDisabled
              size='icon-sm'
              variant='ghost'
              disabled={pending}
              onClick={clearSessionMultiSelect}
            >
              <XIcon className='size-(--icon-size-sm)' />
            </Button>
          }
        />
        <TooltipContent>Clear selection</TooltipContent>
      </Tooltip>
    </PaneBar>
  )
}
