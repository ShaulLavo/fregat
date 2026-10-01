import type * as Engine from '@/lib/pdf-viewer/engine'
import type { PdfMatch, PdfPageText } from '@/lib/pdf-viewer/search'
import { usePdfPage } from '@/hooks/use-pdf-page'
import { EmptyState } from '@workspace/ui/components/empty-state'
import { errorMessage } from '@/lib/error-message'

export function PdfPage({
  engine,
  page,
  width,
  matches,
  text,
  selected,
}: {
  engine: typeof Engine
  page: Engine.PDFPageProxy
  width: number
  text: PdfPageText
  selected?: PdfMatch
  matches: readonly PdfMatch[]
}) {
  const { setHost, error } = usePdfPage(engine, page, width, text, matches, selected)
  const natural = page.getViewport({ scale: 1 })
  return (
    <section
      aria-label={`Page ${page.pageNumber}`}
      data-pdf-page={page.pageNumber}
      className='relative mx-auto w-full'
      style={{ width, height: (width * natural.height) / natural.width }}
    >
      <div ref={setHost} className='size-full' data-pdf-page-content />
      {error && (
        <div className='bg-background absolute inset-0'>
          <EmptyState
            tone='error'
            title='This page could not be rendered'
            description={errorMessage(error, 'Reopen the PDF to try again.')}
          />
        </div>
      )}
    </section>
  )
}
