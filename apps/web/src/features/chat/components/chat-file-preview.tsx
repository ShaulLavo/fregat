import { isPdfFile } from '@/lib/pdf-viewer/format'
import { PdfPresentation } from '@/components/pdf-viewer/presentation'
import { use, useEffect, useState } from 'react'
import { useStore } from 'zustand'
import { useMutation, useQuery, type QueryClient } from '@tanstack/react-query'
import { Button } from '@workspace/ui/components/button'
import { Dialog, DialogContent, DialogTitle } from '@workspace/ui/components/dialog'
import { Spinner } from '@workspace/ui/components/spinner'
import { formatSize } from '@/lib/path-formatters'
import {
  acquireAttachmentText,
  attachmentFileUrl,
  attachmentTextOptions,
  canPreviewAttachmentText,
} from '../utils/attachment-file'
import { FixWithAgentButton } from '@/components/fix-with-agent-button'
import { errorMessage } from '@/lib/error-message'
import { chatMutationKeys } from '../utils/mutation-keys'
import { FileOpenIntentContext } from '@/lib/file-open-intent/providers/context'
import { useApplicationRuntime } from '@/hooks/use-application-runtime'
import { attachmentPreviewMutationOptions } from '@/lib/file-preview/utils/source'

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
  const application = useApplicationRuntime()
  const capability =
    use(FileOpenIntentContext)?.previewSource ?? application.getSnapshot().editor.previewSource
  const adoption = useMutation(
    attachmentPreviewMutationOptions(capability, queryClient),
    queryClient,
  )
  const url = attachmentFileUrl(attachment, origin)
  const pdf = isPdfFile(attachment.name, attachment.mimeType)
  const previewable = !pdf && canPreviewAttachmentText(attachment)
  const options = attachmentTextOptions(input)
  const staged = input.provenance === 'staged'
  const preview = useQuery(
    { ...options, enabled: previewable && !staged, subscribed: !staged },
    queryClient,
  )
  const acquisition = useMutation(
    {
      mutationKey: chatMutationKeys.attachmentPreview(options.queryKey),
      networkMode: 'always',
      mutationFn: (request: {
        input: typeof input
        queryClient: QueryClient
        signal: AbortSignal
      }) => acquireAttachmentText(request.input, request.queryClient, request.signal),
    },
    queryClient,
  )
  const { mutate } = acquisition
  useEffect(() => {
    if (!previewable || !staged) return
    const controller = new AbortController()
    mutate({ input, queryClient, signal: controller.signal })
    return () => controller.abort()
  }, [input, queryClient, previewable, staged, mutate])
  const [held, setHeld] = useState<{
    input: typeof input
    queryClient: QueryClient
    capture: NonNullable<typeof preview.data> | null
  }>({ input, queryClient, capture: null })
  const sameOwner = held.input === input && held.queryClient === queryClient
  const currentAcquisition =
    acquisition.variables?.input === input && acquisition.variables.queryClient === queryClient
  const stagedCapture = currentAcquisition ? acquisition.data : null
  const sentCapture = sameOwner ? held.capture : null
  const capture = staged ? stagedCapture : sentCapture
  const currentAdoption = Boolean(
    adoption.variables &&
    adoption.variables.input === capture &&
    adoption.variables.expected.attachment === attachment,
  )
  const binding = currentAdoption ? adoption.data : null
  const sourceRead = useStore(capability.store, (state) =>
    binding?.lease
      ? (state.previewSources.get(binding.lease) ?? binding.lease.read())
      : (binding?.read ?? null),
  )
  let displayCapture = sourceRead?.kind === 'attachment' ? sourceRead.input : null
  if (!sourceRead && capture?.kind === 'attachment' && (!currentAdoption || adoption.isPending))
    displayCapture = capture
  const { mutate: adopt } = adoption
  useEffect(() => {
    if (capture?.kind !== 'attachment') return
    const controller = new AbortController()
    adopt({ input: capture, expected: { ...input, url }, signal: controller.signal })
    return () => controller.abort()
  }, [capture, input, url, queryClient, capability, adopt])
  if (!sameOwner) setHeld({ input, queryClient, capture: null })
  const acquired = preview.isSuccess && !staged && !preview.isFetching
  if (!capture && acquired) setHeld({ input, queryClient, capture: preview.data })
  const admissionFailed = currentAdoption && adoption.isError
  const failed =
    admissionFailed || (staged ? currentAcquisition && acquisition.isError : preview.isError)
  const failure =
    (admissionFailed ? adoption.error : null) ?? (staged ? acquisition.error : preview.error)
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
        {previewable &&
          !displayCapture &&
          (!capture || (capture.kind === 'attachment' && !sourceRead)) &&
          !failed && <Spinner size='lg' label='Loading file preview' />}
        {previewable && !displayCapture && failed && (
          <div className='text-destructive text-xs' role='alert'>
            Could not load this file.{' '}
            <Button
              size='xs'
              variant='ghost'
              onClick={() => {
                if (!staged) {
                  void preview.refetch()
                  return
                }
                if (currentAcquisition && acquisition.variables) mutate(acquisition.variables)
              }}
            >
              Retry
            </Button>
            <FixWithAgentButton
              error={{
                message: errorMessage(failure, 'Could not load this file.'),
                title: `Preview of ${attachment.name}`,
              }}
            />
          </div>
        )}
        {previewable && displayCapture && (
          <pre
            className='bg-muted max-h-96 overflow-auto overscroll-contain p-3 text-xs whitespace-pre-wrap'
            data-chat-file-preview
          >
            {displayCapture.reader.readRange(0, displayCapture.reader.length)}
          </pre>
        )}
        {!pdf &&
          (!previewable ||
            (capture && capture.kind !== 'attachment') ||
            (sourceRead && sourceRead.kind !== 'attachment')) && (
            <p className='text-muted-foreground text-xs'>
              Download this file to view its contents.
            </p>
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
