import {
  encodeDocumentPaint,
  safePaintLink,
  type DocumentPaintCapture,
  type DocumentPaintRow,
  type DocumentPaintRun,
  type DocumentPaintStyle,
} from '../editor/documentPaint'
import type { EditorTokenStyle } from '../tokens'
import type { VirtualizedTextViewInternal } from './virtualizedTextViewInternals'
import type { MountedVirtualizedTextRow } from './virtualizedTextViewTypes'
import { getMountedRows } from './virtualizedTextViewRows'

const MARKDOWN_KIND =
  /^editor-inline-(?:marker|heading-marker-[1-6]|fence-marker|task-marker|list-marker|quote-marker|link|link-marker|link-target)$/
const SAFE_INLINE_CLASS = new Set([
  'editor-virtualized-row-chunk',
  'editor-virtualized-row-spacer',
  'editor-inline-widget',
  'editor-markdown-text',
  'editor-markdown-link',
  'editor-markdown-padding',
])

export function captureDocumentPaint(
  view: VirtualizedTextViewInternal,
  appearance: string,
): DocumentPaintCapture {
  if (view.scrollMode !== 'content') return unsupported('content-layout-required')
  if (view.model.foldMap?.ranges.length) return unsupported('folded-document')
  if (view.rangeHighlightGroups.size) return unsupported('range-highlight')
  const mounted = getMountedRows(view)
  if (!mounted.length || mounted.some((row, index) => row.index !== index))
    return unsupported('incomplete-document')
  const rows: DocumentPaintRow[] = []
  let previousBufferRow = -1
  for (const row of mounted) {
    if (row.source !== 'document') return unsupported('injected-row')
    if (row.foldMarker?.collapsed) return unsupported('fold-placeholder')
    if (row.coreBidiRefusal) return unsupported('bidi-row')
    if (row.leftSpacerWidth) return unsupported('horizontally-windowed-row')
    if (row.rowDecorationClassName && !row.rowDecorationSnapshotStyle)
      return unsupported('plugin-row-style')
    if (row.rowDecorationGutterClassName && !row.rowDecorationSnapshotStyle)
      return unsupported('plugin-gutter-style')
    if (row.inlineKindsClassName.split(/\s+/).some((name) => name && !MARKDOWN_KIND.test(name)))
      return unsupported('plugin-inline-kind')
    const runs = captureRuns(view, row)
    if (!runs) return unsupported('unsafe-or-unsupported-fragment')
    const prior = rows.at(-1)
    if (prior && row.bufferRow === previousBufferRow) {
      rows[rows.length - 1] = { ...prior, runs: mergeRuns(prior.runs.concat(runs)) }
      continue
    }
    const gutter = captureGutter(view, row)
    if (!gutter) return unsupported('unsupported-gutter')
    const level = row.element.getAttribute('aria-level')
    rows.push({
      height: row.height,
      style: captureStyle(row.element),
      runs,
      heading:
        row.element.getAttribute('role') === 'heading'
          ? {
              level: Number(level),
              name: row.element.getAttribute('aria-label') ?? row.element.textContent ?? '',
              id: row.element.id,
            }
          : null,
      gutterBackgroundColor: getComputedStyle(row.gutterElement).backgroundColor,
      gutterInsetBackgroundColor: row.gutterElement.classList.contains(
        'editor-virtualized-cursor-line-gutter-band',
      )
        ? getComputedStyle(row.gutterElement, '::before').backgroundColor
        : 'transparent',
      gutter,
    })
    previousBufferRow = row.bufferRow
  }
  if (rows.length !== view.model.lineCount) return unsupported('incomplete-document')
  return encodeDocumentPaint({
    format: 6,
    scope: 'document',
    appearance,
    style: captureStyle(view.scrollElement),
    gutterBackgroundColor: getComputedStyle(view.gutterElement).backgroundColor,
    characterWidth: view.metrics.characterWidth,
    monospace: view.monospace,
    gutterWidth: view.currentGutterWidth,
    rowGap: view.rowGap,
    tabSize: view.tabSize,
    wrap: view.wrapEnabled ? view.wrapBreak : null,
    rows,
  })
}

