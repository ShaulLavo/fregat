import { useSettingValue } from '@/hooks/use-setting-value'
import { ArrowUpIcon, StopIcon } from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import { OrbitLoader } from '@workspace/ui/components/orbit-loader'
import {
  selectChatInputDraftHasContent,
  useChatInputDraftStore,
  type ChatInputDraftTarget,
} from '../state/chat-input-draft-store'
import {
  composerSubmitAction,
  type ComposerPendingAction,
} from '@/features/chat/utils/composer-state'

export function ChatInputSubmitButton({
  busy,
  draftTarget,
  correctionDisabledReason = null,
  disabled,
  disabledReason,
  onStop,
  onSubmit,
  pendingAction,
  sendDisabled,
}: ChatInputSubmitButtonProps) {
  const followUpBehavior = useSettingValue('chat.followUpBehavior')
  const followUpLabel = followUpBehavior === 'queue' ? 'Queue message' : 'Send correction'
  const hasContent = useChatInputDraftStore((state) =>
    selectChatInputDraftHasContent(state, draftTarget),
  )
  const action = composerSubmitAction({ busy: false, disabledReason, pendingAction })
  const label =
    correctionDisabledReason ??
    (busy && action.kind === 'send' && !disabledReason ? followUpLabel : action.label)

  async function handleClick() {
    await onSubmit()
  }

  return (
    <>
      {busy ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                aria-label='Stop current turn'
                disabled={disabledReason !== null || pendingAction === 'stopping'}
                focusableWhenDisabled
                size='icon-sm'
                type='button'
                variant='outline'
                onClick={onStop}
              >
                <StopIcon aria-hidden='true' className='size-(--icon-size)' weight='fill' />
              </Button>
            }
          />{' '}
          <TooltipContent>{'Stop current turn'}</TooltipContent>
        </Tooltip>
      ) : null}
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              aria-label={label}
              className='aria-disabled:bg-muted aria-disabled:text-muted-foreground aria-disabled:opacity-100'
              disabled={
                action.kind === 'pending' ||
                disabled ||
                sendDisabled ||
                !hasContent ||
                disabledReason !== null ||
                correctionDisabledReason !== null
              }
              focusableWhenDisabled
              size='icon-sm'
              type='button'
              onClick={handleClick}
            />
          }
        >
          {action.kind === 'pending' ? <OrbitLoader aria-hidden='true' /> : null}
          {action.kind === 'stop' ? (
            <StopIcon aria-hidden='true' className='size-(--icon-size)' weight='fill' />
          ) : null}
          {action.kind === 'send' ? (
            <ArrowUpIcon aria-hidden='true' className='size-(--icon-size)' />
          ) : null}
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </>
  )
}

type ChatInputSubmitButtonProps = {
  draftTarget: ChatInputDraftTarget
  busy: boolean
  correctionDisabledReason?: string | null
  disabled: boolean
  disabledReason: string | null
  pendingAction: ComposerPendingAction
  onStop: () => void
  onSubmit: () => Promise<boolean>
  sendDisabled: boolean
}
