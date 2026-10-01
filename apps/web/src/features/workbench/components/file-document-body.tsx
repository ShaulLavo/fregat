import { isPdfFile } from '@/lib/pdf-viewer/format'
import { PdfFile } from '@/components/pdf-viewer/file'
import type { ComponentProps } from 'react'
import { Spinner } from '@workspace/ui/components/spinner'
import { EmptyState } from '@workspace/ui/components/empty-state'
import { filesystemPath } from '@/lib/documents/utils/identity'
import { clientErrorMessage } from '@/lib/client-error-taxonomy'
import { useOversizedFileFacts } from '@/features/workbench/hooks/use-oversized-file-facts'
import { FileEditorBody } from '@/features/workbench/components/file-editor-body'
import { FileFacts } from '@/features/workbench/components/file-facts'

export function FileDocumentBody(props: ComponentProps<typeof FileEditorBody>) {
  const { fileState, fileVersion, target } = props
  const pdf = target.kind === 'file' && isPdfFile(target.resource.path)
  const oversized = useOversizedFileFacts(
    target.kind === 'file' ? target.resource.path : filesystemPath(''),
    fileVersion,
    target.kind === 'file' && !pdf && fileState.status === 'error',
  )
  if (target.kind === 'file' && pdf) return <PdfFile path={target.resource.path} />
  if (target.kind === 'file' && fileState.status === 'ready' && fileState.data.seemsBinary) {
    return <FileFacts file={fileState.data} />
  }
  if (oversized.applicable && oversized.query.isPending && oversized.query.isFetching)
    return <Spinner size='md' label='Reading file details' />
  if (oversized.applicable && oversized.query.isError) {
    return (
      <EmptyState
        title='Could not read file details'
        description={clientErrorMessage(oversized.query.error)}
        tone='error'
      />
    )
  }
  if (oversized.applicable && oversized.query.data) return <FileFacts file={oversized.query.data} />
  return <FileEditorBody {...props} />
}
