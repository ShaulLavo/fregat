import { useQuery } from '@tanstack/react-query'
import { ToolPane } from '@workspace/ui/patterns/tool-pane'
import { RenderErrorBoundary } from '@workspace/ui/patterns/render-error-boundary'
import { pdfBytesOptions, type PdfSource } from '@/lib/pdf-viewer/source'
import { pdfEngineOptions } from '@/lib/pdf-viewer/engine-query'
import { PdfDocument } from '@/components/pdf-viewer/document'
import { PdfFailure } from '@/components/pdf-viewer/failure'
import { useHeldUntilReady } from '@/hooks/use-held-until-ready'
import { resourceQueryClient } from '@/lib/resources/state/query-client'

export function PdfViewer({ source, loading = false }: { source: PdfSource; loading?: boolean }) {
  const bytes = useQuery(pdfBytesOptions(source))
  const engine = useQuery(pdfEngineOptions, resourceQueryClient)
  const held = useHeldUntilReady(
    { bytes: bytes.data, engine: engine.data },
    bytes.isSuccess && engine.isSuccess,
  )
  if (!held.bytes || !held.engine) {
    if (bytes.isError || engine.isError)
      return (
        <ToolPane
          title='PDF'
          state={{ error: true }}
          errorState={<PdfFailure error={bytes.error ?? engine.error} />}
        />
      )
    return <ToolPane title='PDF' state={{ pending: true }} />
  }
  if (bytes.isError || engine.isError)
    return (
      <ToolPane
        title='PDF'
        state={{ error: true }}
        errorState={<PdfFailure error={bytes.error ?? engine.error} />}
      />
    )
  return (
    <RenderErrorBoundary label='PDF' resetKeys={[held.bytes, source.origin]}>
      <PdfDocument
        engine={held.engine}
        bytes={held.bytes.bytes}
        loading={loading || bytes.isFetching}
      />
    </RenderErrorBoundary>
  )
}
