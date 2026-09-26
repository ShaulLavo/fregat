import { MagnifyingGlassIcon } from '@phosphor-icons/react'
import { useIsMutating } from '@tanstack/react-query'
import type { ScopedSessionRef } from '@workspace/contracts'
import { Button } from '@workspace/ui/components/button'
import { Popover, PopoverContent, PopoverTrigger } from '@workspace/ui/components/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import { useState } from 'react'

import { ReviewForm } from '@/features/chat/components/review-form'
import { useAgentReview } from '@/features/chat/hooks/use-agent-review'
import { chatMutationKeys } from '@/features/chat/utils/mutation-keys'

/** Asks an agent, the session's or another model, to review changes in this checkout. */
export function ReviewButton({
  rootPath,
  sessionRef,
}: {
  readonly rootPath: string
  readonly sessionRef: ScopedSessionRef
}) {
  const [open, setOpen] = useState(false)
  const review = useAgentReview(sessionRef.environmentId, rootPath)
  const busy =
    useIsMutating({
      mutationKey: chatMutationKeys.agentReview(sessionRef.environmentId, rootPath),
    }) > 0

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <Button
                  aria-label='Review changes'
                  className='text-muted-foreground hover:text-foreground shrink-0'
                  size='icon-sm'
                  type='button'
                  variant='ghost'
                >
                  <MagnifyingGlassIcon className='size-(--icon-size)' />
                </Button>
              }
            />
          }
        />
        <TooltipContent>{busy ? 'Reviewing…' : 'Review changes'}</TooltipContent>
      </Tooltip>
      <PopoverContent align='end' className='w-80 p-0 text-xs'>
        <p className='section-label px-(--density-row-padding-x) pt-(--density-popover-padding)'>
          Review changes
        </p>
        <ReviewForm
          busy={busy}
          sessionId={sessionRef.sessionId}
          onStart={(request) => {
            setOpen(false)
            review.mutate(request)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}
