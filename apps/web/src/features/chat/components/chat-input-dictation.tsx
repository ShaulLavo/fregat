import { CheckIcon, MicrophoneIcon, XIcon } from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import type { useVoiceInput } from '../hooks/use-voice-input'

export function ChatInputDictation({
  voice,
  disabled,
}: {
  readonly voice: ReturnType<typeof useVoiceInput>
  readonly disabled: boolean
}) {
  if (!voice.supported) return null
  if (voice.pending) {
    const finishing = voice.phase !== 'recording'
    return (
      <>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                aria-label='Cancel dictation'
                onClick={voice.cancel}
                size='icon-sm'
                type='button'
                variant='ghost'
              >
                <XIcon className='size-(--icon-size-sm)' />
              </Button>
            }
          />
          <TooltipContent>Cancel dictation</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                aria-label='Finish dictation'
                aria-busy={finishing}
                focusableWhenDisabled
                disabled={finishing}
                onClick={voice.finish}
                size='icon-sm'
                type='button'
                variant='secondary'
              >
                <CheckIcon className='size-(--icon-size-sm)' />
              </Button>
            }
          />
          <TooltipContent>Finish dictation</TooltipContent>
        </Tooltip>
      </>
    )
  }
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label='Start dictation'
            focusableWhenDisabled
            disabled={disabled || voice.anyPending}
            onClick={voice.start}
            size='icon-sm'
            type='button'
            variant='ghost'
          >
            <MicrophoneIcon className='size-(--icon-size-sm)' />
          </Button>
        }
      />
      <TooltipContent>Start dictation</TooltipContent>
    </Tooltip>
  )
}
