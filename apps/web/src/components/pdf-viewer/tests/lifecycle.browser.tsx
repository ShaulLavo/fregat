import { test, expect } from 'vitest'
import { makePdf } from '../../../../test/factories/pdf'
import { openPdf, renderPdfPage, highlightPdfPage } from '@/lib/pdf-viewer/engine'
import { itemHighlights, searchPdf } from '@/lib/pdf-viewer/search'
import { resourceQueryClient } from '@/lib/resources/state/query-client'
import * as engine from '@/lib/pdf-viewer/engine'
import { usePdfDocument } from '@/hooks/use-pdf-document'
import { renderHookWithProviders } from '../../../../test/render'

test('real PDF worker preserves cached bytes, selects and searches multi-page text, ignores scripts and destroys on abort', async () => {
  const bytes = makePdf()
  const original = bytes.slice()
  const controller = new AbortController()
  const host = document.createElement('div')
  document.body.append(host)
  try {
    const pdf = await openPdf(bytes, controller.signal)
    expect(pdf?.pages).toHaveLength(2)
    expect(bytes).toEqual(original)
    const matches = searchPdf(pdf!.texts, 'PDF verification')
    expect(matches.map((match) => match.page)).toEqual([0, 1])
    const root = host.attachShadow({ mode: 'open' })
    const layer = await renderPdfPage(pdf!.pages[0]!, root, 612, controller.signal)
    expect(layer?.textContentItemsStr.join(' ')).toContain('PDF verification first page')
    highlightPdfPage(layer!, itemHighlights(pdf!.texts[0]!, matches, 0))
    expect(root.querySelector('.highlight')?.textContent).toBe('PDF verification')
    const range = document.createRange()
    range.selectNodeContents(layer!.textDivs[0]!)
    const selection = document.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
    expect(selection.toString()).toContain('PDF verification first page')
    expect(Reflect.get(globalThis, 'pdfScriptExecuted')).toBeUndefined()
    controller.abort()
    expect(pdf!.document.loadingTask.destroyed).toBe(true)
    const cancelledRoot = document.createElement('div').attachShadow({ mode: 'open' })
    expect(await renderPdfPage(pdf!.pages[0]!, cancelledRoot, 612, controller.signal)).toBeNull()
    expect(cancelledRoot.childNodes).toHaveLength(0)
  } finally {
    controller.abort()
    host.remove()
  }
})

test('corrupt PDF is readable and a pre-aborted load allocates no worker', async () => {
  const controller = new AbortController()
  try {
    await expect(
      openPdf(new TextEncoder().encode('corrupt'), controller.signal),
    ).rejects.toMatchObject({
      data: { code: 'pdf.LOAD_FAILED' },
      message: 'The PDF could not be opened',
    })
    await expect(openPdf(new Uint8Array(), controller.signal)).rejects.toMatchObject({
      data: { code: 'pdf.LOAD_FAILED' },
    })
    controller.abort()
    expect(await openPdf(makePdf(), controller.signal)).toBeNull()
  } finally {
    controller.abort()
  }
})

test.each(['Helvetica', 'Courier', 'Times-Roman', 'Symbol', 'ZapfDingbats'])(
  'renders unembedded %s with browser fonts or permitted PFB assets',
  async (font) => {
    const controller = new AbortController()
    const host = document.createElement('div')
    document.body.append(host)
    // App imports fill Chromium's default 250-entry timing buffer before font transport begins.
    performance.clearResourceTimings()
    try {
      const pdf = await openPdf(makePdf(['ABC xyz'], font), controller.signal)
      expect(pdf?.pages).toHaveLength(1)
      const root = host.attachShadow({ mode: 'open' })
      const layer = await renderPdfPage(pdf!.pages[0]!, root, 612, controller.signal)
      expect(layer?.textContentItemsStr.join('').length).toBeGreaterThan(0)
      const canvas = root.querySelector('canvas')!
      const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
      expect(
        pixels.some((value, index) => index % 4 === 0 && value < 128 && pixels[index + 3] === 255),
      ).toBe(true)
      const assets = performance.getEntriesByType('resource').map((entry) => entry.name)
      expect(assets.some((url) => url.includes('LiberationSans'))).toBe(false)
      const filename = font === 'Symbol' ? 'FoxitSymbol' : 'FoxitDingbats'
      if (font !== 'Symbol' && font !== 'ZapfDingbats') return
      expect(assets.some((url) => url.includes(filename))).toBe(true)
      const settled = resourceQueryClient
        .getQueryCache()
        .getAll()
        .find(
          (query) =>
            query.queryKey[0] === 'pdf' &&
            query.queryKey[1] === 'asset' &&
            String(query.queryKey[2]).includes(filename),
        )
      expect(settled?.state.status).toBe('success')
      expect((settled?.state.data as Uint8Array | undefined)?.byteLength).toBeGreaterThan(0)
    } finally {
      controller.abort()
      host.remove()
    }
  },
)

test('hook retains the shown worker until replacement, destroys on failure and releases on unmount', async () => {
  const view = renderHookWithProviders(({ bytes }) => usePdfDocument(engine, bytes), {
    initialProps: { bytes: makePdf(['first']) },
    command: false,
  })
  try {
    await expect.poll(() => view.result.current.data?.texts[0]?.text).toBe('first')
    const first = view.result.current.data!
    view.rerender({ bytes: makePdf(['replacement']) })
    expect(first.controller.signal.aborted).toBe(false)
    await expect.poll(() => view.result.current.data?.texts[0]?.text).toBe('replacement')
    const second = view.result.current.data!
    expect(first.controller.signal.aborted).toBe(true)
    view.rerender({ bytes: new TextEncoder().encode('corrupt') })
    await expect.poll(() => view.result.current.isError).toBe(true)
    expect(second.controller.signal.aborted).toBe(true)
    view.rerender({ bytes: makePdf(['recovered']) })
    await expect.poll(() => view.result.current.data?.texts[0]?.text).toBe('recovered')
    const final = view.result.current.data!
    view.unmount()
    expect(final.controller.signal.aborted).toBe(true)
    expect(final.document.loadingTask.destroyed).toBe(true)
  } finally {
    view.unmount()
  }
})

test('nondefault PDF units keep the selectable layer aligned with the measured canvas', async () => {
  const controller = new AbortController()
  const host = document.createElement('div')
  document.body.append(host)
  try {
    const pdf = await openPdf(makePdf(['Scaled page'], 'Helvetica', 2), controller.signal)
    const root = host.attachShadow({ mode: 'open' })
    await renderPdfPage(pdf!.pages[0]!, root, 612, controller.signal)
    expect(root.querySelector('canvas')!.getBoundingClientRect().width).toBeCloseTo(612, 0)
    expect(root.querySelector('.textLayer')!.getBoundingClientRect().width).toBeCloseTo(612, 0)
  } finally {
    controller.abort()
    host.remove()
  }
})
