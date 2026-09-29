/*
 * The one placement the plugin's floating surfaces share.
 *
 * Two halves, because happy-dom lays nothing out. The plugin half drives the real editor
 * contribution and asks only what a document can answer without a layout engine: that every surface
 * resolves to an anchor element the browser could find by name, that the anchor carries the rect the
 * editor reported, and that it is rewritten when the view moves. The unit half feeds
 * `createAnchoredSurface` the two measurements a browser would have taken — the height of the
 * surface and the height of the window — and reads back the side and the ceiling it chose.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createAnchoredSurface, HOVER_REQUEST_DEBOUNCE_MS } from '@singapore-editor/plugin-ui'
import { connectedEditor, flushPromises } from './connectedEditor'

const RENAME_COMMAND = 'editor.action.rename'

describe('the surfaces the plugin puts on screen', () => {
  afterEach(() => {
    vi.useRealTimers()
    document.body.replaceChildren()
  })

  it('anchors the completion list to the rect the editor reports for the word', async () => {
    vi.useFakeTimers()
    const editor = await connectedEditor('const va', 8)

    editor.type('l')
    await vi.advanceTimersByTimeAsync(90)
    expect(editor.completionRequests()).toHaveLength(1)
    editor.answerCompletion([{ label: 'value' }])
    await flushPromises()
    expect(editor.reportedErrors()).toEqual([])
    expect(editor.completionLabels()).toEqual(['value'])

    expectAnchoredAt(editor.completionElement(), 20)
  })

  it('anchors the hover tooltip to the rect the editor reports for the token', async () => {
    vi.useFakeTimers()
    const editor = await connectedEditor('const value = 1', 6)

    editor.pointerMove(40, 60)
    await vi.advanceTimersByTimeAsync(HOVER_REQUEST_DEBOUNCE_MS)
    editor.answerHover({ contents: { kind: 'markdown', value: 'the answer' } })
    await flushPromises()

    expectAnchoredAt(visibleTooltip(), 20)
  })

  it('anchors the signature help to the rect the editor reports for the caret', async () => {
    const editor = await connectedEditor('call', 4)

    editor.type('(')
    // The signature surface loads on the first '(' of a session, so the request follows its import.
    await editor.awaitRequest('textDocument/signatureHelp')
    editor.answerSignatureHelp({ signatures: [{ label: 'call(a: number)' }] })
    await flushPromises()

    expectAnchoredAt(visibleTooltip(), 20)
  })

  it('anchors the rename input to the rect the editor reports for the symbol', async () => {
    const editor = await connectedEditor('const value = 1', 6, {
      capabilities: { renameProvider: true },
    })

    expect(editor.runCommand(RENAME_COMMAND)).toBe(true)
    await flushPromises()

    expectAnchoredAt(renameElement(), 20)
  })

  // The hover is the one surface that answers a moved view by closing: it is keyed to a pointer
  // that has not moved, so the token it describes is no longer the one under the pointer.
  it('closes the hover when the view is laid out again', async () => {
    vi.useFakeTimers()
    const editor = await connectedEditor('const value = 1', 6)

    editor.pointerMove(40, 60)
    await vi.advanceTimersByTimeAsync(HOVER_REQUEST_DEBOUNCE_MS)
    editor.answerHover({ contents: { kind: 'markdown', value: 'the answer' } })
    await flushPromises()
    expect(openTooltips()).toHaveLength(1)

    editor.relayout(30)

    expect(openTooltips()).toHaveLength(0)
  })

  // Two ways for the text to move out from under a surface that has not changed: the reader scrolls,
  // or something about the view's size does. Both leave the surface pointing at the wrong line.
  it('moves the completion list when the view scrolls and when it is laid out again', async () => {
    vi.useFakeTimers()
    const editor = await connectedEditor('const va', 8)

    editor.type('l')
    await vi.advanceTimersByTimeAsync(90)
    editor.answerCompletion([{ label: 'value' }])
    await flushPromises()

    editor.scroll(30)
    expectAnchoredAt(editor.completionElement(), -10)

    editor.relayout(30)
    expectAnchoredAt(editor.completionElement(), -40)
  })

  it('moves the signature help when the view scrolls and when it is laid out again', async () => {
    const editor = await connectedEditor('call', 4)

    editor.type('(')
    // The signature surface loads on the first '(' of a session, so the request follows its import.
    await editor.awaitRequest('textDocument/signatureHelp')
    editor.answerSignatureHelp({ signatures: [{ label: 'call(a: number)' }] })
    await flushPromises()

    editor.scroll(30)
    expectAnchoredAt(visibleTooltip(), -10)

    editor.relayout(30)
    expectAnchoredAt(visibleTooltip(), -40)
  })

  it('moves an open rename input when the view scrolls and when it is laid out again', async () => {
    const editor = await connectedEditor('const value = 1', 6, {
      capabilities: { renameProvider: true },
    })

    expect(editor.runCommand(RENAME_COMMAND)).toBe(true)
    await flushPromises()

    editor.scroll(30)
    expectAnchoredAt(renameElement(), -10)

    editor.relayout(30)
    expectAnchoredAt(renameElement(), -40)
  })
})

describe('choosing a side and a ceiling', () => {
  afterEach(() => {
    document.body.replaceChildren()
  })

  it('keeps the side it was asked for while the surface fits there', () => {
    const surface = measuredSurface(200, { preferredPlacement: 'top' })

    surface.place(new DOMRect(0, 400, 40, 18))

    expect(surface.element.style.getPropertyValue('position-area')).toBe('top center')
  })

  it('flips to the other side when the one it was asked for has no room', () => {
    const surface = measuredSurface(200, { preferredPlacement: 'top' })

    // Room above: 30 - 8 - 12 = 10px, which nothing 200px tall fits into.
    surface.place(new DOMRect(0, 30, 40, 18))

    expect(surface.element.style.getPropertyValue('position-area')).toBe('bottom center')
  })

  it('takes the side with more room when the surface fits on neither', () => {
    const surface = measuredSurface(700, { preferredPlacement: 'bottom' })

    // 380px of window above the anchor against 350px below it, and 700px fits in neither.
    surface.place(new DOMRect(0, 400, 40, 18))

    expect(surface.element.style.getPropertyValue('position-area')).toBe('top center')
  })

  it('clamps the ceiling to the room on the side it landed on', () => {
    const surface = measuredSurface(100, { preferredPlacement: 'bottom', maxHeightPx: 280 })

    // 768 - 618 - 8 - 12 = 130px below: room for the surface as it stands, but not for the 280 it
    // would grow into as more rows arrive.
    surface.place(new DOMRect(0, 600, 40, 18))

    expect(surface.element.style.getPropertyValue('position-area')).toBe('bottom center')
    expect(surface.element.style.maxHeight).toBe('130px')
  })

  it('keeps the ceiling off the floor that leaves a pinned surface readable', () => {
    const surface = measuredSurface(10, { preferredPlacement: 'top', maxHeightPx: 280 })

    // 20px above the anchor, which the surface fits in today and nothing readable fits in at all.
    surface.place(new DOMRect(0, 40, 40, 18))

    expect(surface.element.style.getPropertyValue('position-area')).toBe('top center')
    expect(surface.element.style.maxHeight).toBe('80px')
  })

  it('writes no ceiling for a surface that declared none', () => {
    const surface = measuredSurface(24, { preferredPlacement: 'bottom' })

    surface.place(new DOMRect(0, 740, 40, 18))

    expect(surface.element.style.maxHeight).toBe('')
  })

  it('reports the ceiling it landed with to a surface that asked for it', () => {
    const ceilings: number[] = []
    const surface = measuredSurface(100, {
      preferredPlacement: 'bottom',
      maxHeightPx: 280,
      onPlaced: (maxHeightPx) => ceilings.push(maxHeightPx),
    })

    surface.place(new DOMRect(0, 600, 40, 18))

    expect(ceilings).toEqual([130])
  })

  it('takes its anchor out of the document when disposed', () => {
    const surface = measuredSurface(200, { preferredPlacement: 'top' })
    surface.place(new DOMRect(0, 400, 40, 18))
    const anchor = anchorFor(surface.element)

    surface.dispose()

    expect(anchor.isConnected).toBe(false)
  })
})

/**
 * A surface of a known height.
 *
 * The height is the one thing this environment cannot supply — happy-dom reports every rect empty —
 * so it is the one thing stubbed. Everything the placement then does with it is the shipped code.
 */
