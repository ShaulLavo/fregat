import { useState } from 'react'
import { Button } from '@workspace/ui/components/button'
import { InputGroup, InputGroupInput, InputGroupAddon } from '@workspace/ui/components/input-group'
import { Spinner } from '@workspace/ui/components/spinner'
import { ToolPane } from '@workspace/ui/patterns/tool-pane'
import { useHeldUntilReady } from '@/hooks/use-held-until-ready'
import { usePdfDocument } from '@/hooks/use-pdf-document'
import { usePdfWidth } from '@/hooks/use-pdf-width'
import { PdfPage } from '@/components/pdf-viewer/page'
import { searchPdf } from '@/lib/pdf-viewer/search'
import type * as Engine from '@/lib/pdf-viewer/engine'
import { PdfFailure } from '@/components/pdf-viewer/failure'

export function PdfDocument({
  engine,
  bytes,
  loading,
}: {
  engine: typeof Engine
  bytes: Uint8Array
  loading: boolean
}) {
  const document = usePdfDocument(engine, bytes)
  const [search, setSearch] = useState({ bytes, term: '', selected: -1 })
  const { term, selected } = search
  const setSelected = (selected: number) => setSearch({ ...search, selected })
  const { host, setHost, width } = usePdfWidth()
  const ready = useHeldUntilReady(document.data ?? null, document.isSuccess || document.isError)
  if (ready && ready.bytes !== search.bytes)
    setSearch({ bytes: ready.bytes, term: '', selected: -1 })
  const setTerm = (term: string) => setSearch({ bytes: ready?.bytes ?? bytes, term, selected: -1 })
  const matches = searchPdf(ready?.texts ?? [], term)
  const matchLabel = matches.length === 1 ? 'match' : 'matches'
  const pageCount = ready?.pages.length ?? 0
  const pageLabel = pageCount === 1 ? 'page' : 'pages'
  function navigate(direction: number) {
    if (!matches.length || width <= 0) return
    const next =
      selected < 0 && direction < 0
        ? matches.length - 1
        : (selected + direction + matches.length) % matches.length
    setSelected(next)
    const page = matches[next]?.page
    host
      ?.querySelector(`[data-pdf-page="${(page ?? 0) + 1}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }
  return (
    <ToolPane
      className='h-full'
      title='PDF'
      detail={ready ? `${pageCount} ${pageLabel}` : undefined}
      scroll={false}
      actions={
        loading || document.isPending || (!ready && !document.isError) ? (
          <Spinner size='sm' label='Opening PDF' />
        ) : undefined
      }
      state={{ pending: !ready && !document.isError, error: document.isError }}
      errorState={<PdfFailure error={document.error} />}
      subheader={
        ready && (
          <div className='flex h-(--bar-height) items-center gap-(--density-gap) px-(--bar-padding-x)'>
            <InputGroup>
              <InputGroupInput
                aria-label='Search PDF'
                placeholder='Search PDF…'
                value={term}
                onChange={(event) => {
                  setTerm(event.target.value)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') navigate(event.shiftKey ? -1 : 1)
                }}
              />
              <InputGroupAddon align='inline-end'>
                <span role='status' className='font-mono tabular-nums'>
                  {term ? `${matches.length} ${matchLabel}` : ''}
                </span>
              </InputGroupAddon>
            </InputGroup>
            <Button
              size='xs'
              variant='ghost'
              disabled={!matches.length || width <= 0}
              onClick={() => navigate(-1)}
            >
              Previous
            </Button>
            <Button
              size='xs'
              variant='ghost'
              disabled={!matches.length || width <= 0}
              onClick={() => navigate(1)}
            >
              Next
            </Button>
          </div>
        )
      }
    >
      <div className='scroll-fade scroll-gutter h-full overflow-auto' data-pdf-pages>
        <div
          ref={setHost}
          className='flex flex-col gap-(--density-section-gap) p-(--density-section-padding)'
        >
          {ready &&
            width > 0 &&
            ready.pages.map((page) => (
              <PdfPage
                key={page.pageNumber}
                engine={engine}
                page={page}
                width={width}
                matches={matches}
                text={ready.texts[page.pageNumber - 1]!}
                selected={matches[selected]}
              />
            ))}
        </div>
      </div>
    </ToolPane>
  )
}
