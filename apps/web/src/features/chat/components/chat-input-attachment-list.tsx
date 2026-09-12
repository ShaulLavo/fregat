import { XIcon } from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import { useState } from 'react'

import { formatSize } from '@/lib/path-formatters'

import type { ChatInputImageAttachment } from '../state/chat-input-draft-store'
import { stagedAttachmentImages } from '../utils/attachment-image'
import { ChatImageLightbox } from './chat-image-lightbox'

export function ChatInputAttachmentList({
  attachments,
  disabled,
  onRemove,
}: {
  attachments: readonly ChatInputImageAttachment[]
  disabled: boolean
  onRemove: (attachmentId: string) => void
}) {
  const [openIndex, setOpenIndex] = useState<number | null>(null)
  if (attachments.length === 0) return null

  const images = stagedAttachmentImages(attachments)

  return (
    <div className='compact:px-2 compact:pb-1.5 min-w-0 px-3 pb-2'>
      <p className='text-muted-foreground mb-1.5 text-[11px]'>
        Unsent images are kept until you reload this page.
      </p>
      <div className='compact:gap-1.5 flex min-w-0 gap-2 overflow-x-auto'>
        {attachments.map((attachment, index) => (
          <div
            className='border-border/70 bg-muted/35 flex max-w-48 shrink-0 items-center gap-2 rounded-md border p-1 pr-1.5'
            key={attachment.id}
          >
            <button
              aria-label={`Open ${attachment.name}`}
              className='focus-visible:ring-ring size-9 shrink-0 overflow-hidden rounded focus-visible:ring-2 focus-visible:outline-none'
              title={attachment.name}
              type='button'
              onClick={() => setOpenIndex(index)}
            >
              <img
                alt=''
                className='size-full object-cover'
                draggable={false}
                src={attachment.previewUrl}
              />
            </button>
            <span className='min-w-0 flex-1 text-xs'>
              <span className='block truncate font-medium'>{attachment.name}</span>
              <span className='text-muted-foreground block tabular-nums'>
                {formatSize(attachment.sizeBytes)}
              </span>
            </span>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    aria-label={`Remove ${attachment.name}`}
                    className='text-muted-foreground hover:text-foreground rounded-md'
                    disabled={disabled}
                    size='icon-xs'
                    title='Remove attachment'
                    type='button'
                    variant='ghost'
                    onClick={() => onRemove(attachment.id)}
                  />
                }
              >
                <XIcon className='size-3.5' />
              </TooltipTrigger>
              <TooltipContent>Remove attachment</TooltipContent>
            </Tooltip>
          </div>
        ))}
      </div>
      <ChatImageLightbox images={images} openIndex={openIndex} onOpenIndexChange={setOpenIndex} />
    </div>
  )
}
