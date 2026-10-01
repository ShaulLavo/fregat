import { getDocument, GlobalWorkerOptions, TextLayer, type PDFPageProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import pageStyles from 'pdfjs-dist/web/pdf_viewer.css?inline'
import { PdfBinaryDataFactory } from '@/lib/pdf-viewer/assets'
import { pdfPageText, type PdfPageText } from '@/lib/pdf-viewer/search'
import { pdfError } from '@/lib/pdf-viewer/structured-errors'

GlobalWorkerOptions.workerSrc = workerUrl
export type { PDFPageProxy }

function createPdfTask(bytes: Uint8Array) {
  try {
    // PDF.js 6 removed eval support. Core rendering never instantiates its separate scripting engine.
    return getDocument({
      data: bytes.slice(),
      enableXfa: false,
      // Liberation font assets carry GPL terms; unembedded standard fonts use browser fonts.
      useSystemFonts: true,
      stopAtErrors: true,
      useWorkerFetch: false,
      BinaryDataFactory: PdfBinaryDataFactory,
    })
  } catch (cause) {
    throw pdfError('LOAD_FAILED', cause, 'parse')
  }
}

export async function openPdf(bytes: Uint8Array, signal: AbortSignal) {
  // The worker transfers its input; cached bytes must stay attached for reopening and other viewers.
  if (signal.aborted) return null
  const task = createPdfTask(bytes)
  const destroy = () => {
    void task.destroy()
  }
  signal.addEventListener('abort', destroy, { once: true })
  let phase = 'worker'
  try {
    const document = await task.promise
    phase = 'parse'
    const pages: PDFPageProxy[] = []
    const texts: PdfPageText[] = []
    for (let number = 1; number <= document.numPages; number++) {
      if (signal.aborted) return null
      const page = await document.getPage(number)
      const content = await page.getTextContent()
      pages.push(page)
      texts.push(pdfPageText(content.items.flatMap((item) => ('str' in item ? [item] : []))))
    }
    if (signal.aborted) return null
    return { document, pages, texts }
  } catch (cause) {
    destroy()
    if (signal.aborted) return null
    signal.removeEventListener('abort', destroy)
    const workerUnavailable = phase === 'worker' && cause instanceof Error && cause.name === 'Error'
    throw pdfError(workerUnavailable ? 'ENGINE_UNAVAILABLE' : 'LOAD_FAILED', cause, phase)
  }
}

export async function renderPdfPage(
  page: PDFPageProxy,
  root: ShadowRoot,
  width: number,
  signal: AbortSignal,
) {
  if (signal.aborted) return null
  const natural = page.getViewport({ scale: 1 })
  const viewport = page.getViewport({ scale: width / natural.width })
  const density = window.devicePixelRatio || 1
  const style = document.createElement('style')
  style.textContent = pageStyles
  const viewer = document.createElement('div')
  viewer.className = 'pdfViewer singlePageView'
  const surface = document.createElement('div')
  surface.className = 'page'
  surface.style.setProperty('--total-scale-factor', String(viewport.scale * page.userUnit))
  surface.style.setProperty('--user-unit', String(page.userUnit))
  surface.style.width = `${viewport.width}px`
  surface.style.height = `${viewport.height}px`
  const wrapper = document.createElement('div')
  wrapper.className = 'canvasWrapper'
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(viewport.width * density)
  canvas.height = Math.ceil(viewport.height * density)
  canvas.style.width = `${viewport.width}px`
  canvas.style.height = `${viewport.height}px`
  canvas.setAttribute('aria-hidden', 'true')
  wrapper.append(canvas)
  const text = document.createElement('div')
  text.className = 'textLayer'
  surface.append(wrapper, text)
  viewer.append(surface)
  root.replaceChildren(style, viewer)
  const rendering = page.render({ canvas, viewport, transform: [density, 0, 0, density, 0, 0] })
  const layer = new TextLayer({
    container: text,
    viewport,
    textContentSource: page.streamTextContent(),
  })
  const cancel = () => {
    rendering.cancel()
    layer.cancel()
  }
  signal.addEventListener('abort', cancel, { once: true })
  try {
    await Promise.all([rendering.promise, layer.render()])
    return signal.aborted ? null : layer
  } catch (cause) {
    cancel()
    if (signal.aborted) return null
    throw pdfError('LOAD_FAILED', cause, 'render')
  } finally {
    signal.removeEventListener('abort', cancel)
  }
}

export function highlightPdfPage(
  layer: TextLayer,
  ranges: readonly (readonly { start: number; end: number; selected: boolean }[])[],
): HTMLElement | null {
  let selected: HTMLElement | null = null
  layer.textDivs.forEach((element, index) => {
    const text = layer.textContentItemsStr[index] ?? ''
    const fragments: Node[] = []
    let offset = 0
    for (const range of ranges[index] ?? []) {
      fragments.push(document.createTextNode(text.slice(offset, range.start)))
      const mark = document.createElement('span')
      mark.className = range.selected ? 'highlight appended selected' : 'highlight appended'
      if (range.selected && !selected) selected = mark
      mark.textContent = text.slice(range.start, range.end)
      fragments.push(mark)
      offset = range.end
    }
    fragments.push(document.createTextNode(text.slice(offset)))
    element.replaceChildren(...fragments)
  })
  return selected
}
