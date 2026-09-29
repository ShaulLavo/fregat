import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import '../src/style.css'
import {
  createFoldGutterContribution,
  createLineGutterContribution,
} from '../../gutters/src/index.ts'

import { createFoldMap } from '../src/foldMap'
import { createPieceTableSnapshot } from '../src/public/document'
import { clearBrowserTextMetricsCache } from '../src/virtualization/browserMetrics'
import { FixedRowVirtualizer } from '../src/virtualization/fixedRowVirtualizer'
import { VirtualizedTextView } from '../src/virtualization'
import { projectTokensThroughEdit } from '../src/editor/tokenProjection'
import { EditorTokenStore } from '../src/syntax/tokenStore'
import type { EditorToken } from '../src/public/syntax'

describe.skipIf(typeof globalThis.Highlight === 'undefined')(
  'VirtualizedTextView native browser geometry',
  () => {
    let container: HTMLElement
    let view: VirtualizedTextView | null

    beforeEach(() => {
      container = document.createElement('div')
      container.style.height = '120px'
      container.style.width = '360px'
      document.body.appendChild(container)
      view = new VirtualizedTextView(container, { rowHeight: 20, overscan: 0 })
    })

    afterEach(() => {
      view?.dispose()
      container.remove()
      view = null
    })

    it('keeps caret, selection, and hit testing inside mounted rows', () => {
      view!.setHiddenCharacters('show')
      view!.setText('abcdef\nsecond')
      view!.setScrollMetrics(0, 40, container.clientWidth)

      const row = view!.getState().mountedRows[0]
      const chunk = row?.chunks[0]
      expect(chunk).toBeDefined()

      const selection = document.createRange()
      selection.setStart(chunk!.textNode, 1)
      selection.setEnd(chunk!.textNode, 4)
      expect(selection.getClientRects().length).toBeGreaterThan(0)

      const rowRect = row!.element.getBoundingClientRect()
      const offset = view!.textOffsetFromPoint(rowRect.left + 4, rowRect.top + 10)
      expect(offset).not.toBeNull()

      const validation = view!.validateMountedNativeGeometry()
      expect(validation.failures).toEqual([])
      expect(validation.caretChecks).toBeGreaterThan(0)
      expect(validation.selectionChecks).toBeGreaterThan(0)
    })

    it('paints decoded-binary-like controls without native caret hit-testing', () => {
      view!.setText('\u0000PNG\u0000\uFFFD')
      view!.setScrollMetrics(0, 20)
      view!.setSelection(0, 6)

      const row = view!.getState().mountedRows[0]!
      const selection = container.querySelector<HTMLElement>('.editor-virtualized-selection-range')
      const rowRect = row.element.getBoundingClientRect()

      expect(view!.scrollElement.textContent).toContain('\u2400PNG\u2400\uFFFD')
      expect(selection).not.toBeNull()
      expect(Number.parseFloat(selection!.style.width)).toBeGreaterThan(0)

      withThrowingNativeCaretApis(document, () => {
        expect(view!.textOffsetFromPoint(rowRect.left + 8, rowRect.top + 10)).not.toBeNull()
      })
    })

    it('sets deterministic gutter CSS variables without marker measurement', () => {
      view?.dispose()
      view = new VirtualizedTextView(container, {
        rowHeight: 20,
        overscan: 0,
        gutterContributions: [createLineGutterContribution(), createFoldGutterContribution()],
      })
      view!.setText(Array.from({ length: 10_000 }, (_, index) => `line ${index}`).join('\n'))
      view!.setScrollMetrics(9_999 * 20, 20, 360)

      expect(view!.scrollElement.style.getPropertyValue('--editor-gutter-label-columns')).toBe('')
      expect(view!.scrollElement.style.getPropertyValue('--editor-gutter-width')).toMatch(/px$/)
    })

    it('uses the editor font for line gutter labels by default', () => {
      view?.dispose()
      view = new VirtualizedTextView(container, {
        rowHeight: 20,
        overscan: 0,
        gutterContributions: [createLineGutterContribution()],
      })
      view!.setText('first\nsecond')
      view!.setScrollMetrics(0, 40, 360)

      const label = container.querySelector<HTMLElement>('.editor-virtualized-gutter-label')
      expect(label).not.toBeNull()

      const editorStyle = getComputedStyle(view!.scrollElement)
      const labelStyle = getComputedStyle(label!)
      expect(labelStyle.fontFamily).toBe(editorStyle.fontFamily)
      expect(labelStyle.fontSize).toBe(editorStyle.fontSize)
      expect(labelStyle.fontWeight).toBe(editorStyle.fontWeight)
    })

    it('keeps fold gutter cursor-line backgrounds above fold button base styles', () => {
      view?.dispose()
      view = new VirtualizedTextView(container, {
        rowHeight: 20,
        overscan: 0,
        gutterContributions: [createLineGutterContribution(), createFoldGutterContribution()],
        cursorLineHighlight: {
          gutterBackground: ['fold-gutter'],
          rowBackground: false,
        },
      })
      view!.scrollElement.style.setProperty(
        '--editor-cursor-line-gutter-background',
        'rgb(12, 34, 56)',
      )
      view!.setText('alpha\nbeta\ngamma')
      view!.setFoldMarkers([
        {
          key: 'fold-0',
          startOffset: 0,
          endOffset: 10,
          startRow: 0,
          endRow: 1,
          collapsed: false,
        },
      ])
      view!.setSelection(0, 0)
      view!.setScrollMetrics(0, 80)

      const foldCell = container.querySelector<HTMLElement>(
        '[data-editor-virtual-gutter-row="0"] [data-editor-gutter-contribution="fold-gutter"]',
      )
      const foldButton = foldCell?.querySelector<HTMLButtonElement>(
        '.editor-virtualized-fold-toggle',
      )

      expect(foldCell).not.toBeNull()
      expect(foldButton).not.toBeNull()
      expect(foldButton?.hidden).toBe(false)
      expect(getComputedStyle(foldCell!).backgroundColor).toBe('rgb(12, 34, 56)')
      expect(getComputedStyle(foldButton!).backgroundColor).toBe('rgba(0, 0, 0, 0)')
    })

    it('keeps line numbers in the line gutter when hidden fold cells collapse', () => {
      view?.dispose()
      view = new VirtualizedTextView(container, {
        rowHeight: 20,
        overscan: 0,
        gutterContributions: [createLineGutterContribution(), createFoldGutterContribution()],
      })

      const hiddenFoldStyle = document.createElement('style')
      hiddenFoldStyle.textContent = '.editor-virtualized-fold-toggle[hidden] { display: none; }'
      document.head.appendChild(hiddenFoldStyle)

      view!.setText('alpha\nbeta\ngamma')
      view!.setFoldMarkers([
        {
          key: 'fold-0',
          startOffset: 0,
          endOffset: 10,
          startRow: 0,
          endRow: 1,
          collapsed: false,
        },
      ])
      view!.setScrollMetrics(0, 80, 360)

      const foldableLineNumber = container.querySelector<HTMLElement>(
        '[data-editor-virtual-gutter-row="0"] [data-editor-gutter-contribution="line-gutter"]',
      )
      const plainLineNumber = container.querySelector<HTMLElement>(
        '[data-editor-virtual-gutter-row="1"] [data-editor-gutter-contribution="line-gutter"]',
      )

      expect(foldableLineNumber).not.toBeNull()
      expect(plainLineNumber).not.toBeNull()
      expect(Math.round(plainLineNumber!.getBoundingClientRect().left)).toBe(
        Math.round(foldableLineNumber!.getBoundingClientRect().left),
      )
      hiddenFoldStyle.remove()
    })

    it('recreates native token ranges for rows below same-line edits', () => {
      view?.dispose()
      view = new VirtualizedTextView(container, {
        rowHeight: 20,
        overscan: 0,
        selectionHighlightName: 'native-token-test',
      })
      let text = 'aa\nbb\ncc'
      let tokens = EditorTokenStore.fromTokens([
        { start: 0, end: 2, style: { color: '#ff0000' } },
        { start: 3, end: 5, style: { color: '#ff0000' } },
        { start: 6, end: 8, style: { color: '#ff0000' } },
      ])
      view.setText(text)
      view.setScrollMetrics(0, 60)
      view.setTokens(tokens)

      const rowOne = view.getState().mountedRows.find((row) => row.index === 1)!
      const previous = nativeTokenRangeForNode(rowOne.textNode)
      expect(previous).toBeDefined()

      const edit = { from: 1, to: 1, text: 'X' }
      const nextText = `${text.slice(0, edit.from)}${edit.text}${text.slice(edit.to)}`
      view.applyEdit(edit, nextText)
      tokens = projectTokensThroughEdit(tokens, edit, text)
      // Object tokens carry no provenance, so this takes the comparison path.
      view.setTokens(tokens.toTokens())
      text = nextText

      // The edit is on the row above, so this row's own text and the offsets
      // into it are untouched — what must survive is that its token still
      // covers exactly the characters it did, against the node it did.
      const next = nativeTokenRangeForNode(rowOne.textNode)
      expect(previous!.startOffset).toBe(0)
      expect(next).toBeDefined()
      expect(next!.startContainer).toBe(rowOne.textNode)
      expect(next!.startOffset).toBe(0)
      expect(next!.endOffset).toBe(2)
      expect(rowOne.textNode.data).toBe('bb')
      expect(text).toBe('aXa\nbb\ncc')
    })
  },
)

