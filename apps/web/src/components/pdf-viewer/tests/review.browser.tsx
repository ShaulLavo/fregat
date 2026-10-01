import '@workspace/ui/globals.css'
import { test, expect, vi } from 'vitest'
import { fireEvent } from '@testing-library/react'
import { makePdf } from '../../../../test/factories/pdf'
import { renderWithProviders } from '../../../../test/render'
import * as engine from '@/lib/pdf-viewer/engine'
import { searchPdf, itemHighlights } from '@/lib/pdf-viewer/search'
import { PdfPage } from '@/components/pdf-viewer/page'
import { PdfDocument } from '@/components/pdf-viewer/document'

test.each([
  ['explicit whitespace', 'BT /F1 24 Tf 50 720 Td (hello) Tj 70 0 Td (world) Tj ET', 'hello world'],
  ['split word', 'BT /F1 24 Tf 50 720 Td (hel) Tj 32.016 0 Td /F1 20 Tf (lo) Tj ET', 'hello'],
])('real extracted %s stays searchable', async (_name, stream, term) => {
  const controller = new AbortController()
  try {
    const control = await engine.openPdf(makePdf([term]), controller.signal)
    expect(searchPdf(control!.texts, term)).toHaveLength(1)
    const pdf = await engine.openPdf(makePdf([''], 'Helvetica', 1, [stream]), controller.signal)
    expect(searchPdf(pdf!.texts, term)).toHaveLength(1)
    const host = document.createElement('div')
    document.body.append(host)
    try {
      const root = host.attachShadow({ mode: 'open' })
      const layer = await engine.renderPdfPage(pdf!.pages[0]!, root, 612, controller.signal)
      const matches = searchPdf(pdf!.texts, term)
      engine.highlightPdfPage(layer!, itemHighlights(pdf!.texts[0]!, matches, 0, matches[0]))
      expect(
        Array.from(root.querySelectorAll('.highlight'), (mark) => mark.textContent).join(''),
      ).toBe(term)
    } finally {
      host.remove()
    }
  } finally {
    controller.abort()
  }
})

test('a failed page render recovers when a valid replacement reuses page number one', async () => {
  const controller = new AbortController()
  const failed = await engine.openPdf(makePdf(['initial']), controller.signal)
  const recovered = await engine.openPdf(makePdf(['recovered']), controller.signal)
  const context = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValueOnce(null)
  const view = renderWithProviders(
    <PdfPage
      engine={engine}
      page={failed!.pages[0]!}
      width={612}
      text={failed!.texts[0]!}
      matches={[]}
    />,
    { command: false },
  )
  try {
    await expect.poll(() => view.container.textContent).toContain('This page could not be rendered')
    context.mockRestore()
    view.rerender(
      <PdfPage
        engine={engine}
        page={recovered!.pages[0]!}
        width={612}
        text={recovered!.texts[0]!}
        matches={[]}
      />,
    )
    await expect
      .poll(() => view.container.querySelector('[data-pdf-page-content]')?.shadowRoot?.textContent)
      .toContain('recovered')
    expect(view.container.textContent).not.toContain('This page could not be rendered')
  } finally {
    context.mockRestore()
    view.unmount()
    controller.abort()
  }
})

test('Next visits two separated matches on one tall page inside its viewport', async () => {
  const stream = 'BT /F1 24 Tf 50 720 Td (needle first) Tj 0 -600 Td (needle second) Tj ET'
  const bytes = makePdf([''], 'Helvetica', 1, [stream])
  const view = renderWithProviders(
    <div className='flex min-h-0 flex-col overflow-hidden' style={{ height: 300, width: 612 }}>
      <PdfDocument engine={engine} bytes={bytes} loading={false} />
    </div>,
    { command: false },
  )
  try {
    await expect.poll(() => view.queryByLabelText('Search PDF')).not.toBeNull()
    fireEvent.change(view.getByLabelText('Search PDF'), { target: { value: 'needle' } })
    await expect.poll(() => view.getByRole('status').textContent).toBe('2 matches')
    const host = () => view.container.querySelector('[data-pdf-page-content]')!
    await expect.poll(() => host().shadowRoot?.querySelectorAll('.highlight').length).toBe(2)
    fireEvent.click(view.getByRole('button', { name: /^Next$/ }))
    fireEvent.click(view.getByRole('button', { name: /^Next$/ }))
    const scroller = view.container.querySelector('[data-pdf-pages]')!
    expect(scroller.clientHeight).toBeLessThan(600)
    await expect
      .poll(() => {
        const match = host().shadowRoot!.querySelectorAll('.highlight')[1]!
        return match.getBoundingClientRect().bottom <= scroller.getBoundingClientRect().bottom
      })
      .toBe(true)
    expect(scroller.scrollTop).toBeGreaterThan(0)
    fireEvent.click(view.getByRole('button', { name: /^Previous$/ }))
    await expect
      .poll(() => {
        const match = host().shadowRoot!.querySelector('.highlight.selected')!
        return match.getBoundingClientRect().top >= scroller.getBoundingClientRect().top
      })
      .toBe(true)
  } finally {
    view.unmount()
  }
})

