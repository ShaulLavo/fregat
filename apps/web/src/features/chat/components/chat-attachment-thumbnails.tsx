import { useQueryClient } from '@tanstack/react-query'
import { originForQueryClient } from '@/lib/environments/state/query-clients'
import { serverEndpoint } from '@/lib/client'
import { useEnvironmentsStore } from '@/lib/environments/state/store'
import type { ChatAttachment } from '@workspace/contracts'
import { Button } from '@workspace/ui/components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import { cn } from '@workspace/ui/lib/utils'
import { useState } from 'react'

import { chatAttachmentImages, unrenderableChatAttachments } from '../utils/attachment-image'
import { ChatImageLightbox } from './chat-image-lightbox'

/**
 * What the user actually sent, in the transcript. A file-name chip proved that
 * an image was attached without ever showing which one; the thumbnail is the
 * only form that survives scrolling back through a long session.
 */
export function ChatAttachmentThumbnails({
  attachments,
  className,
}: {
  attachments: readonly ChatAttachment[]
  className?: string
}) {
  const owner = originForQueryClient(useQueryClient())
  const environment = useEnvironmentsStore((state) => state.entries[owner])
  const origin = serverEndpoint(environment?.origin ?? owner)
  const [openIndex, setOpenIndex] = useState<number | null>(null)
  if (attachments.length === 0) return null

  const images = chatAttachmentImages(attachments, origin)
  const unrenderable = unrenderableChatAttachments(attachments)

  return (
    <div className={cn('flex flex-wrap gap-1.5', className)} data-chat-attachments='true'>
      {images.map((image, index) => (
        <Tooltip key={image.id}>
          <TooltipTrigger
            render={
              <Button
                aria-label={`Open ${image.name}`}
                className='size-16 shrink-0 overflow-hidden'
                data-scroll-anchor-ignore
                size='icon'
                type='button'
                variant='outline'
                onClick={() => setOpenIndex(index)}
              />
            }
          >
            <img
              alt=''
              className='size-full object-cover'
              crossOrigin='anonymous'
              draggable={false}
              src={image.src}
            />
          </TooltipTrigger>
          <TooltipContent>Open {image.name}</TooltipContent>
        </Tooltip>
      ))}
      {unrenderable.map((attachment) => (
        <span
          className='bg-muted text-muted-foreground text-3xs rounded-md px-1.5 py-0.5'
          key={attachment.id}
          title='This image type was not stored, so it cannot be shown.'
        >
          {attachment.name}
        </span>
      ))}
      <ChatImageLightbox images={images} openIndex={openIndex} onOpenIndexChange={setOpenIndex} />
    </div>
  )
}
