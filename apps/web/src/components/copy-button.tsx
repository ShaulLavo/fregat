import { CheckIcon, CopyIcon } from '@phosphor-icons/react'
import { useMutation } from '@tanstack/react-query'
import { Button } from '@workspace/ui/components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import { useEffect, useState } from 'react'

import { copyTextMutationOptions } from '@/lib/clipboard'

const COPIED_FOR_MS = 1200

/**
 * Inline copy: the icon turns into a check for a moment instead of raising a
 * toast. Failure still toasts, from the shared mutation.
 */
export function CopyButton({
  className,
  label,
  text,
  variant = 'ghost',
}: {
  readonly className?: string
  /** The payload's name: the button reads "Copy {label}", then "Copied {label}". */
  readonly label: string
  readonly text: string
  readonly variant?: 'ghost' | 'outline'
}) {
  const copy = useMutation(copyTextMutationOptions())
  // Counts successes so a repeat copy restarts the confirmation timer.
  const [copies, setCopies] = useState(0)
  const copied = copies > 0
  const name = copied ? `Copied ${label}` : `Copy ${label}`

  useEffect(() => {
    if (copies === 0) return
    const timer = window.setTimeout(() => setCopies(0), COPIED_FOR_MS)
    return () => window.clearTimeout(timer)
  }, [copies])

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label={name}
            className={className}
            size='icon-xs'
            type='button'
            variant={variant}
            onClick={() =>
              copy.mutate({ label, text }, { onSuccess: () => setCopies((count) => count + 1) })
            }
          />
        }
      >
        {copied ? (
          <CheckIcon className='size-(--icon-size-sm)' />
        ) : (
          <CopyIcon className='size-(--icon-size-sm)' />
        )}
      </TooltipTrigger>
      <TooltipContent>{name}</TooltipContent>
    </Tooltip>
  )
}
