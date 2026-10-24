import { beforeAll, expect, test, vi } from 'vitest'
import { VirtualizedTextView } from '../src/virtualization'
import {
  createNativeCarets,
  PROPORTIONAL_INTACT_NODE_CEILING,
} from '../src/virtualization/nativeCarets'
import type { EditorPerformanceDiagnostic } from '../src/editor/performanceDiagnostics'
import { RangeText } from '../src/textContent'
import { BIDI_LINE_MEASUREMENT_CEILING } from '../src/virtualization/virtualizedTextViewRows'
import { loadFreeSans } from './fixtures/freefont/load'
import '../src/style.css'

beforeAll(async () => {
  await loadFreeSans()
  const url = new URL('../../../site/src/fonts/source-serif-4.woff2', import.meta.url).href
  const face = new FontFace('Geometry Source Serif 4', `url("${url}")`)
  document.fonts.add(await face.load())
  await document.fonts.load('13px "Geometry Source Serif 4"')
})

function nativeProbe(text: string, face = 'Geometry FreeSans'): HTMLSpanElement {
  const element = document.createElement('span')
  element.style.cssText = `position:absolute;font:13px "${face}";white-space:pre;tab-size:4`
  element.textContent = text
  document.body.append(element)
  return element
}

function nativeCaretX(element: HTMLElement, offset: number): number {
  const range = document.createRange()
  range.setStart(element.firstChild!, offset)
  range.collapse(true)
  return range.getBoundingClientRect().left - element.getBoundingClientRect().left
}

test('looks up insertion boundaries inside an unchanged native ligature run', () => {
  const text = 'AV office ffi'
  const probe = nativeProbe(text)
  try {
    const carets = createNativeCarets(probe, probe.firstChild as Text)
    for (let column = 1; column < text.length; column += 1) {
      const position = nativeCaretX(probe, column)
      expect(carets.columnAt(position - 0.1, 'before')).toBe(column - 1)
      expect(carets.columnAt(position + 0.1, 'after')).toBe(column + 1)
    }
  } finally {
    probe.remove()
  }
})

test.each(['Geometry FreeSans', 'Geometry Source Serif 4'])(
  'places a scrolled %s caret at its intact native insertion position',
  (face) => {
    const repeats = Math.floor((PROPORTIONAL_INTACT_NODE_CEILING - 1) / 3)
    const text = 'ffi'.repeat(repeats)
    const target = 3 * Math.floor(repeats / 2)
    const probe = nativeProbe(text, face)
    const host = document.createElement('div')
    host.style.cssText = 'width:360px;height:100px'
    document.body.append(host)
    const view = new VirtualizedTextView(host, {
      fontFamily: `"${face}"`,
      wrap: false,
      longLineChunkSize: 512,
      longLineChunkThreshold: 1024,
      horizontalOverscanColumns: 0,
    })
    try {
      const native = nativeCaretX(probe, target)
      view.setText(text)
      view.setScrollMetrics(0, 100, 360, native - 30)
      const row = view.getState().mountedRows[0]!
      const caret = view.createRange(target, target)!
      const actual = caret.getBoundingClientRect().left - row.element.getBoundingClientRect().left
      expect(Math.abs(actual - native)).toBeLessThan(0.5)
    } finally {
      view.dispose()
      host.remove()
      probe.remove()
    }
  },
)

test('uses native insertion positions in the mounted editor ligature run', () => {
  const text = 'AV office ffi'
  const probe = nativeProbe(text)
  const host = document.createElement('div')
  host.style.cssText = 'width:360px;height:100px'
  document.body.append(host)
  const view = new VirtualizedTextView(host, { fontFamily: '"Geometry FreeSans"', wrap: false })
  try {
    view.setText(text)
    view.setScrollMetrics(0, 100, 360)
    const row = view.getState().mountedRows[0]!
    const rect = row.element.getBoundingClientRect()
    for (let column = 1; column < text.length; column += 1) {
      const native = nativeCaretX(probe, column)
      expect(Math.abs(view.caretXForOffset(column, 'after') - native)).toBeLessThan(0.1)
      expect(view.textOffsetFromViewportPoint(rect.left + native, rect.top + rect.height / 2)).toBe(
        column,
      )
    }
  } finally {
    view.dispose()
    host.remove()
    probe.remove()
  }
})

