import { CheckIcon, CopyIcon } from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

const COPIED_FOR_MS = 1200

/** Copies a block's source. Sits in a code or diagram header next to the other actions. */
export function MarkdownCopyButton({
  label,
  text,
}: {
  readonly label: string
  readonly text: string
}) {
  const [copied, setCopied] = useState(false)
  const resetTimer = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (resetTimer.current !== null) window.clearTimeout(resetTimer.current)
    }
  }, [])

  async function handleCopy() {
    if (!navigator.clipboard?.writeText) {
      toast.error('Clipboard is unavailable')
      return
    }

    try {
      await navigator.clipboard.writeText(text)
    } catch {
      toast.error('Could not copy')
      return
    }

    setCopied(true)
    if (resetTimer.current !== null) window.clearTimeout(resetTimer.current)
    resetTimer.current = window.setTimeout(() => setCopied(false), COPIED_FOR_MS)
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label={copied ? 'Copied' : label}
            data-markdown='copy-button'
            size='icon-xs'
            type='button'
            variant='ghost'
            onClick={() => void handleCopy()}
          />
        }
      >
        {copied ? (
          <CheckIcon className='size-(--icon-size-sm)' />
        ) : (
          <CopyIcon className='size-(--icon-size-sm)' />
        )}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}
