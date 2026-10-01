import type * as Engine from '@/lib/pdf-viewer/engine'
import type { PdfMatch } from '@/lib/pdf-viewer/search'
import { usePdfPage } from '@/hooks/use-pdf-page'
import { EmptyState } from '@workspace/ui/components/empty-state'
import { errorMessage } from '@/lib/error-message'

export function PdfPage({
  engine,
  page,
  width,
  matches,
}: {
  engine: typeof Engine
  page: Engine.PDFPageProxy
  width: number
  matches: readonly PdfMatch[]
}) {
  const { setHost, error } = usePdfPage(engine, page, width, matches)
  const natural = page.getViewport({ scale: 1 })
  return (
    <section
      aria-label={`Page ${page.pageNumber}`}
      data-pdf-page={page.pageNumber}
      className='mx-auto w-full'
      style={{ width, height: (width * natural.height) / natural.width }}
    >
      {error ? (
        <EmptyState
          tone='error'
          title='This page could not be rendered'
          description={errorMessage(error, 'Reopen the PDF to try again.')}
        />
      ) : (
        <div ref={setHost} className='size-full' data-pdf-page-content />
      )}
    </section>
  )
}