test.each([
  PROPORTIONAL_INTACT_NODE_CEILING - 1,
  PROPORTIONAL_INTACT_NODE_CEILING,
  PROPORTIONAL_INTACT_NODE_CEILING + 1,
])('keeps a %i-unit row editable across the native shaping ceiling', (length) => {
  const text = 'i'.repeat(length)
  const host = document.createElement('div')
  host.style.cssText = 'width:360px;height:100px'
  document.body.append(host)
  const view = new VirtualizedTextView(host, {
    fontFamily: '"Geometry FreeSans"',
    wrap: false,
    longLineChunkSize: 512,
    longLineChunkThreshold: 1024,
    horizontalOverscanColumns: 0,
  })
  try {
    view.setText(text)
    view.setScrollMetrics(0, 100, 360, 30_000)
    const row = view.getState().mountedRows[0]!
    expect(row.element.dataset.editorShapingCeiling).toBe(String(PROPORTIONAL_INTACT_NODE_CEILING))
    if (length < PROPORTIONAL_INTACT_NODE_CEILING) {
      expect(row.element.dataset.editorShapingGeometry).toBe('native')
      expect(row.element.textContent?.length).toBe(length)
      expect(row.textNode.length).toBe(length)
    } else {
      expect(row.element.dataset.editorShapingGeometry).toBe('approximate')
      expect(row.element.textContent!.length).toBeLessThan(length)
      expect(Number(row.element.dataset.editorVirtualWindowStart)).toBeGreaterThan(0)
    }
    view.applyEdit({ from: 0, to: 0, text: 'x' }, 'x' + text)
    expect(view.getState().mountedRows[0]!.text.length).toBe(length + 1)
    expect(view.getState().mountedRows[0]!.element.dataset.editorShapingGeometry).toBe(
      'approximate',
    )
    expect(view.createRange(0, 1)).not.toBeNull()
  } finally {
    view.dispose()
    host.remove()
  }
})

test.each([20, 2000])(
  'measures only mounted rows in a %i-line document and invalidates one edit',
  (count) => {
    const native: EditorPerformanceDiagnostic[] = []
    vi.stubGlobal('__EDITOR_PERFORMANCE_DIAGNOSTICS__', (event: EditorPerformanceDiagnostic) => {
      if (event.name === 'view.nativeShaping' && event.detail?.length !== 0) native.push(event)
    })
    const host = document.createElement('div')
    host.style.cssText = 'width:360px;height:100px'
    document.body.append(host)
    const view = new VirtualizedTextView(host, { fontFamily: '"Geometry FreeSans"', wrap: false })
    const text = Array.from({ length: count }, () => 'AV office ffi').join('\n')
    try {
      view.setText(text)
      view.setScrollMetrics(0, 100, 360)
      const mounted = view.getState().mountedRows.length
      expect(native.length).toBeLessThanOrEqual(mounted + 1)
      expect(native.length).toBeLessThan(count)
      native.length = 0
      view.setScrollMetrics(0, 100, 360, 30)
      expect(native).toHaveLength(0)
      view.applyEdit({ from: 0, to: 0, text: 'x' }, 'x' + text)
      view.scrollElement.getBoundingClientRect()
      expect(native).toHaveLength(1)
      native.length = 0
      view.setFontFamily('monospace')
      expect(native).toHaveLength(0)
      view.setFontFamily('serif')
      view.caretXForOffset(1, 'after')
      expect(native.length).toBeGreaterThan(0)
    } finally {
      view.dispose()
      host.remove()
      vi.unstubAllGlobals()
    }
  },
)

