import {
  DOCUMENT_PAINT_LIMITS,
  type DocumentPaintRow,
  type DocumentPaintStyle,
  type SavedDocumentPaint,
} from '../editor/documentPaint'

export type ActivatedPaintSnapshotHighlights = { dispose(): void }

type PaintGroup = {
  readonly style: DocumentPaintStyle
  readonly ranges: Range[]
}
type PaintSlice = { readonly index: number; readonly node: Text; readonly start: number }
type RunCursor = { index: number; offset: number }

const SHAPING_KEYS = [
  'fontWeight',
  'fontStyle',
  'fontSize',
  'fontFamily',
  'visibility',
  'letterSpacing',
  'fontFeatureSettings',
  'fontVariationSettings',
  'fontKerning',
  'fontVariantLigatures',
] as const
const PAINT_KEYS = ['color', 'backgroundColor', 'textDecoration'] as const
const PENDING_CLASS = 'editor-document-paint-pending'
const active = new WeakMap<HTMLElement, ActivatedPaintSnapshotHighlights>()
let nextHighlightId = 0

/** Run in the head before streamed snapshot markup becomes available. */
export function prepareDocumentPaintHighlights(document: Document): void {
  const html = document.documentElement
  if (document.readyState !== 'loading' || html.dataset.editorDocumentPaintKey) return
  // A document-local key prevents serialized readiness from bypassing a fresh gate.
  const key = document.defaultView!.crypto.randomUUID()
  const selector = `html.${PENDING_CLASS} [data-editor-document-paint]:not([data-editor-document-paint-ready="${key}"])`
  const stylesheet = document.createElement('style')
  stylesheet.textContent = `${selector},${selector} *{visibility:hidden!important}`
  document.head.append(stylesheet)
  html.dataset.editorDocumentPaintKey = key
  html.classList.add(PENDING_CLASS)
  // Interactive marks parsing completion before deferred scripts finish loading.
  const reveal = () => {
    if (document.readyState === 'loading') return
    html.classList.remove(PENDING_CLASS)
    delete html.dataset.editorDocumentPaintKey
    stylesheet.remove()
    document.removeEventListener('readystatechange', reveal)
  }
  document.addEventListener('readystatechange', reveal)
}

export function revealDocumentPaintHighlights(root: HTMLElement): void {
  const key = root.ownerDocument.documentElement.dataset.editorDocumentPaintKey
  if (key) root.dataset.editorDocumentPaintReady = key
}

export function canHighlightDocumentPaintRow(row: DocumentPaintRow): boolean {
  return row.runs.every(
    (run) => !run.href && SHAPING_KEYS.every((key) => run.style[key] === row.style[key]),
  )
}

export function activateDocumentPaintHighlights(
  root: HTMLElement,
  paint: SavedDocumentPaint,
): ActivatedPaintSnapshotHighlights | null {
  try {
    if (!root.hasAttribute('data-editor-document-paint')) return null
    const slices = collectSlices(root, paint)
    if (!slices) return null
    const groups = new Map<string, PaintGroup>()
    let index = -1
    let cursor: RunCursor = { index: 0, offset: 0 }
    for (const slice of slices) {
      if (slice.index !== index) {
        index = slice.index
        cursor = { index: 0, offset: 0 }
      }
      appendGroups(groups, paint.rows[index]!, slice.node, slice.start, cursor)
    }
    return registerHighlights(root, groups)
  } finally {
    revealDocumentPaintHighlights(root)
  }
}

function registerHighlights(
  root: HTMLElement,
  groups: ReadonlyMap<string, PaintGroup>,
): ActivatedPaintSnapshotHighlights | null {
  const document = root.ownerDocument
  const view = document.defaultView as (Window & typeof globalThis) | null
  const registry = view?.CSS?.highlights
  if (groups.size && (!registry || !view?.Highlight)) return null
  const stylesheet = document.createElement('style')
  const registrations = new Map<string, Highlight>()
  const clear = () => {
    for (const [name, highlight] of registrations) {
      if (registry!.get(name) === highlight) registry!.delete(name)
    }
    stylesheet.remove()
  }
  try {
    if (groups.size) document.head.append(stylesheet)
    for (const group of groups.values()) {
      let name: string
      do name = `editor-document-paint-${nextHighlightId++}`
      while (registry!.has(name))
      const highlight = new view!.Highlight()
      for (const range of group.ranges) highlight.add(range)
      const sheet = stylesheet.sheet!
      const index = sheet.insertRule(`::highlight(${name}) {}`)
      const rule = sheet.cssRules[index] as CSSStyleRule
      for (const key of PAINT_KEYS) rule.style[key] = group.style[key]
      registry!.set(name, highlight)
      registrations.set(name, highlight)
    }
  } catch (error) {
    clear()
    throw error
  }
  active.get(root)?.dispose()
  let disposed = false
  const handle: ActivatedPaintSnapshotHighlights = {
    dispose() {
      if (disposed) return
      disposed = true
      clear()
      if (active.get(root) === handle) active.delete(root)
    },
  }
  active.set(root, handle)
  return handle
}

