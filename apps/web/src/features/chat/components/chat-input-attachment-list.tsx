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
    <div
      aria-label='Image attachments'
      className='flex min-w-0 gap-(--density-control-gap) overflow-x-auto px-(--density-control-padding-x) pb-(--density-section-gap)'
      role='group'
    >
      {attachments.map((attachment, index) => (
        <div
          className='bg-muted/35 flex max-w-48 shrink-0 items-center gap-2 rounded-md p-1 pr-1.5'
          key={attachment.id}
        >
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  aria-label={`Open ${attachment.name}`}
                  className='size-9 shrink-0 overflow-hidden'
                  size='icon'
                  type='button'
                  variant='ghost'
                  onClick={() => setOpenIndex(index)}
                />
              }
            >
              <img
                alt=''
                className='size-full object-cover'
                draggable={false}
                src={attachment.previewUrl}
              />
            </TooltipTrigger>
            <TooltipContent>Open {attachment.name}</TooltipContent>
          </Tooltip>
          {/* Not on the chip: its remove button is a Tooltip control (D4). */}
          <span className='min-w-0 flex-1 text-xs' title={attachment.name}>
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
                  className='text-muted-foreground'
                  disabled={disabled}
                  focusableWhenDisabled
                  size='icon-xs'
                  type='button'
                  variant='ghost'
                  onClick={() => onRemove(attachment.id)}
                />
              }
            >
              <XIcon className='size-(--icon-size-sm)' />
            </TooltipTrigger>
            <TooltipContent>Remove attachment</TooltipContent>
          </Tooltip>
        </div>
      ))}
      <ChatImageLightbox images={images} openIndex={openIndex} onOpenIndexChange={setOpenIndex} />
    </div>
  )
}
