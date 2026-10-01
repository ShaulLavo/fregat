import { pdfMutationKeys } from '@/lib/pdf-viewer/mutation-keys'
import { useMutation } from '@tanstack/react-query'
import { useEffect, useEffectEvent, useState } from 'react'
import type * as Engine from '@/lib/pdf-viewer/engine'
import { itemHighlights, type PdfMatch, type PdfPageText } from '@/lib/pdf-viewer/search'

export function usePdfPage(
  engine: typeof Engine,
  page: Engine.PDFPageProxy,
  width: number,
  text: PdfPageText,
  matches: readonly PdfMatch[],
  selected?: PdfMatch,
) {
  const [host, setHost] = useState<HTMLDivElement | null>(null)
  const [visible, setVisible] = useState(false)
  const mutation = useMutation({
    mutationKey: pdfMutationKeys.render(page.pageNumber),
    gcTime: 0,
    mutationFn: ({ root, signal }: { root: ShadowRoot; signal: AbortSignal }) =>
      engine.renderPdfPage(page, root, width, signal),
  })
  const render = useEffectEvent((root: ShadowRoot, signal: AbortSignal) =>
    mutation.mutate({ root, signal }),
  )
  useEffect(() => {
    if (!host) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) setVisible(true)
      },
      { rootMargin: '100% 0px' },
    )
    observer.observe(host)
    return () => observer.disconnect()
  }, [host])
  useEffect(() => {
    if (!host || !visible) return
    const controller = new AbortController()
    render(host.shadowRoot ?? host.attachShadow({ mode: 'open' }), controller.signal)
    return () => controller.abort()
  }, [host, page, width, visible])
  const highlight = useEffectEvent(() => {
    const layer = mutation.data
    if (!layer) return
    const mark = engine.highlightPdfPage(
      layer,
      itemHighlights(text, matches, page.pageNumber - 1, selected),
    )
    const scroller = host?.closest('[data-pdf-pages]')
    if (!mark || !scroller) return
    const bounds = scroller.getBoundingClientRect()
    const target = mark.getBoundingClientRect()
    if (target.top >= bounds.top && target.bottom <= bounds.bottom) return
    scroller.scrollTop += target.top - bounds.top - (bounds.height - target.height) / 2
  })
  useEffect(() => {
    highlight()
  }, [mutation.data, matches, page, selected, text])
  return { setHost, error: mutation.error }
}