// Token highlights are pooled across every mounted view rather than named per
// view, so the range for a row has to be looked up by the node it covers.
function nativeTokenRangeForNode(node: Text): AbstractRange | undefined {
  for (const [name, highlight] of CSS.highlights.entries()) {
    if (!name.startsWith('editor-shared-token-')) continue

    const range = [...highlight].find((entry) => entry.startContainer === node)
    if (range) return range
  }

  return undefined
}

function withThrowingNativeCaretApis(document: Document, callback: () => void): void {
  const caretPosition = Object.getOwnPropertyDescriptor(document, 'caretPositionFromPoint')
  const caretRange = Object.getOwnPropertyDescriptor(document, 'caretRangeFromPoint')
  Object.defineProperty(document, 'caretPositionFromPoint', {
    configurable: true,
    value: () => {
      throw new Error('unexpected native caretPositionFromPoint')
    },
  })
  Object.defineProperty(document, 'caretRangeFromPoint', {
    configurable: true,
    value: () => {
      throw new Error('unexpected native caretRangeFromPoint')
    },
  })

  try {
    callback()
  } finally {
    restoreDocumentProperty(document, 'caretPositionFromPoint', caretPosition)
    restoreDocumentProperty(document, 'caretRangeFromPoint', caretRange)
  }
}

