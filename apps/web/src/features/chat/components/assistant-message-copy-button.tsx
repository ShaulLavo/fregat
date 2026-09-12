import { Button } from '@workspace/ui/components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import { cn } from '@workspace/ui/lib/utils'
import { CheckIcon, CopyIcon } from '@phosphor-icons/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { codexFileCitationsMarkdown } from '@/features/chat/utils/codex-file-citations'

export function AssistantMessageCopyButton({
  className,
  text,
}: {
  className?: string
  text: string
}) {
  const [copied, setCopied] = useState(false)
  const resetTimerRef = useRef<number | null>(null)

  const handleCopy = useCallback(() => {
    void copyAssistantMessageText(text, () => {
      setCopied(true)
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current)
      }
      resetTimerRef.current = window.setTimeout(() => setCopied(false), 1200)
    })
  }, [text])

  useEffect(() => {
    return () => {
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current)
      }
    }
  }, [])

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            aria-label={copied ? 'Copied response' : 'Copy response'}
            className={cn(
              'border-border/50 bg-background/35 text-muted-foreground/45 shadow-none hover:border-border/70 hover:bg-background/55 hover:text-muted-foreground/70',
              className,
            )}
            size='icon-xs'
            type='button'
            variant='outline'
            onClick={handleCopy}
          />
        }
      >
        {copied ? <CheckIcon className='size-3' /> : <CopyIcon className='size-3' />}
      </TooltipTrigger>
      <TooltipContent>Copy to clipboard</TooltipContent>
    </Tooltip>
  )
}

async function copyAssistantMessageText(text: string, onCopied: () => void) {
  if (!navigator.clipboard?.writeText) {
    toast.error('Clipboard is unavailable')
    return
  }

  try {
    await navigator.clipboard.writeText(codexFileCitationsMarkdown(text))
    onCopied()
  } catch {
    toast.error('Could not copy response')
  }
}
