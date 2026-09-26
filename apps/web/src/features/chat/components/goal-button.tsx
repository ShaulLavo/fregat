import { CrosshairIcon } from '@phosphor-icons/react'
import { useIsMutating } from '@tanstack/react-query'
import type { ProviderGoalAction, ScopedSessionRef } from '@workspace/contracts'
import { Button } from '@workspace/ui/components/button'
import { Popover, PopoverContent, PopoverTrigger } from '@workspace/ui/components/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import { useState } from 'react'

import { GoalDetails } from '@/features/chat/components/goal-details'
import { useControlGoal } from '@/features/chat/hooks/use-control-goal'
import { useSessionGoal } from '@/features/chat/hooks/use-session-goal'
import {
  selectChatProjectionSlice,
  useChatProjectionStore,
} from '@/features/chat/state/chat-projection-store'
import { goalStatusLabel } from '@/features/chat/utils/goal-labels'
import { chatMutationKeys } from '@/features/chat/utils/mutation-keys'

/** Shown while the session's harness works toward a goal: its status, the details and controls. */
export function GoalButton({ sessionRef }: { readonly sessionRef: ScopedSessionRef }) {
  // Open for one objective, so a later goal never appears with the popover already open.
  const [openFor, setOpenFor] = useState<string | null>(null)
  const state = useSessionGoal(sessionRef)
  const control = useControlGoal(sessionRef)
  const changing =
    useIsMutating({
      mutationKey: chatMutationKeys.controlGoal(sessionRef.environmentId, sessionRef.sessionId),
    }) > 0
  const interactionMode = useChatProjectionStore(
    (store) =>
      selectChatProjectionSlice(store, sessionRef.environmentId).sessionById[sessionRef.sessionId]
        ?.interactionMode ?? null,
  )
  const runtimeMode = useChatProjectionStore(
    (store) =>
      selectChatProjectionSlice(store, sessionRef.environmentId).sessionById[sessionRef.sessionId]
        ?.runtimeMode ?? null,
  )
  const goal = state.data?.goal ?? null
  if (!goal || !interactionMode || !runtimeMode) return null

  const controllable = state.data?.controllable ?? false
  const status = goalStatusLabel(goal.status)
  // The popover stays open on the new status; a cleared goal takes the button with it.
  const run = (action: ProviderGoalAction) =>
    control.mutate({ action, controllable, modes: { interactionMode, runtimeMode } })

  return (
    <Popover
      open={openFor === goal.objective}
      onOpenChange={(next) => setOpenFor(next ? goal.objective : null)}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <Button
                  aria-label={`Goal: ${status}`}
                  className='text-muted-foreground hover:text-foreground shrink-0'
                  size='sm'
                  type='button'
                  variant='ghost'
                >
                  <CrosshairIcon className='size-(--icon-size-sm)' />
                  <span className='text-2xs'>{status}</span>
                </Button>
              }
            />
          }
        />
        <TooltipContent>{`Goal: ${status}`}</TooltipContent>
      </Tooltip>
      <PopoverContent align='end' className='w-80 p-0 text-xs'>
        <p className='section-label px-(--density-row-padding-x) pt-(--density-popover-padding)'>
          Goal
        </p>
        <GoalDetails goal={goal} />
        <div className='flex items-center justify-end gap-(--density-control-gap) p-(--density-popover-padding)'>
          {controllable && goal.status === 'active' ? (
            <Button
              disabled={changing}
              onClick={() => run('pause')}
              size='sm'
              type='button'
              variant='outline'
            >
              Pause
            </Button>
          ) : null}
          {controllable && goal.status === 'paused' ? (
            <Button
              disabled={changing}
              onClick={() => run('resume')}
              size='sm'
              type='button'
              variant='outline'
            >
              Resume
            </Button>
          ) : null}
          <Button
            disabled={changing}
            onClick={() => run('clear')}
            size='sm'
            type='button'
            variant='destructive'
          >
            Clear goal
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
