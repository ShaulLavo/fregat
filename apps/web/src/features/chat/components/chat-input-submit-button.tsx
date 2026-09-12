import { ArrowUpIcon, StopIcon } from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import { Spinner } from '@workspace/ui/components/spinner'
import { forwardRef } from 'react'
import {
  composerSubmitAction,
  type ComposerPendingAction,
} from '@/features/chat/utils/composer-state'

export const ChatInputSubmitButton = forwardRef<HTMLButtonElement, ChatInputSubmitButtonProps>(
  function ChatInputSubmitButton(
    {
      busy,
      correctionDisabledReason = null,
      disabled,
      disabledReason,
      onStop,
      onSubmit,
      pendingAction,
      sendDisabled,
    },
    ref,
  ) {
    const action = composerSubmitAction({ busy: false, disabledReason, pendingAction })
    const label =
      correctionDisabledReason ??
      (busy && action.kind === 'send' && !disabledReason ? 'Send correction' : action.label)

    async function handleClick() {
      await onSubmit()
    }

    return (
      <>
        {busy ? (
          <Button
            aria-label='Stop current turn'
            title='Stop current turn'
            disabled={disabledReason !== null || pendingAction === 'stopping'}
            size='icon-sm'
            type='button'
            variant='outline'
            onClick={onStop}
          >
            <StopIcon aria-hidden='true' className='size-4' weight='fill' />
          </Button>
        ) : null}
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                aria-label={label}
                // Disabled is driven imperatively on the DOM node by the draft plugin,
                // so the idle/ready look must key off :disabled, not a React prop.
                className='disabled:bg-muted disabled:text-muted-foreground/50 disabled:opacity-100'
                disabled={
                  action.kind === 'pending' ||
                  disabled ||
                  sendDisabled ||
                  disabledReason !== null ||
                  correctionDisabledReason !== null
                }
                ref={ref}
                size='icon-sm'
                title={label}
                type='button'
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
      </>
    )
  },
)

type ChatInputSubmitButtonProps = {
  busy: boolean
  correctionDisabledReason?: string | null
  disabled: boolean
  disabledReason: string | null
  pendingAction: ComposerPendingAction
  onStop: () => void
  onSubmit: () => Promise<boolean>
  sendDisabled: boolean
}