function collectSlices(root: HTMLElement, paint: SavedDocumentPaint): PaintSlice[] | null {
  const rows = paint.rows.map((row) => ({
    text: row.runs.map((run) => run.text).join(''),
    highlight: canHighlightDocumentPaintRow(row),
  }))
  const maxRows = Math.min(
    DOCUMENT_PAINT_LIMITS.rows,
    rows.reduce((count, item) => count + Math.max(1, item.text.length), 0),
  )
  // Each run contributes at most a link wrapper, link and text; wrapping splits one run.
  const budget = {
    nodes: 3 * (maxRows + paint.rows.reduce((count, row) => count + row.runs.length, 0)),
  }
  const gutter = root.firstChild
  if (gutter?.nodeType !== 1 || (gutter as Element).getAttribute('aria-hidden') !== 'true')
    return null
  const slices: PaintSlice[] = []
  let index = 0
  let start = 0
  let visual = 0
  for (let child = gutter.nextSibling; child; child = child.nextSibling) {
    if (child.nodeType !== 1 || visual >= maxRows) return null
    const element = child as HTMLElement
    const item = rows[index]
    if (
      !item ||
      element.dataset.editorDocumentPaintRow !== String(visual) ||
      element.dataset.editorDocumentPaintSourceRow !== String(index) ||
      element.dataset.editorDocumentPaintStart !== String(start)
    )
      return null
    const text = readSliceText(element, item.text.length - start, budget)
    if (text === null || text !== item.text.slice(start, start + text.length)) return null
    if (!text.length && item.text.length) return null
    if (text.length && item.highlight) {
      if (element.childNodes.length !== 1 || element.firstChild!.nodeType !== 3) return null
      slices.push({ index, node: element.firstChild as Text, start })
    }
    start += text.length
    visual++
    if (start === item.text.length) {
      index++
      start = 0
    }
  }
  return index === rows.length ? slices : null
}

function readSliceText(
  element: HTMLElement,
  maxLength: number,
  budget: { nodes: number },
): string | null {
  const walker = element.ownerDocument.createTreeWalker(element)
  const fragments: string[] = []
  let length = 0
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (--budget.nodes < 0) return null
    if (node.nodeType === 1) {
      if (!['SPAN', 'A'].includes((node as Element).tagName)) return null
      continue
    }
    if (node.nodeType !== 3) return null
    const text = node as Text
    length += text.length
    if (length > maxLength) return null
    fragments.push(text.data)
  }
  return fragments.join('')
}

function appendGroups(
  groups: Map<string, PaintGroup>,
  row: DocumentPaintRow,
  node: Text,
  start: number,
  cursor: RunCursor,
): void {
  const end = start + node.length
  while (cursor.index < row.runs.length && cursor.offset < end) {
    const run = row.runs[cursor.index]!
    const runEnd = cursor.offset + run.text.length
    const from = Math.max(0, cursor.offset - start)
    const to = Math.min(node.length, runEnd - start)
    if (to > from && !PAINT_KEYS.every((key) => run.style[key] === row.style[key])) {
      const key = JSON.stringify(PAINT_KEYS.map((property) => run.style[property]))
      const group = groups.get(key) ?? { style: run.style, ranges: [] }
      const range = node.ownerDocument.createRange()
      range.setStart(node, from)
      range.setEnd(node, to)
      group.ranges.push(range)
      groups.set(key, group)
    }
    if (runEnd > end) break
    cursor.index++
    cursor.offset = runEnd
  }
}
