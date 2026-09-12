import { CaretLeftIcon, CaretRightIcon } from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'
import { Dialog, DialogContent, DialogTitle } from '@workspace/ui/components/dialog'
import type { KeyboardEvent } from 'react'

import { formatSize } from '@/lib/path-formatters'

import type { ChatAttachmentImage } from '../utils/attachment-image'

/**
 * Full-size view of one attachment, with arrow-key paging through the rest of
 * the batch it was sent in. Stateless on purpose: the composer and the
 * transcript each own which of their own images is open.
 */
export function ChatImageLightbox({
  images,
  openIndex,
  onOpenIndexChange,
}: {
  images: readonly ChatAttachmentImage[]
  onOpenIndexChange: (index: number | null) => void
  openIndex: number | null
}) {
  const index = openIndex ?? -1
  const image = images[index]
  if (!image) return null

  function step(delta: number) {
    if (images.length < 2) return

    onOpenIndexChange((index + delta + images.length) % images.length)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'ArrowRight') step(1)
    if (event.key === 'ArrowLeft') step(-1)
  }

  return (
    <Dialog open onOpenChange={(open) => onOpenIndexChange(open ? index : null)}>
      <DialogContent
        className='max-w-[min(92vw,72rem)] sm:max-w-[min(92vw,72rem)]'
        onKeyDown={handleKeyDown}
      >
        <DialogTitle className='truncate pr-8 text-xs'>{image.name}</DialogTitle>
        <img
          alt={image.name}
          className='max-h-[78vh] w-full object-contain'
          crossOrigin={image.crossOrigin}
          draggable={false}
          src={image.src}
        />
        <div className='text-muted-foreground text-2xs flex items-center justify-between gap-(--density-control-gap)'>
          {image.sizeBytes !== null ? (
            <span className='tabular-nums'>{formatSize(image.sizeBytes)}</span>
          ) : null}
          {images.length > 1 ? (
            <span className='flex items-center gap-(--density-control-gap)'>
              <Button
                aria-label='Previous image'
                size='icon-xs'
                type='button'
                variant='ghost'
                onClick={() => step(-1)}
              >
                <CaretLeftIcon className='size-3.5' />
              </Button>
              <span className='tabular-nums'>
                {index + 1} / {images.length}
              </span>
              <Button
                aria-label='Next image'
                size='icon-xs'
                type='button'
                variant='ghost'
                onClick={() => step(1)}
              >
                <CaretRightIcon className='size-3.5' />
              </Button>
            </span>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
