import { ArrowUpIcon, StopIcon } from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import { cn } from '@workspace/ui/lib/utils'
import { Spinner } from '@workspace/ui/components/spinner'
import { forwardRef } from 'react'
import {
  composerSubmitAction,
  type ComposerPendingAction,
} from '@/features/chat/utils/composer-state'

export const ChatInputSubmitButton = forwardRef<HTMLButtonElement, ChatInputSubmitButtonProps>(
  function ChatInputSubmitButton(
    { busy, disabled, disabledReason, onStop, onSubmit, pendingAction, sendDisabled },
    ref,
  ) {
    const action = composerSubmitAction({ busy, disabledReason, pendingAction })
    const { label } = action

    async function handleClick() {
      if (busy) {
        onStop()
        return
      }

      await onSubmit()
    }

    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              aria-label={label}
              className={cn(
                'compact:size-6 size-7 rounded-lg transition-colors',
                'bg-primary text-primary-foreground hover:bg-primary/90',
                // Disabled is driven imperatively on the DOM node by the draft plugin,
                // so the idle/ready look must key off :disabled, not a React prop.
                'disabled:bg-muted disabled:text-muted-foreground/50 disabled:opacity-100',
              )}
              disabled={
                action.kind === 'pending' ||
                (busy ? disabled || disabledReason !== null : sendDisabled)
              }
              ref={ref}
              size='icon-sm'
              title={label}
              type='button'
              variant='ghost'
              onClick={handleClick}
            />
          }
        >
          {action.kind === 'pending' ? <Spinner aria-hidden='true' className='size-4' /> : null}
          {action.kind === 'stop' ? (
            <StopIcon aria-hidden='true' className='size-4' weight='fill' />
          ) : null}
          {action.kind === 'send' ? <ArrowUpIcon aria-hidden='true' className='size-4' /> : null}
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    )
  },
)

type ChatInputSubmitButtonProps = {
  busy: boolean
  disabled: boolean
  disabledReason: string | null
  pendingAction: ComposerPendingAction
  onStop: () => void
  onSubmit: () => Promise<boolean>
  sendDisabled: boolean
}
