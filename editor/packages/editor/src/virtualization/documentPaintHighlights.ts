import type {
  DocumentPaintRow,
  DocumentPaintStyle,
  SavedDocumentPaint,
} from '../editor/documentPaint'

export type ActivatedPaintSnapshotHighlights = { dispose(): void }

type PaintGroup = {
  readonly style: DocumentPaintStyle
  readonly ranges: Range[]
}

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
const active = new WeakMap<HTMLElement, ActivatedPaintSnapshotHighlights>()
let nextHighlightId = 0

export function canHighlightDocumentPaintRow(row: DocumentPaintRow): boolean {
  return row.runs.every(
    (run) => !run.href && SHAPING_KEYS.every((key) => run.style[key] === row.style[key]),
  )
}

export function activateDocumentPaintHighlights(
  root: HTMLElement,
  paint: SavedDocumentPaint,
): ActivatedPaintSnapshotHighlights | null {
  if (!root.hasAttribute('data-editor-document-paint')) return null
  const groups = collectGroups(root, paint)
  if (!groups) return null
  const document = root.ownerDocument
  const view = document.defaultView as (Window & typeof globalThis) | null
  const registry = view?.CSS?.highlights
  if (groups.size && (!registry || !view?.Highlight)) return null
  const stylesheet = document.createElement('style')
  const registrations = new Map<string, Highlight>()
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
  active.get(root)?.dispose()
  let disposed = false
  const handle: ActivatedPaintSnapshotHighlights = {
    dispose() {
      if (disposed) return
      disposed = true
      for (const [name, highlight] of registrations) {
        if (registry!.get(name) === highlight) registry!.delete(name)
      }
      stylesheet.remove()
      if (active.get(root) === handle) active.delete(root)
    },
  }
  active.set(root, handle)
  return handle
}

function collectGroups(
  root: HTMLElement,
  paint: SavedDocumentPaint,
): Map<string, PaintGroup> | null {
  const groups = new Map<string, PaintGroup>()
  for (const element of root.querySelectorAll<HTMLElement>(
    '[data-editor-document-paint-source-row]',
  )) {
    const index = Number(element.dataset.editorDocumentPaintSourceRow)
    const start = Number(element.dataset.editorDocumentPaintStart)
    const row = paint.rows[index]
    const node = element.firstChild
    if (
      !Number.isInteger(index) ||
      !Number.isInteger(start) ||
      start < 0 ||
      !row ||
      !canHighlightDocumentPaintRow(row) ||
      element.childNodes.length !== 1 ||
      node?.nodeType !== 3
    )
      return null
    const text = row.runs.map((run) => run.text).join('')
    if (
      start + node.textContent!.length > text.length ||
      text.slice(start, start + node.textContent!.length) !== node.textContent
    )
      return null
    appendGroups(groups, row, node as Text, start)
  }
  return groups
}

function appendGroups(
  groups: Map<string, PaintGroup>,
  row: DocumentPaintRow,
  node: Text,
  start: number,
): void {
  let offset = 0
  for (const run of row.runs) {
    const from = Math.max(0, offset - start)
    const to = Math.min(node.length, offset + run.text.length - start)
    offset += run.text.length
    if (to <= from || PAINT_KEYS.every((key) => run.style[key] === row.style[key])) continue
    const key = JSON.stringify(PAINT_KEYS.map((property) => run.style[property]))
    const group = groups.get(key) ?? { style: run.style, ranges: [] }
    const range = node.ownerDocument.createRange()
    range.setStart(node, from)
    range.setEnd(node, to)
    group.ranges.push(range)
    groups.set(key, group)
  }
}
