import { afterAll, beforeAll, expect, test } from 'vitest'
import { launchBrowser } from './agent/browser-launch.ts'
import { chromiumUnavailable } from './agent/browser-prerequisites.ts'
import { auditHighlightRanges } from '../apps/web/scripts/editor-scroll-benchmark-ranges.mjs'

const it = test.skipIf(chromiumUnavailable)
let browser

beforeAll(async () => {
  if (!chromiumUnavailable) browser = await launchBrowser('chromium', false)
})
afterAll(async () => {
  await browser?.close()
})

it.each([
  { width: 1440, height: 1000 },
  { width: 390, height: 844 },
])('accepts source-dense current rows at $width × $height', async (viewport) => {
  const audit = await observe('valid', viewport)
  expect(audit.rangeCount).toBe(357)
  expect(audit.renderedRows).toBe(51)
  expect(audit.violationCount).toBe(0)
  expect(audit.viewport).toEqual(viewport)
})

it.each([
  ['disconnected', 'disconnectedRanges'],
  ['foreign', 'foreignRanges'],
  ['cross-row', 'foreignRanges'],
  ['collapsed', 'invalidRanges'],
  ['duplicate', 'duplicateRanges'],
  ['cross-style', 'overlappingSyntaxRanges'],
  ['overlap', 'overlappingSyntaxRanges'],
  ['stale-text', 'sourceMismatchRows'],
])('rejects %s native highlight ranges', async (fault, reason) => {
  const audit = await observe(fault)
  expect(audit.violations[reason]).toBeGreaterThan(0)
  expect(audit.violationCount).toBeGreaterThan(0)
})

it('allows search decorations to overlap syntax', async () => {
  const audit = await observe('decoration')
  expect(audit.rangeCount).toBe(358)
  expect(audit.violationCount).toBe(0)
})

it('maps horizontally windowed chunks to their source', async () => {
  const audit = await observe('chunked')
  expect(audit.rangeCount).toBe(357)
  expect(audit.violationCount).toBe(0)
})

it('accepts mutable DOM ranges', async () => {
  const audit = await observe('mutable')
  expect(audit.rangeCount).toBe(357)
  expect(audit.violationCount).toBe(0)
})

async function observe(fault, viewport = { width: 1440, height: 1000 }) {
  const page = await browser.newPage({ viewport })
  try {
    const sourceLines = await page.evaluate(mountFixture, fault)
    return await page.evaluate(auditHighlightRanges, sourceLines)
  } finally {
    await page.close()
  }
}

function mountFixture(fault) {
  const sourceLines = Array.from(
    { length: 51 },
    (_, index) => `line${index}: ${'token '.repeat(7)}`,
  )
  const scroller = document.createElement('div')
  scroller.className = 'editor-virtualized'
  document.body.append(scroller)
  const highlight = new Highlight()
  CSS.highlights.set('editor-shared-token-0', highlight)
  const rows = sourceLines.map(mountRow)
  const first = rows[0].firstChild
  const boundaries = { startContainer: first, startOffset: 0, endContainer: first, endOffset: 1 }
  if (fault === 'duplicate') highlight.add(new StaticRange(boundaries))
  if (fault === 'cross-style')
    CSS.highlights.set('editor-shared-token-1', new Highlight(new StaticRange(boundaries)))
  if (fault === 'overlap') highlight.add(new StaticRange({ ...boundaries, endOffset: 2 }))
  if (fault === 'collapsed') highlight.add(new StaticRange({ ...boundaries, endOffset: 0 }))
  if (fault === 'cross-row')
    highlight.add(new StaticRange({ ...boundaries, endContainer: rows[1].firstChild }))
  if (fault === 'stale-text') first.textContent = 'stale '.repeat(10)
  if (fault === 'disconnected') rows[0].remove()
  if (fault === 'foreign') document.body.append(rows[0])
  if (fault === 'decoration')
    CSS.highlights.set('search-match', new Highlight(new StaticRange(boundaries)))
  return sourceLines

  function mountRow(source, index) {
    const row = document.createElement('div')
    row.className = 'editor-virtualized-row'
    row.dataset.editorVirtualRow = String(index)
    scroller.append(row)
    if (fault === 'chunked') return mountChunkedRow(row, source)
    row.textContent = source
    for (let offset = 0; offset < 7; offset += 1) addRange(row.firstChild, offset)
    return row
  }

  function mountChunkedRow(row, source) {
    row.dataset.editorVirtualWindowStart = '2'
    row.dataset.editorVirtualWindowEnd = String(source.length - 2)
    const chunk = document.createElement('span')
    chunk.textContent = source.slice(2, -2)
    row.append(chunk)
    for (let offset = 0; offset < 7; offset += 1) addRange(chunk.firstChild, offset)
    return row
  }

  function addRange(node, offset) {
    if (fault === 'mutable') {
      const range = document.createRange()
      range.setStart(node, offset)
      range.setEnd(node, offset + 1)
      highlight.add(range)
      return
    }
    highlight.add(
      new StaticRange({
        startContainer: node,
        startOffset: offset,
        endContainer: node,
        endOffset: offset + 1,
      }),
    )
  }
}
