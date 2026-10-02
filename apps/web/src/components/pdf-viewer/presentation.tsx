import { useQuery } from '@tanstack/react-query'
import { ToolPane } from '@workspace/ui/patterns/tool-pane'
import { PdfFailure } from '@/components/pdf-viewer/failure'
import type { PdfPresentationProps } from '@/components/pdf-viewer/presentation-content'
import { pdfPresentationOptions } from '@/lib/pdf-viewer/presentation-query'
import { resourceQueryClient } from '@/lib/resources/state/query-client'

export function PdfPresentation(props: PdfPresentationProps) {
  const presentation = useQuery(pdfPresentationOptions, resourceQueryClient)
  if (presentation.isPending) return <ToolPane title='PDF' state={{ pending: true }} />
  if (presentation.isError)
    return (
      <ToolPane
        title='PDF'
        state={{ error: true }}
        errorState={<PdfFailure error={presentation.error} />}
      />
    )
  return <presentation.data.PdfPresentationContent {...props} />
}
