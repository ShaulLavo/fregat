import { ToolPane } from '@workspace/ui/patterns/tool-pane'
import type { FilesystemPath } from '@/lib/documents/utils/types'
import { usePdfFileSource } from '@/hooks/use-pdf-file-source'
import { PdfViewer } from '@/components/pdf-viewer/viewer'
import { PdfFailure } from '@/components/pdf-viewer/failure'

export function PdfFile({ path }: { path: FilesystemPath }) {
  const { source, loading, error } = usePdfFileSource(path)
  if (!source && loading) return <ToolPane title='PDF' state={{ pending: true }} />
  if (error && !loading)
    return (
      <ToolPane title='PDF' state={{ error: true }} errorState={<PdfFailure error={error} />} />
    )
  if (!source) return <ToolPane title='PDF' state={{ pending: true }} />
  return <PdfViewer source={source} loading={loading} />
}
