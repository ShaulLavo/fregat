import { decodePaintSnapshot as decodeViewportPaint, type SavedPaint } from './paintSnapshot'

export const DOCUMENT_PAINT_LIMITS = {
  bytes: 2_097_152,
  rows: 10_000,
  runs: 65_536,
  text: 1_048_576,
  height: 1_000_000,
} as const

export type DocumentPaintStyle = {
  readonly color: string
  readonly backgroundColor: string
  readonly fontWeight: string
  readonly fontStyle: string
  readonly textDecoration: string
  readonly fontSize: string
  readonly fontFamily: string
  readonly visibility: 'visible' | 'hidden'
  readonly letterSpacing: string
  readonly fontFeatureSettings: string
  readonly fontVariationSettings: string
}

export type DocumentPaintRun = {
  readonly text: string
  readonly style: DocumentPaintStyle
  readonly href: string | null
}

export type DocumentPaintRow = {
  readonly height: number
  readonly style: DocumentPaintStyle
  readonly runs: readonly DocumentPaintRun[]
  readonly heading: { readonly level: number; readonly name: string; readonly id: string } | null
  readonly gutterBackgroundColor: string
  readonly gutterInsetBackgroundColor: string
  readonly gutter: readonly {
    readonly text: string
    readonly width: number
    readonly color: string
    readonly backgroundColor: string
    readonly paddingRight: number
  }[]
}

export type SavedDocumentPaint = {
  readonly format: 6
  readonly scope: 'document'
  readonly appearance: string
  readonly style: DocumentPaintStyle
  readonly rowGap: number
  readonly characterWidth: number
  readonly monospace: boolean
  readonly gutterWidth: number
  readonly gutterBackgroundColor: string
  readonly tabSize: number
  readonly wrap: 'word' | 'character' | null
  readonly rows: readonly DocumentPaintRow[]
}

export type PaintSnapshot = SavedPaint | SavedDocumentPaint
export type DocumentPaintCapture =
  | { readonly status: 'ready'; readonly paint: string }
  | { readonly status: 'unsupported'; readonly reason: string }

export function encodeDocumentPaint(paint: SavedDocumentPaint): DocumentPaintCapture {
  const serialized = JSON.stringify(paint)
  if (!decodeDocumentPaint(serialized))
    return { status: 'unsupported', reason: 'document-paint-limit' }
  return { status: 'ready', paint: serialized }
}

export function decodeSnapshot(serialized: string): PaintSnapshot | null {
  if (!boundedPayload(serialized)) return null
  try {
    const value: unknown = JSON.parse(serialized)
    if (record(value) && value.format === 6) return documentPaint(value) ? value : null
    return decodeViewportPaint(serialized)
  } catch {
    return null
  }
}

export function decodeDocumentPaint(serialized: string): SavedDocumentPaint | null {
  const paint = decodeSnapshot(serialized)
  return paint?.format === 6 ? paint : null
}

export function safePaintLink(href: string): boolean {
  // Browsers strip URL controls before protocol detection; refuse them before normalization.
  // eslint-disable-next-line no-control-regex
  if (!href || href.length > 4096 || /[\u0000-\u0020\u007f\\]/.test(href)) return false
  if (href.startsWith('//') || href === '#') return false
  try {
    const parsed = new URL(href, 'https://example.invalid/')
    return (
      ['https:', 'http:', 'mailto:'].includes(parsed.protocol) &&
      !parsed.username &&
      !parsed.password
    )
  } catch {
    return false
  }
}

function boundedPayload(value: string): boolean {
  return (
    value.length <= DOCUMENT_PAINT_LIMITS.bytes &&
    new TextEncoder().encode(value).length <= DOCUMENT_PAINT_LIMITS.bytes
  )
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function finite(value: unknown, maximum: number = DOCUMENT_PAINT_LIMITS.height): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= maximum
}

function text(value: unknown, maximum = 65_536): value is string {
  return typeof value === 'string' && value.length <= maximum
}

function color(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 128 &&
    /^(?:#[a-f\d]{3,8}|(?:rgb|rgba|hsl|hsla|oklch|oklab|color)\([\da-z.% ,/+-]+\)|transparent|currentcolor)$/i.test(
      value,
    )
  )
}