test('navigation waits for a distant page to render before revealing its selected match', async () => {
  const stream = 'BT /F1 24 Tf 50 120 Td (distant needle) Tj ET'
  const bytes = makePdf(['first', 'second', 'third', 'fourth', ''], 'Helvetica', 1, [
    'BT /F1 24 Tf 50 720 Td (first) Tj ET',
    'BT /F1 24 Tf 50 720 Td (second) Tj ET',
    'BT /F1 24 Tf 50 720 Td (third) Tj ET',
    'BT /F1 24 Tf 50 720 Td (fourth) Tj ET',
    stream,
  ])
  const view = renderWithProviders(
    <div className='flex min-h-0 flex-col overflow-hidden' style={{ height: 300, width: 612 }}>
      <PdfDocument engine={engine} bytes={bytes} loading={false} />
    </div>,
    { command: false },
  )
  try {
    await expect.poll(() => view.queryByLabelText('Search PDF')).not.toBeNull()
    fireEvent.change(view.getByLabelText('Search PDF'), { target: { value: 'needle' } })
    await expect.poll(() => view.getByRole('status').textContent).toBe('1 match')
    await expect
      .poll(() => view.container.querySelector('[data-pdf-page="5"] [data-pdf-page-content]'))
      .not.toBeNull()
    const host = view.container.querySelector('[data-pdf-page="5"] [data-pdf-page-content]')!
    expect(host.shadowRoot).toBeNull()
    fireEvent.click(view.getByRole('button', { name: /^Next$/ }))
    const scroller = view.container.querySelector('[data-pdf-pages]')!
    await expect
      .poll(() => {
        const mark = host.shadowRoot?.querySelector('.highlight.selected')
        if (!mark) return false
        const target = mark.getBoundingClientRect()
        const bounds = scroller.getBoundingClientRect()
        return target.top >= bounds.top && target.bottom <= bounds.bottom
      })
      .toBe(true)
  } finally {
    view.unmount()
  }
})

test('real extracted empty end-of-line items preserve the break and offsets', async () => {
  const controller = new AbortController()
  try {
    const control = await engine.openPdf(makePdf(['first second']), controller.signal)
    expect(control!.texts[0]!.text).toBe('first second')
    const stream = 'BT /F1 24 Tf 50 720 Td (first) Tj /F1 20 Tf 0 -600 Td (second) Tj ET'
    const pdf = await engine.openPdf(makePdf([''], 'Helvetica', 1, [stream]), controller.signal)
    const content = await pdf!.pages[0]!.getTextContent()
    expect(
      content.items.flatMap((item) => ('str' in item ? [[item.str, item.hasEOL]] : [])),
    ).toEqual([
      ['first', false],
      ['', true],
      ['second', false],
    ])
    expect(pdf!.texts[0]!.text).toBe('first\nsecond')
    const matches = searchPdf(pdf!.texts, 'second')
    expect(matches).toEqual([{ page: 0, start: 6, end: 12 }])
    expect(searchPdf(pdf!.texts, 'firstsecond')).toEqual([])
    const host = document.createElement('div')
    document.body.append(host)
    try {
      const root = host.attachShadow({ mode: 'open' })
      const layer = await engine.renderPdfPage(pdf!.pages[0]!, root, 612, controller.signal)
      engine.highlightPdfPage(layer!, itemHighlights(pdf!.texts[0]!, matches, 0, matches[0]))
      expect(root.querySelector('.highlight.selected')?.textContent).toBe('second')
    } finally {
      host.remove()
    }
  } finally {
    controller.abort()
  }
})

test('navigation stays disabled until measured page placeholders exist', async () => {
  const pending: { observer: ResizeObserver; target: Element; options?: ResizeObserverOptions }[] =
    []
  const observe = ResizeObserver.prototype.observe
  const pause = vi.spyOn(ResizeObserver.prototype, 'observe').mockImplementation(function (
    this: ResizeObserver,
    target,
    options,
  ) {
    pending.push({ observer: this, target, options })
  })
  const view = renderWithProviders(
    <div className='flex min-h-0 flex-col overflow-hidden' style={{ height: 300, width: 612 }}>
      <PdfDocument engine={engine} bytes={makePdf(['needle'])} loading={false} />
    </div>,
    { command: false },
  )
  try {
    await expect.poll(() => view.queryByLabelText('Search PDF')).not.toBeNull()
    fireEvent.change(view.getByLabelText('Search PDF'), { target: { value: 'needle' } })
    await expect.poll(() => view.getByRole('status').textContent).toBe('1 match')
    expect(view.container.querySelector('[data-pdf-page="1"]')).toBeNull()
    expect(view.getByRole('button', { name: /^Next$/ })).toBeDisabled()
    expect(view.getByRole('button', { name: /^Previous$/ })).toBeDisabled()
    fireEvent.keyDown(view.getByLabelText('Search PDF'), { key: 'Enter' })
    pause.mockRestore()
    for (const { observer, target, options } of pending) observe.call(observer, target, options)
    await expect.poll(() => view.container.querySelector('[data-pdf-page="1"]')).not.toBeNull()
    const host = view.container.querySelector('[data-pdf-page="1"] [data-pdf-page-content]')!
    await expect.poll(() => host.shadowRoot?.querySelector('.textLayer') ?? null).not.toBeNull()
    expect(host.shadowRoot!.querySelector('.highlight.selected')).toBeNull()
    expect(view.getByRole('button', { name: /^Next$/ })).toBeEnabled()
    fireEvent.click(view.getByRole('button', { name: /^Next$/ }))
    await expect
      .poll(() => host.shadowRoot?.querySelector('.highlight.selected') ?? null)
      .not.toBeNull()
  } finally {
    pause.mockRestore()
    view.unmount()
  }
})