function measuredSurface(
  heightPx: number,
  options: {
    readonly preferredPlacement: 'top' | 'bottom'
    readonly maxHeightPx?: number
    onPlaced?(maxHeightPx: number): void
  },
): { element: HTMLElement; place(anchor: DOMRect): void; dispose(): void } {
  const element = document.createElement('div')
  element.getBoundingClientRect = () => new DOMRect(0, 0, 320, heightPx)
  document.body.append(element)
  const surface = createAnchoredSurface({ element, anchorClassName: 'test-surface', ...options })
  return { element, place: (anchor) => surface.place(anchor), dispose: () => surface.dispose() }
}

/** The rect a surface is anchored to, resolved the way the browser resolves it: by name. */
function anchorFor(surface: HTMLElement): HTMLElement {
  const name = surface.style.getPropertyValue('position-anchor')
  if (!name) throw new Error('surface declares no position-anchor')

  const anchor = Array.from(document.body.querySelectorAll<HTMLElement>('*')).find(
    (element) => element.style.getPropertyValue('anchor-name') === name,
  )
  if (!anchor) throw new Error(`no element declares ${name}`)
  return anchor
}

function expectAnchoredAt(surface: HTMLElement, top: number): void {
  const anchor = anchorFor(surface)
  expect(anchor.style.display).toBe('block')
  expect(anchor.style.top).toBe(`${top}px`)
}

/** Hover and signature help are the same kind of tooltip, so the open one is the one under test. */
function visibleTooltip(): HTMLElement {
  const tooltip = openTooltips()[0]
  if (!tooltip) throw new Error('no tooltip on screen')
  return tooltip
}

function openTooltips(): readonly HTMLElement[] {
  return Array.from(
    document.body.querySelectorAll<HTMLElement>('.editor-test-hover, .editor-lsp-plugin-hover'),
  ).filter((element) => !element.hidden)
}

function renameElement(): HTMLElement {
  const element = document.body.querySelector<HTMLElement>('.lsp-plugin-rename')
  if (!element) throw new Error('missing rename input')
  return element
}