function style(value: unknown): value is DocumentPaintStyle {
  if (!record(value)) return false
  return (
    color(value.color) &&
    color(value.backgroundColor) &&
    text(value.fontWeight, 8) &&
    /^(?:normal|bold|[1-9]\d{0,2}|1000)$/.test(value.fontWeight) &&
    ['normal', 'italic', 'oblique'].includes(String(value.fontStyle)) &&
    text(value.textDecoration, 32) &&
    /^(?:none|underline|line-through|underline line-through)$/.test(value.textDecoration) &&
    text(value.fontSize, 32) &&
    /^\d+(?:\.\d+)?px$/.test(value.fontSize) &&
    Number.parseFloat(value.fontSize) > 0 &&
    Number.parseFloat(value.fontSize) <= 256 &&
    text(value.fontFamily, 256) &&
    /^[\w\s,'"-]+$/.test(value.fontFamily) &&
    ['visible', 'hidden'].includes(String(value.visibility)) &&
    text(value.letterSpacing, 32) &&
    /^(?:normal|-?\d+(?:\.\d+)?px)$/.test(value.letterSpacing) &&
    fontSettings(value.fontFeatureSettings) &&
    fontSettings(value.fontVariationSettings)
  )
}

function fontSettings(value: unknown): value is string {
  return text(value, 256) && /^(?:normal|[\w\d\s"',.-]+)$/.test(value)
}

function run(value: unknown): value is DocumentPaintRun {
  return (
    record(value) &&
    text(value.text) &&
    style(value.style) &&
    (value.href === null || (text(value.href, 4096) && safePaintLink(value.href)))
  )
}

function heading(value: unknown): value is DocumentPaintRow['heading'] {
  return (
    value === null ||
    (record(value) &&
      finite(value.level, 6) &&
      Number.isInteger(value.level) &&
      value.level >= 1 &&
      text(value.name) &&
      text(value.id, 256) &&
      /^[\p{L}\p{N}_:-]*$/u.test(value.id))
  )
}

function gutter(value: unknown): value is DocumentPaintRow['gutter'][number] {
  return (
    record(value) &&
    text(value.text, 256) &&
    finite(value.width, 4096) &&
    color(value.color) &&
    color(value.backgroundColor) &&
    finite(value.paddingRight, 4096)
  )
}

function row(value: unknown): value is DocumentPaintRow {
  return (
    record(value) &&
    finite(value.height, 1024) &&
    value.height > 0 &&
    style(value.style) &&
    heading(value.heading) &&
    color(value.gutterBackgroundColor) &&
    color(value.gutterInsetBackgroundColor) &&
    Array.isArray(value.runs) &&
    value.runs.length <= 16_384 &&
    value.runs.every(run) &&
    Array.isArray(value.gutter) &&
    value.gutter.length <= 32 &&
    value.gutter.every(gutter)
  )
}

function documentPaint(value: unknown): value is SavedDocumentPaint {
  if (!record(value) || value.format !== 6 || value.scope !== 'document') return false
  if (
    !text(value.appearance) ||
    !style(value.style) ||
    !finite(value.rowGap, 1024) ||
    !finite(value.characterWidth, 1024) ||
    value.characterWidth <= 0 ||
    typeof value.monospace !== 'boolean' ||
    !finite(value.gutterWidth, 4096) ||
    !color(value.gutterBackgroundColor) ||
    !finite(value.tabSize, 64) ||
    !Number.isInteger(value.tabSize) ||
    value.tabSize < 1 ||
    ![null, 'word', 'character'].includes(value.wrap as null | string)
  )
    return false
  if (
    !Array.isArray(value.rows) ||
    !value.rows.length ||
    value.rows.length > DOCUMENT_PAINT_LIMITS.rows ||
    !value.rows.every(row)
  )
    return false
  let runCount = 0
  let textLength = 0
  let height = 0
  const ids = new Set<string>()
  for (const item of value.rows) {
    runCount += item.runs.length
    textLength += item.runs.reduce((sum, item) => sum + item.text.length, 0)
    height += item.height + value.rowGap
    const id = item.heading?.id
    if (id && ids.has(id)) return false
    if (id) ids.add(id)
    if (item.gutter.reduce((sum, item) => sum + item.width, 0) > value.gutterWidth + 0.001)
      return false
  }
  return (
    runCount <= DOCUMENT_PAINT_LIMITS.runs &&
    textLength <= DOCUMENT_PAINT_LIMITS.text &&
    height <= DOCUMENT_PAINT_LIMITS.height
  )
}
