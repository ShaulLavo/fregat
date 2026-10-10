import {
  DOCUMENT_PAINT_LIMITS,
  type DocumentPaintRow,
  type DocumentPaintRun,
  type DocumentPaintStyle,
  type SavedDocumentPaint,
} from '../editor/documentPaint'
import {
  activateDocumentPaintHighlights,
  canHighlightDocumentPaintRow,
} from './documentPaintHighlights'
import { glyphAdvancesFor, PROPORTIONAL_WRAP_MARGIN_PX } from './glyphAdvances'
import { appendWordWrapText, createWordWrapLine, finishWordWrapLine } from './wordWrap'

export type MountedPaintSnapshot = {
  readonly element: HTMLElement
  readonly height: number
  readonly rowCount: number
  dispose(): void
}

export function mountDocumentPaint(
  host: HTMLElement,
  paint: SavedDocumentPaint,
  options: { readonly width?: number } = {},
): MountedPaintSnapshot | null {
  const document = host.ownerDocument
  if (!fontsReady(document, paint)) return null
  const width = options.width ?? host.clientWidth
  if (!Number.isFinite(width) || width <= paint.gutterWidth + paint.characterWidth) return null
  const root = document.createElement('div')
  root.dataset.editorDocumentPaint = ''
  applyStyle(root, paint.style)
  Object.assign(root.style, {
    position: 'relative',
    width: `${width}px`,
    whiteSpace: 'pre',
    overflow: 'visible',
    tabSize: String(paint.tabSize),
    pointerEvents: 'auto',
  })
  host.append(root)
  const glyphs = glyphAdvancesFor(root)
  if (!glyphs && paint.wrap) {
    root.remove()
    return null
  }
  const fragment = document.createDocumentFragment()
  const gutter = document.createElement('div')
  Object.assign(gutter.style, {
    position: 'absolute',
    left: '0',
    top: '0',
    bottom: '0',
    width: `${paint.gutterWidth}px`,
    backgroundColor: paint.gutterBackgroundColor,
    zIndex: '1',
  })
  gutter.setAttribute('aria-hidden', 'true')
  fragment.append(gutter)
  let top = 0
  let rowCount = 0
  const rules = {
    width: Math.max(
      1,
      width - paint.gutterWidth - paint.characterWidth - PROPORTIONAL_WRAP_MARGIN_PX,
    ),
    tabSize: paint.tabSize,
    words: paint.wrap === 'word',
    advance: glyphs ? (codePoint: number) => glyphs.advance(codePoint) : null,
    measure: paint.monospace ? undefined : glyphs?.measure,
    minimumTabAdvance: paint.monospace ? undefined : glyphs?.minimumTabAdvance,
  }
  const probe = document.createElement('div')
  probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none'
  root.append(probe)
  for (let index = 0; index < paint.rows.length; index++) {
    const row = paint.rows[index]!
    applyStyle(probe, row.style)
    const rowGlyphs = glyphAdvancesFor(probe)
    const rowRules =
      rowGlyphs && rowGlyphs !== glyphs
        ? {
            ...rules,
            width: Math.max(
              1,
              width - paint.gutterWidth - row.characterWidth - PROPORTIONAL_WRAP_MARGIN_PX,
            ),
            advance: (codePoint: number) => rowGlyphs.advance(codePoint),
            measure: rowGlyphs.measure,
            minimumTabAdvance: rowGlyphs.minimumTabAdvance,
          }
        : rules
    const text = row.runs.map((run) => run.text).join('')
    const highlight = canHighlightDocumentPaintRow(row)
    const line = createWordWrapLine()
    if (paint.wrap) {
      appendWordWrapText(line, text, 0, text.length, rowRules)
      finishWordWrapLine(line, rowRules)
    }
    const ends = [...line.ends, text.length]
    let start = 0
    for (const end of ends) {
      rowCount++
      if (
        rowCount > DOCUMENT_PAINT_LIMITS.rows ||
        top + row.height > DOCUMENT_PAINT_LIMITS.height
      ) {
        root.remove()
        return null
      }
      const element = document.createElement('div')
      element.dataset.editorDocumentPaintRow = String(rowCount - 1)
      applyStyle(element, row.style, paint.style)
      // Live rows are translated compositor layers; top positioning changes WebKit underline ink.
      element.style.cssText += `position:absolute;top:0;transform:translateY(${top}px);left:${paint.gutterWidth}px;right:0;height:${row.height}px;line-height:${row.height}px;white-space:pre;contain:style size;box-sizing:border-box;will-change:transform;`
      if (start === 0 && row.heading) {
        element.setAttribute('role', 'heading')
        element.setAttribute('aria-level', String(row.heading.level))
        element.setAttribute('aria-label', row.heading.name)
        if (row.heading.id) element.id = row.heading.id
      }
      element.dataset.editorDocumentPaintSourceRow = String(index)
      element.dataset.editorDocumentPaintStart = String(start)
      if (end > start && highlight) {
        element.append(document.createTextNode(text.slice(start, end)))
      } else appendRuns(element, row.runs, start, end, row.style)
      fragment.append(element)
      appendGutter(gutter, row, start === 0, top, paint.gutterWidth)
      top += row.height + paint.rowGap
      start = end
    }
  }
  probe.remove()
  const height = Math.max(0, top - paint.rowGap)
  root.style.height = `${height}px`
  root.append(fragment)
  const highlights = activateDocumentPaintHighlights(root, paint)
  if (!highlights) {
    root.remove()
    return null
  }
  return {
    element: root,
    height,
    rowCount,
    dispose() {
      highlights.dispose()
      root.remove()
    },
  }
}