function restoreDocumentProperty(
  document: Document,
  property: 'caretPositionFromPoint' | 'caretRangeFromPoint',
  descriptor: PropertyDescriptor | undefined,
): void {
  if (descriptor) {
    Object.defineProperty(document, property, descriptor)
    return
  }

  Reflect.deleteProperty(document, property)
}

describe.skipIf(typeof globalThis.Highlight === 'undefined')(
  'VirtualizedTextView hidden browser layout',
  () => {
    const views: VirtualizedTextView[] = []
    const hosts: HTMLElement[] = []
    const virtualizers: FixedRowVirtualizer[] = []

    afterEach(() => {
      for (const view of views) view.dispose()
      for (const virtualizer of virtualizers) virtualizer.dispose()
      for (const host of hosts) host.remove()
      views.length = 0
      virtualizers.length = 0
      hosts.length = 0
      clearBrowserTextMetricsCache()
    })

    function createHost(hidden = false): HTMLElement {
      const host = document.createElement('div')
      host.style.cssText = 'display:flex;width:360px;height:120px;overflow:hidden'
      if (hidden) host.style.display = 'none'
      document.body.append(host)
      hosts.push(host)
      return host
    }

    function mount(
      options: ConstructorParameters<typeof VirtualizedTextView>[1] = {},
      hidden = false,
    ) {
      const host = createHost(hidden)
      const view = new VirtualizedTextView(host, { rowHeight: 20, overscan: 2, ...options })
      views.push(view)
      return { view, host }
    }

    it.each(['display:none', 'zero-height'])(
      'releases %s rows and restores deep scroll, edited text, caret, and sibling ranges on resize',
      async (mode) => {
        const retained = mount()
        const sibling = mount()
        const lines = Array.from({ length: 2_000 }, (_, index) => `line ${index}`)
        let text = lines.join('\n')
        setHighlightedText(retained.view, text)
        setHighlightedText(sibling.view, text)
        await browserFrames(3)
        expect(retained.view.getState().viewportHeight).toBe(120)
        expect(retained.view.getState().mountedRows.length).toBeGreaterThan(0)
        retained.view.scrollElement.scrollTop = 1_500 * 20
        retained.view.scrollElement.dispatchEvent(new Event('scroll'))
        await browserFrames(3)
        const scrollTop = retained.view.getState().scrollTop
        const totalHeight = retained.view.getState().totalHeight
        expect(scrollTop).toBe(30_000)
        const offset = text.indexOf('line 1500')
        retained.view.focusInput()
        retained.view.setSelection(offset + 4, offset + 4)
        assertNativeCaret(retained.view, offset + 4)
        const oldRanges = tokenRangesIn(retained.host)
        const siblingRanges = tokenRangesIn(sibling.host)
        expect(oldRanges.length).toBeGreaterThan(0)
        expect(siblingRanges.length).toBeGreaterThan(0)

        hideHost(retained.host, mode)
        await browserFrames(3)
        expect(retained.view.getState().viewportHeight).toBe(0)
        expect(retained.view.getState().mountedRows).toEqual([])
        expect(retained.host.querySelectorAll('[data-editor-virtual-row]')).toHaveLength(0)
        const remainingRanges = nativeTokenRanges()
        expect(oldRanges.every((range) => !remainingRanges.includes(range))).toBe(true)
        expect(tokenRangesIn(sibling.host)).toEqual(siblingRanges)
        expect(retained.view.getState().scrollTop).toBe(scrollTop)
        expect(retained.view.getState().totalHeight).toBe(totalHeight)

        const edit = { from: offset, to: offset + 4, text: 'EDIT' }
        text = text.slice(0, edit.from) + edit.text + text.slice(edit.to)
        retained.view.applyEdit(edit, text)
        retained.view.setTokens(fullTextTokens(text))
        retained.view.setSelection(offset + 4, offset + 4)
        expect(retained.view.getState().mountedRows).toEqual([])
        expect(tokenRangesIn(retained.host)).toEqual([])
        showHost(retained.host)
        await browserFrames(3)

        expect(retained.view.getState().scrollTop).toBe(scrollTop)
        expect(retained.host.querySelector('[data-editor-virtual-row="1500"]')?.textContent).toBe(
          'EDIT 1500',
        )
        expect(tokenRangesIn(retained.host).length).toBeGreaterThan(0)
        expect(tokenRangesIn(sibling.host)).toEqual(siblingRanges)
        assertNativeCaret(retained.view, offset + 4)
      },
    )

    it('measures an initially hidden font and wraps current text on its first visible resize', async () => {
      clearBrowserTextMetricsCache()
      const fontStyle = document.createElement('style')
      fontStyle.textContent = '.e004-large-font { font-size: 18px; }'
      document.head.append(fontStyle)
      hosts.push(fontStyle)
      const retained = mount({ wrap: true, className: 'e004-large-font' }, true)
      const text = 'abcdefghij'.repeat(30)
      setHighlightedText(retained.view, text)
      retained.view.setSelection(7, 7)
      await browserFrames(3)
      expect(retained.view.getState().viewportHeight).toBe(0)
      expect(retained.view.getState().mountedRows).toEqual([])
      expect(tokenRangesIn(retained.host)).toEqual([])
      expect(retained.host.querySelector('.editor-virtualized-metric-probe')).toBeNull()

      showHost(retained.host)
      await browserFrames(3)
      const state = retained.view.getState()
      expect(state.viewportHeight).toBe(120)
      expect(state.mountedRows.length).toBeGreaterThan(1)
      expect(state.mountedRows[0]!.text).toBe(text.slice(0, state.mountedRows[0]!.text.length))
      expect(state.mountedRows[0]!.text.length).toBeLessThan(40)
      const range = retained.view.createRange(0, 10, { scrollIntoView: false })!
      expect(state.metrics.characterWidth).toBeCloseTo(range.getBoundingClientRect().width / 10, 1)
      expect(tokenRangesIn(retained.host).length).toBeGreaterThan(0)
      assertNativeCaret(retained.view, 7)

      const control = mount({ wrap: true, className: 'e004-large-font' })
      setHighlightedText(control.view, text)
      await browserFrames(3)
      expect(state.metrics).toEqual(control.view.getState().metrics)
      expect(state.mountedRows.map((row) => row.text)).toEqual(
        control.view.getState().mountedRows.map((row) => row.text),
      )
    })

    it('renders the final line in a positive-height viewport after reveal', async () => {
      const { view, host } = mount({ overscan: 0 })
      const text = Array.from({ length: 100 }, (_, index) => `line ${index}`).join('\n')
      setHighlightedText(view, text)
      await browserFrames(3)
      view.scrollElement.scrollTop = view.getState().totalHeight
      view.scrollElement.dispatchEvent(new Event('scroll'))
      view.setSelection(text.length, text.length)
      await browserFrames(3)
      expect(view.getState().mountedRows.at(-1)?.text).toBe('line 99')
      expect(view.getState().visibleRange.end).toBe(100)
      assertNativeCaret(view, text.length)
      const savedScroll = view.getState().scrollTop

      hideHost(host, 'display:none')
      await browserFrames(3)
      expect(view.getState().mountedRows).toEqual([])
      showHost(host)
      await browserFrames(3)
      expect(view.getState().scrollTop).toBe(savedScroll)
      expect(view.getState().mountedRows.at(-1)?.text).toBe('line 99')
      expect(tokenRangesIn(host)).toHaveLength(1)
      assertNativeCaret(view, text.length)
    })

    it('restores folded and wrapped long-line content at its saved deep scroll position', async () => {
      const { view, host } = mount({ wrap: true })
      const text = `header\n${'abcdefghij '.repeat(400)}\nfold head\nfold body\nfooter`
      setHighlightedText(view, text)
      const foldStart = text.indexOf('fold head')
      const foldEnd = text.indexOf('footer') - 1
      view.setFoldMap(
        createFoldMap(createPieceTableSnapshot(text), [
          { startIndex: foldStart, endIndex: foldEnd, startLine: 2, endLine: 3, type: 'block' },
        ]),
      )
      await browserFrames(3)
      expect(view.getState().wrapActive).toBe(true)
      expect(view.getState().foldMapActive).toBe(true)
      expect(view.getState().totalHeight).toBeGreaterThan(1_000)
      view.scrollElement.scrollTop = view.getState().totalHeight
      view.scrollElement.dispatchEvent(new Event('scroll'))
      await browserFrames(3)
      expect(view.getState().mountedRows.at(-1)?.text).toBe('footer')
      expect(view.getState().mountedRows.some((row) => row.bufferRow === 3)).toBe(false)
      view.setSelection(text.length - 2, text.length - 2)
      const savedScroll = view.getState().scrollTop
      const totalHeight = view.getState().totalHeight

      hideHost(host, 'display:none')
      await browserFrames(3)
      expect(view.getState().mountedRows).toEqual([])
      expect(tokenRangesIn(host)).toEqual([])
      showHost(host)
      await browserFrames(3)
      expect(view.getState().viewportWidth).toBe(360)
      expect(view.getState().totalHeight).toBe(totalHeight)
      expect(view.getState().scrollTop).toBe(savedScroll)
      expect(view.getState().mountedRows.at(-1)?.text).toBe('footer')
      expect(view.getState().mountedRows.some((row) => row.bufferRow === 3)).toBe(false)
      assertNativeCaret(view, text.length - 2)
    })

    it('restores horizontal long-line chunks and caret without an input event', async () => {
      const { view, host } = mount({ longLineChunkSize: 1_000, longLineChunkThreshold: 1_000 })
      const text = 'abcdefghij'.repeat(2_000)
      setHighlightedText(view, text)
      await browserFrames(3)
      view.scrollElement.scrollLeft = 8_000 * view.getState().metrics.characterWidth
      view.scrollElement.dispatchEvent(new Event('scroll'))
      await browserFrames(3)
      view.focusInput()
      view.setSelection(8_004, 8_004)
      const savedScrollLeft = view.getState().scrollLeft
      const chunks = view.getState().mountedRows[0]!.chunks.map((chunk) => chunk.startOffset)
      expect(chunks[0]).toBeGreaterThan(0)
      assertNativeCaret(view, 8_004)

      hideHost(host, 'display:none')
      await browserFrames(3)
      expect(view.getState().mountedRows).toEqual([])
      expect(view.getState().scrollLeft).toBe(savedScrollLeft)
      showHost(host)
      await browserFrames(3)
      expect(view.getState().scrollLeft).toBe(savedScrollLeft)
      expect(view.scrollElement.scrollLeft).toBe(savedScrollLeft)
      expect(view.getState().mountedRows[0]!.chunks.map((chunk) => chunk.startOffset)).toEqual(
        chunks,
      )
      expect(view.createRange(8_000, 8_010, { scrollIntoView: false })?.toString()).toBe(
        'abcdefghij',
      )
      expect(tokenRangesIn(host).length).toBeGreaterThan(0)
      assertNativeCaret(view, 8_004)
    })

    it('stays empty across hide/show cycles and a queued reveal after hidden disposal', async () => {
      const { view, host } = mount()
      setHighlightedText(view, 'alpha\nbeta\ngamma')
      view.setSelection(2, 2)
      await browserFrames(3)
      for (let cycle = 0; cycle < 3; cycle++) {
        hideHost(host, 'display:none')
        await browserFrames(3)
        expect(view.getState().mountedRows).toEqual([])
        expect(tokenRangesIn(host)).toEqual([])
        showHost(host)
        await browserFrames(3)
        expect(host.querySelector('[data-editor-virtual-row="0"]')?.textContent).toBe('alpha')
        expect(tokenRangesIn(host)).toHaveLength(3)
        assertNativeCaret(view, 2)
      }

      hideHost(host, 'display:none')
      await browserFrames(3)
      showHost(host)
      view.scrollElement.dispatchEvent(new Event('scroll'))
      view.dispose()
      views.splice(views.indexOf(view), 1)
      await browserFrames(3)
      expect(host.querySelector('.editor-virtualized')).toBeNull()
      expect(view.getState().mountedRows).toEqual([])
      expect(nativeTokenRanges()).toEqual([])
    })

    it('reveals an initially hidden static view without a text-row bootstrap', async () => {
      const { view, host } = mount({ scrollMode: 'static' }, true)
      const text = Array.from({ length: 10 }, (_, index) => `line ${index}`).join('\n')
      setHighlightedText(view, text)
      view.setSelection(4, 4)
      await browserFrames(3)
      expect(view.getState().mountedRows).toEqual([])
      expect(tokenRangesIn(host)).toEqual([])
      showHost(host)
      await browserFrames(3)
      expect(view.getState().mountedRows.map((row) => row.text)).toEqual(text.split('\n'))
      expect(tokenRangesIn(host)).toHaveLength(10)
      assertNativeCaret(view, 4)
      hideHost(host, 'zero-height')
      await browserFrames(3)
      expect(view.getState().mountedRows).toEqual([])
      expect(tokenRangesIn(host)).toEqual([])
      showHost(host)
      await browserFrames(3)
      expect(view.getState().mountedRows).toHaveLength(10)
      assertNativeCaret(view, 4)
    })

    it('restores a deep logical scroll beyond the native height cap', async () => {
      const { view, host } = mount({
        overscan: 0,
        gutterContributions: [createLineGutterContribution()],
      })
      const text = 'x\n'.repeat(900_000) + 'final'
      setHighlightedText(view, text)
      await browserFrames(3)
      expect(view.getState().totalHeight).toBe(18_000_020)
      view.scrollElement.scrollTop = 17_000_000
      view.scrollElement.dispatchEvent(new Event('scroll'))
      await browserFrames(3)
      const state = view.getState()
      const firstRow = state.mountedRows.find((row) => row.index === state.visibleRange.start)!
      const offset = firstRow.startOffset
      view.focusInput()
      view.setSelection(offset, offset)
      expect(state.scrollTop).toBeGreaterThan(16_000_000)
      expect(firstRow.bufferRow).toBeGreaterThanOrEqual(849_999)
      expect(firstRow.text).toBe('x')
      expect(firstRow.gutterElement.getBoundingClientRect().top).toBe(
        firstRow.element.getBoundingClientRect().top,
      )
      assertNativeCaret(view, offset)
      const savedScroll = view.getState().scrollTop
      const savedRange = view.getState().visibleRange

      hideHost(host, 'display:none')
      await browserFrames(3)
      expect(view.getState().mountedRows).toEqual([])
      expect(view.getState().totalHeight).toBe(18_000_020)
      expect(view.getState().scrollTop).toBeCloseTo(savedScroll, 5)
      showHost(host)
      await browserFrames(3)
      expect(view.getState().scrollTop).toBeCloseTo(savedScroll, 5)
      expect(view.getState().visibleRange).toEqual(savedRange)
      expect(view.createRange(offset, offset + 1, { scrollIntoView: false })?.toString()).toBe('x')
      expect(tokenRangesIn(host).length).toBeGreaterThan(0)
      assertNativeCaret(view, offset)
    })

    it('preserves indexed row heights and deep logical position across real zero geometry', async () => {
      const host = createHost()
      const element = document.createElement('div')
      element.style.cssText = 'flex:1;overflow:auto'
      host.append(element)
      const spacer = document.createElement('div')
      spacer.style.height = '6000px'
      element.append(spacer)
      const virtualizer = new FixedRowVirtualizer({
        count: 200,
        rowHeight: 20,
        rowSizes: Array.from({ length: 200 }, (_, index) => (index % 2 === 0 ? 20 : 40)),
        overscan: 3,
      })
      virtualizers.push(virtualizer)
      virtualizer.attachScrollElement(element)
      await browserFrames(3)
      element.scrollTop = 3_000
      element.dispatchEvent(new Event('scroll'))
      await browserFrames(3)
      const visible = virtualizer.getSnapshot()
      expect(visible.virtualItems.length).toBeGreaterThan(0)
      expect(visible.scrollTop).toBe(3_000)
      hideHost(host, 'zero-height')
      await browserFrames(3)
      expect(virtualizer.getSnapshot().virtualItems).toEqual([])
      expect(virtualizer.getSnapshot().totalSize).toBe(6_000)
      expect(virtualizer.getSnapshot().scrollTop).toBe(3_000)
      showHost(host)
      await browserFrames(3)
      expect(virtualizer.getSnapshot().visibleRange).toEqual(visible.visibleRange)
      expect(virtualizer.getSnapshot().virtualItems).toEqual(visible.virtualItems)
    })
  },
)