test('keeps the strict horizontal text window for monospace rows', () => {
  const text = 'i'.repeat(20_000)
  const host = document.createElement('div')
  host.style.cssText = 'width:360px;height:100px'
  document.body.append(host)
  const view = new VirtualizedTextView(host, {
    fontFamily: 'monospace',
    wrap: false,
    longLineChunkSize: 512,
    longLineChunkThreshold: 1024,
    horizontalOverscanColumns: 0,
  })
  try {
    view.setText(text)
    view.setScrollMetrics(0, 100, 360, 30000)
    const row = view.getState().mountedRows[0]!
    expect(Number(row.element.dataset.editorVirtualWindowStart)).toBeGreaterThan(0)
    expect(row.element.textContent!.length).toBeLessThan(text.length)
    expect(row.element.dataset.editorShapingGeometry).toBeUndefined()
  } finally {
    view.dispose()
    host.remove()
  }
})

test('leaves source-tree character reads out of inactive markers on intact proportional rows', () => {
  const repeats = Math.floor((PROPORTIONAL_INTACT_NODE_CEILING - 64) / 14)
  const text = Array.from({ length: 30 }, () => 'AV office ffi '.repeat(repeats)).join('\n')
  const host = document.createElement('div')
  host.style.cssText = 'width:360px;height:100px'
  document.body.append(host)
  const view = new VirtualizedTextView(host, { fontFamily: '"Geometry FreeSans"', wrap: false })
  const whitespace = vi.spyOn(RangeText.prototype, 'charAt')
  const suspicious = vi.spyOn(RangeText.prototype, 'codePointAt')
  try {
    view.setText(text)
    view.setScrollMetrics(0, 100, 360)
    view.setSelection(12, 12)
    whitespace.mockClear()
    suspicious.mockClear()
    view.applyEdit({ from: 0, to: 0, text: 'x' }, 'x' + text)
    expect(whitespace).not.toHaveBeenCalled()
    expect(suspicious).not.toHaveBeenCalled()
    view.setSelection(0, 24)
    expect(host.querySelectorAll('[data-editor-hidden-character="space"]').length).toBeGreaterThan(
      0,
    )
  } finally {
    whitespace.mockRestore()
    suspicious.mockRestore()
    view.dispose()
    host.remove()
  }
})

test('keeps an empty proportional row caret at its origin', () => {
  const probe = nativeProbe('')
  probe.style.left = '32px'
  const node = document.createTextNode('')
  probe.append(node)
  try {
    expect(createNativeCarets(probe, node).position(0)).toBe(0)
  } finally {
    probe.remove()
  }
})

test('keeps the BiDi ceiling independent of the proportional intact-node budget', () => {
  expect(BIDI_LINE_MEASUREMENT_CEILING).toBe(32_000)
  expect(PROPORTIONAL_INTACT_NODE_CEILING).toBeLessThan(BIDI_LINE_MEASUREMENT_CEILING)
  const text = 'א'.repeat(PROPORTIONAL_INTACT_NODE_CEILING + 1)
  const host = document.createElement('div')
  host.style.cssText = 'width:360px;height:100px'
  document.body.append(host)
  const view = new VirtualizedTextView(host, { fontFamily: '"Geometry FreeSans"', wrap: false })
  try {
    view.setText(text)
    view.setScrollMetrics(0, 100, 360)
    const row = view.getState().mountedRows[0]!
    expect(row.element.dataset.editorShapingGeometry).toBe('rendered')
    expect(row.element.dataset.editorShapingCeiling).toBe(String(BIDI_LINE_MEASUREMENT_CEILING))
    expect(row.element.querySelector('[data-editor-bidi-measurement-refusal]')).toBeNull()
    expect(row.element.textContent).toBe(text)
  } finally {
    view.dispose()
    host.remove()
  }
})