function fontsReady(document: Document, paint: SavedDocumentPaint): boolean {
  if (document.fonts?.status !== 'loaded') return false
  const font = (style: DocumentPaintStyle) =>
    `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
  const fonts = new Set([font(paint.style)])
  for (const row of paint.rows) {
    fonts.add(font(row.style))
    for (const run of row.runs) fonts.add(font(run.style))
  }
  return [...fonts].every((font) => document.fonts.check(font))
}

function appendRuns(
  element: HTMLElement,
  runs: readonly DocumentPaintRun[],
  start: number,
  end: number,
  rowStyle: DocumentPaintStyle,
): void {
  let offset = 0
  for (const run of runs) {
    const from = Math.max(0, start - offset)
    const to = Math.min(run.text.length, end - offset)
    offset += run.text.length
    if (to <= from) continue
    if (!run.href && sameStyle(run.style, rowStyle)) {
      element.append(element.ownerDocument.createTextNode(run.text.slice(from, to)))
      continue
    }
    const span = element.ownerDocument.createElement(run.href ? 'a' : 'span')
    span.textContent = run.text.slice(from, to)
    applyStyle(span, run.style, rowStyle)
    if (run.href) {
      span.style.color = run.style.color
      span.style.textDecoration = run.style.textDecoration
      span.setAttribute('href', run.href)
      span.setAttribute('rel', 'noopener noreferrer')
      const widget = element.ownerDocument.createElement('span')
      Object.assign(widget.style, {
        display: 'inline-block',
        lineHeight: 'inherit',
        maxHeight: element.style.height,
        overflow: 'hidden',
        verticalAlign: 'top',
        whiteSpace: 'pre',
        userSelect: 'text',
      })
      widget.append(span)
      element.append(widget)
      continue
    }
    if (run.style.visibility === 'hidden') span.setAttribute('aria-hidden', 'true')
    element.append(span)
  }
}

function appendGutter(
  parent: HTMLElement,
  row: DocumentPaintRow,
  first: boolean,
  top: number,
  width: number,
): void {
  if (!width) return
  const element = parent.ownerDocument.createElement('div')
  Object.assign(element.style, {
    position: 'absolute',
    top: '0',
    transform: `translateY(${top}px)`,
    left: '0',
    height: `${row.height}px`,
    width: `${width}px`,
    display: 'flex',
    alignItems: 'center',
    lineHeight: `${row.height}px`,
    contain: 'layout paint style size',
    willChange: 'transform',
    backgroundColor: row.gutterBackgroundColor,
  })
  const inset = width - row.gutter.reduce((sum, cell) => sum + cell.width, 0)
  element.style.paddingLeft = `${inset}px`
  element.style.boxSizing = 'border-box'
  if (inset > 0) {
    const band = parent.ownerDocument.createElement('span')
    Object.assign(band.style, {
      position: 'absolute',
      left: '0',
      top: '0',
      bottom: '0',
      width: `${inset}px`,
      backgroundColor: row.gutterInsetBackgroundColor,
    })
    element.append(band)
  }
  for (const cell of row.gutter) {
    const label = parent.ownerDocument.createElement('span')
    label.textContent = first ? cell.text : ''
    Object.assign(label.style, {
      color: cell.color,
      backgroundColor: cell.backgroundColor,
      width: `${cell.width}px`,
      paddingRight: `${cell.paddingRight}px`,
      boxSizing: 'border-box',
      fontVariantNumeric: 'tabular-nums',
      display: 'inline-flex',
      alignItems: 'center',
      flex: '0 0 auto',
      height: `${row.height}px`,
      justifyContent: 'flex-end',
      contain: 'layout paint',
      paddingLeft: '2px',
      lineHeight: 'inherit',
    })
    element.append(label)
  }
  parent.append(element)
}

const STYLE_KEYS = [
  'color',
  'backgroundColor',
  'fontWeight',
  'fontStyle',
  'textDecoration',
  'fontSize',
  'fontFamily',
  'letterSpacing',
  'fontFeatureSettings',
  'fontVariationSettings',
  'fontKerning',
  'fontVariantLigatures',
  'visibility',
] as const

function sameStyle(first: DocumentPaintStyle, second: DocumentPaintStyle): boolean {
  return STYLE_KEYS.every((key) => first[key] === second[key])
}

function applyStyle(
  element: HTMLElement,
  style: DocumentPaintStyle,
  parent?: DocumentPaintStyle,
): void {
  for (const key of STYLE_KEYS) {
    if (key === 'backgroundColor') {
      if (style[key] !== 'rgba(0, 0, 0, 0)' && style[key] !== 'transparent')
        element.style[key] = style[key]
      continue
    }
    if (!parent || style[key] !== parent[key]) element.style[key] = style[key]
  }
}