async function browserFrames(count: number): Promise<void> {
  for (let index = 0; index < count; index++) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  }
}

function nativeTokenRanges(): AbstractRange[] {
  return [...CSS.highlights.entries()]
    .filter(([name]) => name.startsWith('editor-shared-token-'))
    .flatMap(([, highlight]) => [...highlight])
}

function tokenRangesIn(host: HTMLElement): AbstractRange[] {
  return nativeTokenRanges().filter((range) => host.contains(range.startContainer))
}

function fullTextTokens(text: string): readonly EditorToken[] {
  return [{ start: 0, end: text.length, style: { color: '#ff0000' } }]
}

function setHighlightedText(view: VirtualizedTextView, text: string): void {
  view.setText(text)
  view.setTokens(fullTextTokens(text))
}

function hideHost(host: HTMLElement, mode: string): void {
  if (mode === 'display:none') {
    host.style.display = 'none'
    return
  }
  host.style.height = '0px'
}

function showHost(host: HTMLElement): void {
  host.style.display = 'flex'
  host.style.height = '120px'
}

function assertNativeCaret(view: VirtualizedTextView, offset: number): void {
  const caret = view.scrollElement.querySelector<HTMLElement>('.editor-virtualized-caret')!
  const nativeRange = view.createRange(offset, offset, { scrollIntoView: false })
  expect(nativeRange).not.toBeNull()
  expect(caret.hidden).toBe(false)
  const native = nativeRange!.getBoundingClientRect()
  const drawn = caret.getBoundingClientRect()
  expect(native.height).toBeGreaterThan(0)
  expect(drawn.height).toBeGreaterThan(0)
  expect(Math.abs(drawn.left - native.left)).toBeLessThan(1.5)
  expect(Math.abs(drawn.top - native.top)).toBeLessThan(5)
  const viewport = view.scrollElement.getBoundingClientRect()
  expect(drawn.left).toBeGreaterThanOrEqual(viewport.left - 1)
  expect(drawn.left).toBeLessThan(viewport.right)
  expect(drawn.top).toBeGreaterThanOrEqual(viewport.top - 1)
  expect(drawn.top).toBeLessThan(viewport.bottom)
}
