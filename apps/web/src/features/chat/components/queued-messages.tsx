import type { QueuedFollowUp } from '../state/follow-up-store'
import { QueuedMessageRow } from './queued-message-row'

export function QueuedMessages({
  messages,
  disabled,
  onSendNow,
  onRestore,
}: {
  messages: readonly QueuedFollowUp[]
  disabled: boolean
  onSendNow: (id: string) => void
  onRestore: (id: string) => void
}) {
  if (!messages.length) return null
  return (
    <section
      aria-label='Queued messages'
      className='mx-auto flex w-full max-w-3xl flex-col gap-1 px-(--density-control-padding-x)'
    >
      <p className='text-muted-foreground text-xs'>
        Queued messages <span className='tabular-nums'>{messages.length}</span>
      </p>
      {messages.map((message) => (
        <QueuedMessageRow
          key={message.id}
          message={message}
          disabled={disabled}
          onSendNow={onSendNow}
          onRestore={onRestore}
        />
      ))}
    </section>
  )
}