function unsupported(reason: string): DocumentPaintCapture {
  return { status: 'unsupported', reason }
}

function captureStyle(element: HTMLElement): DocumentPaintStyle {
  const style = element.ownerDocument.defaultView!.getComputedStyle(element)
  return {
    color: style.color,
    backgroundColor: style.backgroundColor,
    fontWeight: style.fontWeight,
    fontStyle: style.fontStyle,
    textDecoration: style.textDecorationLine,
    fontSize: style.fontSize,
    fontFamily: style.fontFamily,
    letterSpacing: style.letterSpacing,
    fontFeatureSettings: style.fontFeatureSettings,
    fontVariationSettings: style.fontVariationSettings,
    fontKerning: style.fontKerning,
    fontVariantLigatures: style.fontVariantLigatures,
    visibility: style.visibility === 'hidden' ? 'hidden' : 'visible',
  }
}

function captureRuns(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
): readonly DocumentPaintRun[] | null {
  if (
    [...row.element.querySelectorAll<HTMLElement>('*')].some(
      (element) => !safeInlineParents(element, row.element),
    )
  )
    return null
  const document = row.element.ownerDocument
  const walker = document.createTreeWalker(row.element, 4)
  const nodes: Text[] = []
  for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node as Text)
  const runs: DocumentPaintRun[] = []
  const ranges = view.rowTokenRanges.get(row.tokenHighlightSlotId)
  const nodeIndexes = new Map(nodes.map((node, index) => [node, index]))
  for (const node of nodes) {
    const parent = node.parentElement!
    if (!safeInlineParents(parent, row.element)) return null
    const anchor = parent.closest('a')
    const href = anchor?.getAttribute('href') ?? null
    if (href !== null && !safePaintLink(href)) return null
    const base = captureStyle(parent)
    const cuts = new Set([0, node.length])
    const styles: {
      start: number
      end: number
      style: NonNullable<ReturnType<typeof view.tokenGroups.get>>['style']
    }[] = []
    for (const [key, tokenRanges] of ranges ?? []) {
      const group = view.tokenGroups.get(key)
      if (!group) continue
      for (const range of tokenRanges) {
        const first = nodeIndexes.get(range.startContainer as Text)
        const last = nodeIndexes.get(range.endContainer as Text)
        const index = nodeIndexes.get(node)!
        if (first === undefined || last === undefined || index < first || index > last) continue
        const start = index === first ? range.startOffset : 0
        const end = index === last ? range.endOffset : node.length
        cuts.add(start)
        cuts.add(end)
        styles.push({ start, end, style: group.style })
      }
    }
    const resolvedStyles = new Map<EditorTokenStyle, EditorTokenStyle>()
    const boundaries = [...cuts].sort((a, b) => a - b)
    for (let index = 0; index + 1 < boundaries.length; index++) {
      const start = boundaries[index]!
      const end = boundaries[index + 1]!
      if (start === end) continue
      let style = base
      for (const token of styles) {
        if (token.start > start || token.end < end) continue
        const resolved = resolvedStyles.get(token.style) ?? resolveTokenStyle(parent, token.style)
        if (!resolved) return null
        resolvedStyles.set(token.style, resolved)
        style = {
          ...style,
          color: resolved.color ?? style.color,
          backgroundColor: resolved.backgroundColor ?? style.backgroundColor,
          textDecoration: resolved.textDecoration ?? style.textDecoration,
        }
      }
      runs.push({ text: node.data.slice(start, end), style, href })
    }
  }
  return mergeRuns(runs)
}

