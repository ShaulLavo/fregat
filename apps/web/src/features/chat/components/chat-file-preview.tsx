import { useQuery } from '@tanstack/react-query'
import type { ChatAttachment } from '@workspace/contracts'
import { Button } from '@workspace/ui/components/button'
import { Dialog, DialogContent, DialogTitle } from '@workspace/ui/components/dialog'
import { RingLoader } from '@workspace/ui/components/ring-loader'
import { formatSize } from '@/lib/path-formatters'
import {
  attachmentFileUrl,
  attachmentTextOptions,
  canPreviewAttachmentText,
} from '../utils/attachment-file'
import { FixWithAgentButton } from '@/components/fix-with-agent-button'
import { errorMessage } from '@/lib/error-message'

export function ChatFilePreview({
  attachment,
  origin,
  onClose,
}: {
  attachment: Extract<ChatAttachment, { type: 'file' }>
  origin: string
  onClose: () => void
}) {
  const url = attachmentFileUrl(attachment, origin)
  const previewable = canPreviewAttachmentText(attachment)
  const preview = useQuery({ ...attachmentTextOptions(url), enabled: previewable })
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent>
        <DialogTitle className='truncate' title={attachment.name}>
          {attachment.name}
        </DialogTitle>
        <p className='text-muted-foreground text-xs'>
          {attachment.mimeType} · {formatSize(attachment.sizeBytes)}
        </p>
        {previewable && preview.isPending && <RingLoader aria-label='Loading file preview' />}
        {previewable && preview.isError && (
          <div className='text-destructive text-xs' role='alert'>
            Could not load this file.{' '}
            <Button size='xs' variant='ghost' onClick={() => void preview.refetch()}>
              Retry
            </Button>
            <FixWithAgentButton
              error={{
                message: errorMessage(preview.error, 'Could not load this file.'),
                title: `Preview of ${attachment.name}`,
              }}
            />
          </div>
        )}
        {previewable && preview.isSuccess && (
          <pre
            className='bg-muted max-h-96 overflow-auto p-3 text-xs whitespace-pre-wrap'
            data-chat-file-preview
          >
            {preview.data}
          </pre>
        )}
        {!previewable && (
          <p className='text-muted-foreground text-xs'>Download this file to view its contents.</p>
        )}
        <Button
          role='link'
          render={<a href={url} download={attachment.name} />}
          nativeButton={false}
        >
          Download {attachment.name}
        </Button>
      </DialogContent>
    </Dialog>
  )
}
