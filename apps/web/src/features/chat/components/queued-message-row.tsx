import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import { Button } from '@workspace/ui/components/button'
import { ListRow } from '@workspace/ui/patterns/list-row'
import type { QueuedFollowUp } from '../state/follow-up-store'

export function QueuedMessageRow({
  message,
  disabled,
  onSendNow,
  onRestore,
}: {
  message: QueuedFollowUp
  disabled: boolean
  onSendNow: (id: string) => void
  onRestore: (id: string) => void
}) {
  const uncertain = message.held && message.submission !== null
  const heldLabel = uncertain ? 'Delivery unconfirmed' : 'Held'
  const label =
    message.content.prompt ||
    message.content.attachments.map((item) => item.name).join(', ') ||
    'Terminal context'
  return (
    <ListRow interactive={false} className='bg-muted gap-2' title={label}>
      <span className='min-w-0 flex-1 truncate text-xs'>{label}</span>
      {message.content.attachments.length ? (
        <span className='text-muted-foreground text-2xs shrink-0 tabular-nums'>
          {message.content.attachments.length} attached
        </span>
      ) : null}
      {message.held ? (
        <span className='text-muted-foreground text-2xs shrink-0'>{heldLabel}</span>
      ) : null}
      <Button
        aria-label={uncertain ? 'Retry queued message delivery' : 'Send queued message now'}
        size='xs'
        variant='ghost'
        disabled={disabled}
        onClick={() => onSendNow(message.id)}
      >
        {uncertain ? 'Retry delivery' : 'Send now'}
      </Button>
      <Tooltip disabled={!uncertain}>
        <TooltipTrigger
          render={
            <Button
              aria-label='Restore queued message'
              size='xs'
              variant='ghost'
              disabled={uncertain}
              focusableWhenDisabled
              onClick={() => onRestore(message.id)}
            >
              Restore
            </Button>
          }
        />
        <TooltipContent>
          Retry delivery to confirm whether this message was sent before restoring it.
        </TooltipContent>
      </Tooltip>
    </ListRow>
  )
}
