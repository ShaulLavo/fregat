import { XIcon, FileIcon } from '@phosphor-icons/react'
import { Spinner } from '@workspace/ui/components/spinner'
import { Button } from '@workspace/ui/components/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import { useState } from 'react'

import { formatSize } from '@/lib/path-formatters'

import type { ChatInputAttachment } from '../state/chat-input-draft-store'
import { stagedAttachmentImages } from '../utils/attachment-image'
import { ChatImageLightbox } from './chat-image-lightbox'
import { ChatFilePreview } from './chat-file-preview'
import type { ChatAttachment } from '@workspace/contracts'

export function ChatInputAttachmentList({
  attachments,
  disabled,
  onRemove,
  onRetry,
}: {
  attachments: readonly ChatInputAttachment[]
  disabled: boolean
  onRemove: (attachmentId: string) => void
  onRetry?: (attachmentId: string) => void
}) {
  const [openIndex, setOpenIndex] = useState<number | null>(null)
  const [openFile, setOpenFile] = useState<{
    attachment: Extract<ChatAttachment, { type: 'file' }>
    origin: string
  } | null>(null)
  if (attachments.length === 0) return null

  const images = stagedAttachmentImages(
    attachments.filter((attachment) => attachment.type === 'image'),
  )

  return (
    <div
      aria-label='Attachments'
      className='flex min-w-0 gap-(--density-control-gap) overflow-x-auto px-(--density-control-padding-x) pb-(--density-section-gap)'
      role='group'
    >
      {attachments.map((attachment) => (
        <div
          className='bg-muted/35 flex max-w-48 shrink-0 items-center gap-2 rounded-md p-1 pr-1.5'
          key={attachment.id}
        >
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  aria-label={`Open ${attachment.name}`}
                  focusableWhenDisabled
                  className='size-9 shrink-0 overflow-hidden'
                  size='icon'
                  type='button'
                  variant='ghost'
                  disabled={
                    attachment.upload?.status === 'uploading' ||
                    attachment.upload?.status === 'failed'
                  }
                  onClick={() => {
                    if (attachment.type !== 'file') {
                      setOpenIndex(images.findIndex((image) => image.id === attachment.id))
                      return
                    }
                    if (
                      attachment.upload?.status !== 'ready' ||
                      attachment.upload.attachment.type !== 'file'
                    )
                      return
                    setOpenFile({
                      attachment: attachment.upload.attachment,
                      origin: attachment.previewUrl.slice(
                        0,
                        attachment.previewUrl.lastIndexOf('/attachments/'),
                      ),
                    })
                  }}
                />
              }
            >
              {attachment.type === 'file' || !attachment.previewUrl ? (
                <FileIcon className='size-(--icon-size)' />
              ) : (
                <img
                  alt=''
                  className='size-full object-cover'
                  crossOrigin='anonymous'
                  draggable={false}
                  src={attachment.previewUrl}
                />
              )}
            </TooltipTrigger>
            <TooltipContent>Open {attachment.name}</TooltipContent>
          </Tooltip>
          {/* Not on the chip: its remove button is a Tooltip control (D4). */}
          <span className='min-w-0 flex-1 text-xs' title={attachment.name}>
            <span className='block truncate font-medium'>{attachment.name}</span>
            <span className='text-muted-foreground block font-mono tabular-nums'>
              {formatSize(attachment.sizeBytes)}
            </span>
            {attachment.upload?.status === 'uploading' && (
              <span className='text-muted-foreground flex items-center gap-1'>
                <Spinner size='xs' />
                {Math.round(attachment.upload.progress * 100)}%
              </span>
            )}
            {attachment.upload?.status === 'failed' && (
              <span className='text-destructive block' title={attachment.upload.message}>
                Upload failed
              </span>
            )}
          </span>
          {attachment.upload?.status === 'failed' && onRetry && (
            <Button size='xs' variant='ghost' onClick={() => onRetry(attachment.id)}>
              Retry {attachment.name}
            </Button>
          )}
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
      {openFile && (
        <ChatFilePreview
          attachment={openFile.attachment}
          origin={openFile.origin}
          onClose={() => setOpenFile(null)}
        />
      )}
    </div>
  )
}