function resolveTokenStyle(parent: HTMLElement, token: EditorTokenStyle): EditorTokenStyle | null {
  if (!token.color && !token.backgroundColor) return token
  const document = parent.ownerDocument
  const view = document.defaultView!
  const context = view.getComputedStyle(parent)
  const host = document.createElement('div')
  host.style.setProperty('all', 'initial', 'important')
  host.style.setProperty('display', 'none', 'important')
  // Shadow isolation prevents page selectors from changing the token's paint context.
  const probe = document.createElement('span')
  host.attachShadow({ mode: 'closed' }).append(probe)
  for (const property of context) {
    if (!property.startsWith('--')) continue
    probe.style.setProperty(property, context.getPropertyValue(property) || 'initial')
  }
  probe.style.color = context.color
  probe.style.colorScheme = context.colorScheme
  // Custom properties expose failed substitution before colour declarations fall back.
  if (token.color) probe.style.setProperty('--document-paint-color', token.color)
  if (token.backgroundColor)
    probe.style.setProperty('--document-paint-background', token.backgroundColor)
  document.documentElement.append(host)
  try {
    const substituted = view.getComputedStyle(probe)
    const color = substituted.getPropertyValue('--document-paint-color').trim()
    const background = substituted.getPropertyValue('--document-paint-background').trim()
    if (token.color && (!color || !view.CSS.supports('color', color))) return null
    if (
      token.backgroundColor &&
      (!background || !view.CSS.supports('background-color', background))
    )
      return null
    if (token.color) probe.style.color = color
    if (token.backgroundColor) probe.style.backgroundColor = background
    const computed = view.getComputedStyle(probe)
    return {
      ...token,
      color: token.color ? computed.color : undefined,
      backgroundColor: token.backgroundColor ? computed.backgroundColor : undefined,
    }
  } finally {
    host.remove()
  }
}

const UNREPRESENTED_EFFECTS = [
  'transform',
  'filter',
  'textShadow',
  'boxShadow',
  'backgroundImage',
] as const

function supportedInlinePaint(element: HTMLElement): boolean {
  const view = element.ownerDocument.defaultView!
  const style = view.getComputedStyle(element)
  if (style.opacity !== '1' || UNREPRESENTED_EFFECTS.some((key) => style[key] !== 'none'))
    return false
  return (['::before', '::after'] as const).every((pseudo) =>
    ['none', 'normal'].includes(view.getComputedStyle(element, pseudo).content),
  )
}

function safeInlineParents(element: HTMLElement, row: HTMLElement): boolean {
  for (
    let current: HTMLElement | null = element;
    current && current !== row;
    current = current.parentElement
  ) {
    if (!supportedInlinePaint(current)) return false
    if (current.tagName !== 'SPAN' && current.tagName !== 'A') return false
    if (current.tagName === 'A' && current.className !== 'editor-markdown-link') return false
    if ([...current.classList].some((name) => !SAFE_INLINE_CLASS.has(name))) return false
    if (current.querySelector('img,svg,iframe,script,style')) return false
  }
  return true
}

function mergeRuns(runs: readonly DocumentPaintRun[]): DocumentPaintRun[] {
  const merged: DocumentPaintRun[] = []
  for (const run of runs) {
    const prior = merged.at(-1)
    if (
      prior &&
      prior.href === run.href &&
      JSON.stringify(prior.style) === JSON.stringify(run.style)
    ) {
      merged[merged.length - 1] = { ...prior, text: prior.text + run.text }
      continue
    }
    merged.push(run)
  }
  return merged
}

function captureGutter(
  view: VirtualizedTextViewInternal,
  row: MountedVirtualizedTextRow,
): DocumentPaintRow['gutter'] | null {
  const result: DocumentPaintRow['gutter'][number][] = []
  for (const contribution of view.gutterContributions) {
    if (contribution.id !== 'line-gutter' || !contribution.snapshotRenderer) return null
    const cell = row.gutterCells.get(contribution.id)
    if (!cell) return null
    const style = getComputedStyle(cell)
    const counter = /^editor-line (\d+)$/.exec(cell.style.counterSet)
    const counterStyle = style.getPropertyValue('--editor-line-gutter-counter-style').trim()
    if (counterStyle && counterStyle !== 'decimal') return null
    if (!cell.hidden && !counter) return null
    result.push({
      text: cell.hidden ? '' : counter![1]!,
      width: view.gutterContributionWidths.get(contribution.id) ?? 0,
      color: style.color,
      backgroundColor: style.backgroundColor,
      paddingRight: Number.parseFloat(style.paddingRight) || 0,
    })
  }
  return result
}
