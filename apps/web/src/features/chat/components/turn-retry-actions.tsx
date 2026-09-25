import { ArrowClockwiseIcon, ArrowRightIcon } from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'

import { useChatTimelineActions } from '../hooks/use-chat-timeline-actions'

export function TurnRetryActions() {
  const { retry } = useChatTimelineActions()

  return (
    <div className='flex items-center gap-1.5 px-1'>
      <Button
        disabled={retry.blocked}
        onClick={retry.carryOn}
        size='sm'
        type='button'
        variant='outline'
      >
        <ArrowRightIcon aria-hidden='true' className='size-(--icon-size)' />
        Carry on
      </Button>
      {retry.tryAgain ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                disabled={retry.blocked}
                focusableWhenDisabled
                onClick={retry.tryAgain}
                size='sm'
                type='button'
                variant='ghost'
              >
                <ArrowClockwiseIcon aria-hidden='true' className='size-(--icon-size)' />
                Try again
              </Button>
            }
          />
          <TooltipContent>
            Sends your message again. The stopped answer stays in the agent's context.
          </TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  )
}
