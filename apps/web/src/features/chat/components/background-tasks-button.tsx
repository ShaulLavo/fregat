import { HourglassMediumIcon } from '@phosphor-icons/react'
import { useMutationState } from '@tanstack/react-query'
import type { ScopedSessionRef } from '@workspace/contracts'
import { Button } from '@workspace/ui/components/button'
import { Popover, PopoverContent, PopoverTrigger } from '@workspace/ui/components/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import { useState } from 'react'

import { BackgroundTaskList } from '@/features/chat/components/background-task-list'
import { useBackgroundTasks } from '@/features/chat/hooks/use-background-tasks'
import { useStopBackgroundTask } from '@/features/chat/hooks/use-stop-background-task'
import {
  selectChatProjectionSlice,
  useChatProjectionStore,
} from '@/features/chat/state/chat-projection-store'
import { chatMutationKeys } from '@/features/chat/utils/mutation-keys'

/** Shown while the session runs work in the background: what it is, and a stop for each. */
export function BackgroundTasksButton({ sessionRef }: { readonly sessionRef: ScopedSessionRef }) {
  const liveness = useChatProjectionStore(
    (state) =>
      selectChatProjectionSlice(state, sessionRef.environmentId).sessionById[sessionRef.sessionId]
        ?.backgroundLiveness ?? null,
  )
  const [open, setOpen] = useState(false)
  const roster = useBackgroundTasks(sessionRef, open)
  const stop = useStopBackgroundTask(sessionRef)
  const stopping = useMutationState({
    filters: {
      mutationKey: chatMutationKeys.stopBackgroundTask(
        sessionRef.environmentId,
        sessionRef.sessionId,
      ),
      status: 'pending',
    },
    select: (mutation) => mutation.state.variables,
  })
  if (!liveness && !open) return null

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <Button
                  aria-label='Background tasks'
                  className='text-muted-foreground hover:text-foreground shrink-0'
                  size='icon-sm'
                  type='button'
                  variant='ghost'
                >
                  <HourglassMediumIcon className='size-(--icon-size)' />
                </Button>
              }
            />
          }
        />
        <TooltipContent>{'Background tasks'}</TooltipContent>
      </Tooltip>
      <PopoverContent align='end' className='w-80 p-0 text-xs'>
        <p className='section-label px-(--density-row-padding-x) pt-(--density-popover-padding)'>
          Background tasks
        </p>
        <BackgroundTaskList
          onStop={(taskId) => stop.mutate(taskId)}
          roster={roster}
          stopping={stopping}
        />
      </PopoverContent>
    </Popover>
  )
}
