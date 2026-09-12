import { useState, type ComponentProps } from 'react'
import { Button } from '@workspace/ui/components/button'
import { ChatImageLightbox } from '@/features/chat/components/chat-image-lightbox'
import { chatImageCrossOrigin } from '@/features/chat/utils/attachment-image'

export function AssistantMarkdownImage({ src, alt = '', title }: ComponentProps<'img'>) {
  const [failedSource, setFailedSource] = useState<string | null>(null)
  const [openIndex, setOpenIndex] = useState<number | null>(null)
  const source = typeof src === 'string' ? src : null
  const name = alt || title || 'Image'
  if (!source || failedSource === source) {
    return (
      <span className='text-muted-foreground text-xs' role='img' aria-label={name}>
        {name} · Image unavailable
      </span>
    )
  }

  return (
    <>
      <Button
        aria-label={`Open ${name}`}
        data-markdown-image='true'
        className='h-auto max-w-full overflow-hidden p-0'
        variant='ghost'
        type='button'
        onClick={() => setOpenIndex(0)}
      >
        <img
          alt={alt}
          className='max-h-[30rem] max-w-full object-contain'
          crossOrigin={chatImageCrossOrigin(source)}
          loading='lazy'
          onError={() => setFailedSource(source)}
          src={source}
          title={title}
        />
      </Button>
      <ChatImageLightbox
        images={[
          {
            id: source,
            name,
            src: source,
            sizeBytes: null,
            crossOrigin: chatImageCrossOrigin(source),
          },
        ]}
        openIndex={openIndex}
        onOpenIndexChange={setOpenIndex}
      />
    </>
  )
}
