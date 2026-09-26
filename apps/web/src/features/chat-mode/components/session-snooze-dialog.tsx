import { useState } from 'react'
import { useIsMutating } from '@tanstack/react-query'
import { Button } from '@workspace/ui/components/button'
import { Tabs, TabsList, TabsTab } from '@workspace/ui/components/tabs'
import { Input } from '@workspace/ui/components/input'
import { Spinner } from '@workspace/ui/components/spinner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@workspace/ui/components/dialog'
import {
  customSnooze,
  snoozePresets,
  type CustomSnoozeInput,
} from '@workspace/client-core/chat/rail/snooze'
import { useSessionSnoozeRequestStore } from '@/features/chat-mode/state/session-snooze-request-store'
import { useSessionActions } from '@/features/chat-mode/hooks/use-session-actions'
import { chatModeMutationKeys } from '@/features/chat-mode/utils/mutation-keys'
import { primaryQueryClient } from '@/lib/environments/state/query-clients'

export function SessionSnoozeDialog() {
  const request = useSessionSnoozeRequestStore((state) => state.request)
  const dismiss = useSessionSnoozeRequestStore((state) => state.dismiss)
  const actions = useSessionActions()
  const pending =
    useIsMutating({ mutationKey: chatModeMutationKeys.lifecycle() }, primaryQueryClient()) > 0
  const [input, setInput] = useState<CustomSnoozeInput>({ mode: 'date', date: '', time: '' })
  const now = new Date()
  const custom = customSnooze(input, now)
  async function snooze(snoozedUntil: string) {
    if (!request) return
    await actions.applyLifecycleToSessions(request.refs, { type: 'snooze', snoozedUntil })
    dismiss()
  }
  return (
    <Dialog
      open={request !== null}
      onOpenChange={(open) => {
        if (!open && !pending) dismiss()
      }}
    >
      <DialogContent className='sm:max-w-md' showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Snooze sessions</DialogTitle>
          <DialogDescription>
            {request?.refs.length === 1
              ? request.title
              : `${request?.refs.length ?? 0} selected sessions`}{' '}
            will return when the timer ends or new activity arrives.
          </DialogDescription>
        </DialogHeader>
        <div className='flex flex-col gap-1'>
          {snoozePresets(now).map((preset) => (
            <Button
              key={preset.id}
              variant='ghost'
              className='justify-between'
              disabled={pending}
              onClick={() => void snooze(preset.snoozedUntil)}
            >
              <span>{preset.label}</span>
              <span className='text-muted-foreground'>{preset.whenLabel}</span>
            </Button>
          ))}
        </div>
        <Tabs
          value={input.mode}
          onValueChange={(mode: CustomSnoozeInput['mode']) =>
            setInput(
              mode === 'date'
                ? { mode, date: '', time: '' }
                : { mode, amount: '', unit: 'minutes' },
            )
          }
        >
          <TabsList aria-label='Snooze until' variant='segmented'>
            <TabsTab value='date'>Date and time</TabsTab>
            <TabsTab value='duration'>Duration</TabsTab>
          </TabsList>
        </Tabs>
        {input.mode === 'date' ? (
          <div className='flex gap-2'>
            <div className='flex min-w-0 flex-1 flex-col gap-1'>
              <label className='text-xs' htmlFor='snooze-date'>
                Date
              </label>
              <Input
                id='snooze-date'
                type='date'
                value={input.date}
                onChange={(event) => setInput({ ...input, date: event.target.value })}
              />
            </div>
            <div className='flex min-w-0 flex-1 flex-col gap-1'>
              <label className='text-xs' htmlFor='snooze-time'>
                Time
              </label>
              <Input
                id='snooze-time'
                type='time'
                value={input.time}
                onChange={(event) => setInput({ ...input, time: event.target.value })}
              />
            </div>
          </div>
        ) : (
          <div className='flex flex-col gap-2'>
            <label className='text-xs' htmlFor='snooze-amount'>
              Duration
            </label>
            <Input
              id='snooze-amount'
              type='number'
              min='0'
              value={input.amount}
              onChange={(event) => setInput({ ...input, amount: event.target.value })}
            />
            <Tabs
              value={input.unit}
              onValueChange={(unit: typeof input.unit) => setInput({ ...input, unit })}
            >
              <TabsList aria-label='Duration unit' variant='segmented'>
                {(['minutes', 'hours', 'days'] as const).map((unit) => (
                  <TabsTab key={unit} value={unit}>
                    {unit}
                  </TabsTab>
                ))}
              </TabsList>
            </Tabs>
          </div>
        )}
        <DialogFooter>
          <Button variant='outline' disabled={pending} onClick={dismiss}>
            Cancel
          </Button>
          <Button
            disabled={!custom || pending}
            onClick={() => {
              if (custom) void snooze(custom)
            }}
          >
            {pending ? <Spinner /> : null}Snooze until chosen time
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
