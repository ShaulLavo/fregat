export { DEFAULT_OVERSCAN as scrollOverscanRows } from '@singapore-editor/core'

export function auditHighlightRanges({ sourceLines, overscanRows }) {
  const violations = {
    missingRegistry: 0,
    missingEditor: 0,
    sourceMismatchRows: 0,
    invalidSourceWindows: 0,
    invalidViewportGeometry: 0,
    retainedRows: 0,
    excessRenderedRows: 0,
    disconnectedRanges: 0,
    foreignRanges: 0,
    invalidRanges: 0,
    duplicateRanges: 0,
    overlappingSyntaxRanges: 0,
  }
  const rows = new Map()
  const boundaries = new Set()
  const syntaxIntervals = new Map()
  let rangeCount = 0
  let syntaxRangeCount = 0
  let renderedCharacters = 0

  const scroller = document.querySelector('.editor-virtualized')
  if (!scroller) violations.missingEditor = 1
  const rowWindow = viewportWindow(scroller)
  for (const element of scroller?.querySelectorAll(
    '.editor-virtualized-row[data-editor-virtual-row]',
  ) ?? []) {
    const index = Number(element.dataset.editorVirtualRow)
    const start = Number(element.dataset.editorVirtualWindowStart ?? 0)
    const text = element.textContent ?? ''
    const end = Number(element.dataset.editorVirtualWindowEnd ?? start + text.length)
    const source = sourceLines?.[index]
    const validWindow = validSourceWindow(index, start, end, source)
    if (!validWindow) violations.invalidSourceWindows += 1
    if (sourceLines && source?.slice(start, end) !== text) violations.sourceMismatchRows += 1
    const rectangle = element.getBoundingClientRect()
    if (rowWindow && (rectangle.bottom < rowWindow.top || rectangle.top > rowWindow.bottom))
      violations.retainedRows += 1
    rows.set(element, { index, start, text, validWindow })
    renderedCharacters += text.length
  }
  if (rowWindow) violations.excessRenderedRows = Math.max(0, rows.size - rowWindow.maxRows)

  const registry = globalThis.CSS?.highlights
  if (!registry && sourceLines) violations.missingRegistry = 1
  for (const [name, highlight] of registry ?? []) {
    for (const range of highlight) auditRange(name, range)
  }
  for (const intervals of syntaxIntervals.values()) countOverlaps(intervals)

  return {
    rangeCount,
    syntaxRangeCount,
    renderedRows: rows.size,
    renderedCharacters,
    viewport: { width: innerWidth, height: innerHeight },
    rowWindow,
    violations,
    violationCount: Object.values(violations).reduce((sum, count) => sum + count, 0),
  }

  function viewportWindow(scroller) {
    if (!scroller) return null
    const rowHeight = Number.parseFloat(
      getComputedStyle(scroller).getPropertyValue('--editor-row-height'),
    )
    if (
      !Number.isFinite(rowHeight) ||
      rowHeight <= 0 ||
      scroller.clientHeight <= 0 ||
      !Number.isInteger(overscanRows) ||
      overscanRows < 0
    ) {
      violations.invalidViewportGeometry += 1
      return null
    }
    const top = scroller.getBoundingClientRect().top + scroller.clientTop
    // A stable window can retain one overscan span after moving by another.
    const overscanPx = 2 * overscanRows * rowHeight
    return {
      top: top - overscanPx,
      bottom: top + scroller.clientHeight + overscanPx,
      rowHeight,
      overscanRows,
      maxRows: Math.ceil(scroller.clientHeight / rowHeight) + 1 + 2 * overscanRows,
    }
  }

  function validSourceWindow(index, start, end, source) {
    if (!Number.isInteger(index) || index < 0) return false
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start) return false
    if (!sourceLines) return true
    return typeof source === 'string' && end <= source.length
  }

  function rowFor(node) {
    const element = node.nodeType === 1 ? node : node.parentElement
    return element?.closest('.editor-virtualized-row[data-editor-virtual-row]') ?? null
  }

  function auditRange(name, range) {
    rangeCount += 1
    if (!range.startContainer.isConnected || !range.endContainer.isConnected) {
      violations.disconnectedRanges += 1
      return
    }
    const row = rowFor(range.startContainer)
    if (!rows.has(row) || row !== rowFor(range.endContainer)) {
      violations.foreignRanges += 1
      return
    }
    if (!rows.get(row).validWindow) {
      violations.invalidRanges += 1
      return
    }
    const offsets = sourceOffsets(row, range)
    if (!offsets) {
      violations.invalidRanges += 1
      return
    }
    const { index, start: windowStart, text } = rows.get(row)
    const [start, end] = offsets
    if (start >= end || end > text.length) {
      violations.invalidRanges += 1
      return
    }
    const key = [name, index, windowStart + start, windowStart + end].join(':')
    if (boundaries.has(key)) violations.duplicateRanges += 1
    boundaries.add(key)
    if (!name.startsWith('editor-shared-token-')) return
    syntaxRangeCount += 1
    const intervals = syntaxIntervals.get(row) ?? []
    intervals.push({ start, end })
    syntaxIntervals.set(row, intervals)
  }

  function sourceOffsets(row, range) {
    try {
      const prefix = document.createRange()
      prefix.selectNodeContents(row)
      prefix.setEnd(range.startContainer, range.startOffset)
      const start = prefix.toString().length
      prefix.setEnd(range.endContainer, range.endOffset)
      return [start, prefix.toString().length]
    } catch {
      return null
    }
  }

  function countOverlaps(intervals) {
    intervals.sort((left, right) => left.start - right.start || left.end - right.end)
    let end = 0
    for (const interval of intervals) {
      if (interval.start < end) violations.overlappingSyntaxRanges += 1
      end = Math.max(end, interval.end)
    }
  }
}
