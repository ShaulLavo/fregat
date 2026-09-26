import { MoonIcon } from '@phosphor-icons/react'
import type { ScopedSessionRef } from '@workspace/contracts'
import { Button } from '@workspace/ui/components/button'
import { Popover, PopoverContent, PopoverTrigger } from '@workspace/ui/components/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import { useIsMutating } from '@tanstack/react-query'
import { useState } from 'react'

import { ScheduleList } from '@/features/chat/components/schedule-list'
import { useCancelSchedules } from '@/features/chat/hooks/use-cancel-schedules'
import { useMinuteClock } from '@/features/chat/hooks/use-minute-clock'
import { useSessionSchedules } from '@/features/chat/hooks/use-session-schedules'
import {
  selectChatProjectionSlice,
  useChatProjectionStore,
} from '@/features/chat/state/chat-projection-store'
import { formatWakeTime } from '@/features/chat/utils/formatters'
import { chatMutationKeys } from '@/features/chat/utils/mutation-keys'

/** Shown while the agent's harness holds a wake-up, cron or loop: when it wakes, and the list. */
export function SchedulesButton({ sessionRef }: { readonly sessionRef: ScopedSessionRef }) {
  const sleepingUntil = useChatProjectionStore(
    (state) =>
      selectChatProjectionSlice(state, sessionRef.environmentId).sessionById[sessionRef.sessionId]
        ?.sleepingUntil ?? null,
  )
  const [open, setOpen] = useState(false)
  const nowMs = useMinuteClock()
  const schedules = useSessionSchedules(sessionRef, open)
  const cancel = useCancelSchedules(sessionRef)
  const cancelling =
    useIsMutating({
      mutationKey: chatMutationKeys.cancelSchedules(sessionRef.environmentId, sessionRef.sessionId),
    }) > 0
  if (!sleepingUntil && !open) return null

  const when = sleepingUntil ? formatWakeTime(sleepingUntil, nowMs) : null
  const label = when === 'due' ? 'Wake-up due' : `Sleeping until ${when ?? '…'}`
  const hasSchedules = (schedules.data?.schedules.length ?? 0) > 0

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <Button
                  aria-label={label}
                  className='text-muted-foreground hover:text-foreground shrink-0'
                  size='sm'
                  type='button'
                  variant='ghost'
                >
                  <MoonIcon className='size-(--icon-size-sm)' />
                  <span className='text-2xs font-mono tabular-nums'>{when}</span>
                </Button>
              }
            />
          }
        />
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <PopoverContent align='end' className='w-80 p-0 text-xs'>
        <p className='section-label px-(--density-row-padding-x) pt-(--density-popover-padding)'>
          Schedules
        </p>
        <ScheduleList nowMs={nowMs} schedules={schedules} />
        <div className='flex items-center gap-(--density-control-gap) p-(--density-popover-padding)'>
          <p className='text-muted-foreground text-2xs min-w-0 flex-1'>
            Stops the agent and ends its schedules.
          </p>
          <Button
            disabled={!hasSchedules || cancelling}
            onClick={() => cancel.mutate(undefined, { onSuccess: () => setOpen(false) })}
            size='sm'
            type='button'
            variant='destructive'
          >
            Cancel schedules
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
