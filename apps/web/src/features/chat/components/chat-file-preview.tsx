import { isPdfFile } from '@/lib/pdf-viewer/format'
import { PdfPresentation } from '@/components/pdf-viewer/presentation'
import { useState } from 'react'
import { useQuery, type QueryClient } from '@tanstack/react-query'
import { Button } from '@workspace/ui/components/button'
import { Dialog, DialogContent, DialogTitle } from '@workspace/ui/components/dialog'
import { Spinner } from '@workspace/ui/components/spinner'
import { formatSize } from '@/lib/path-formatters'
import {
  attachmentFileUrl,
  attachmentTextOptions,
  canPreviewAttachmentText,
} from '../utils/attachment-file'
import { FixWithAgentButton } from '@/components/fix-with-agent-button'
import { errorMessage } from '@/lib/error-message'

export function ChatFilePreview({
  input,
  queryClient,
  onClose,
}: {
  input: Parameters<typeof attachmentTextOptions>[0]
  queryClient: QueryClient
  onClose: () => void
}) {
  const { attachment, origin } = input
  const url = attachmentFileUrl(attachment, origin)
  const pdf = isPdfFile(attachment.name, attachment.mimeType)
  const previewable = !pdf && canPreviewAttachmentText(attachment)
  const preview = useQuery(
    {
      ...attachmentTextOptions(input),
      enabled: previewable,
      refetchOnMount: input.provenance === 'staged' ? 'always' : true,
    },
    queryClient,
  )
  const [held, setHeld] = useState<{
    input: typeof input
    queryClient: QueryClient
    capture: NonNullable<typeof preview.data> | null
  }>({ input, queryClient, capture: null })
  const sameOwner = held.input === input && held.queryClient === queryClient
  const capture = sameOwner ? held.capture : null
  if (!sameOwner) setHeld({ input, queryClient, capture: null })
  const acquired =
    preview.isSuccess &&
    (input.provenance === 'sent' || preview.isFetchedAfterMount) &&
    !preview.isFetching
  if (!capture && acquired) setHeld({ input, queryClient, capture: preview.data })
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
        {pdf && (
          <div className='flex h-[65dvh] min-h-0 flex-col overflow-hidden'>
            <PdfPresentation source={{ kind: 'attachment', origin, attachment }} />
          </div>
        )}
        {previewable && !capture && !preview.isError && (
          <Spinner size='lg' label='Loading file preview' />
        )}
        {previewable && !capture && preview.isError && (
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
        {previewable && capture?.kind === 'attachment' && (
          <pre
            className='bg-muted max-h-96 overflow-auto overscroll-contain p-3 text-xs whitespace-pre-wrap'
            data-chat-file-preview
          >
            {capture.reader.readRange(0, capture.reader.length)}
          </pre>
        )}
        {!pdf && (!previewable || (capture && capture.kind !== 'attachment')) && (
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
