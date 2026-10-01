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
