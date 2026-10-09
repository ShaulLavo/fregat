export type HighlightOverlay = {
  /** Remaining opacity, from zero to one. */
  readonly dim?: number
  readonly textDecoration?: string
}
export type HighlightOverlayRange = {
  readonly start: number
  readonly end: number
  readonly overlay: HighlightOverlay
}
export type HighlightOverlayPart = {
  readonly start: number
  readonly end: number
  readonly overlay?: HighlightOverlay
}

type Edge = { readonly at: number; readonly id: number; readonly overlay?: HighlightOverlay }

export function buildHighlightOverlayMask(
  ranges: readonly HighlightOverlayRange[],
  length: number,
  codeUnit: (offset: number) => number,
): readonly HighlightOverlayRange[] {
  const edges: Edge[] = []
  const normalized = new Map<HighlightOverlay, HighlightOverlay>()
  for (const [id, range] of ranges.entries()) {
    validateHighlightOverlay(range.overlay)
    let start = Math.max(0, Math.min(length, Math.trunc(range.start)))
    let end = Math.max(0, Math.min(length, Math.trunc(range.end)))
    if (end <= start) continue
    if (splitsSurrogate(start, length, codeUnit)) start--
    if (splitsSurrogate(end, length, codeUnit)) end++
    const overlay = normalizeOverlay(range.overlay, normalized)
    if (!overlay) continue
    edges.push({ at: start, id, overlay }, { at: end, id })
  }
  edges.sort((left, right) => left.at - right.at)
  const active = new Map<number, HighlightOverlay>()
  const mask: HighlightOverlayRange[] = []
  let previous = edges[0]?.at ?? 0
  for (let index = 0; index < edges.length;) {
    const at = edges[index]!.at
    appendOverlay(mask, previous, at, activeOverlay(active))
    while (index < edges.length && edges[index]!.at === at) {
      const edge = edges[index++]!
      if (edge.overlay) active.set(edge.id, edge.overlay)
      else active.delete(edge.id)
    }
    previous = at
  }
  return mask
}

// Every spelling range shares one style. Parse that CSS once per mask, then reuse it between edges.
function normalizeOverlay(
  overlay: HighlightOverlay,
  cache: Map<HighlightOverlay, HighlightOverlay>,
): HighlightOverlay | undefined {
  const cached = cache.get(overlay)
  if (cached) return cached
  const normalized = mergedOverlay([overlay])
  if (normalized) cache.set(overlay, normalized)
  return normalized
}

function activeOverlay(
  active: ReadonlyMap<number, HighlightOverlay>,
): HighlightOverlay | undefined {
  if (active.size === 0) return undefined
  if (active.size === 1) return active.values().next().value
  return mergedOverlay(active.values())
}

export function validateHighlightOverlay(overlay: HighlightOverlay): void {
  if (overlay.dim === undefined) return
  if (Number.isFinite(overlay.dim) && overlay.dim >= 0 && overlay.dim <= 1) return
  throw new RangeError('Highlight overlay opacity must be between zero and one')
}

export function splitHighlightOverlay(
  start: number,
  end: number,
  mask: readonly HighlightOverlayRange[],
): readonly HighlightOverlayPart[] {
  const parts: HighlightOverlayPart[] = []
  let low = 0
  let high = mask.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (mask[middle]!.end <= start) low = middle + 1
    else high = middle
  }
  let cursor = start
  for (let index = low; index < mask.length && cursor < end; index++) {
    const segment = mask[index]!
    if (segment.start >= end) break
    const from = Math.max(cursor, segment.start)
    if (from > cursor) parts.push({ start: cursor, end: from })
    cursor = Math.min(end, segment.end)
    parts.push({ start: from, end: cursor, overlay: segment.overlay })
  }
  if (cursor < end) parts.push({ start: cursor, end })
  return parts
}

function splitsSurrogate(
  offset: number,
  length: number,
  codeUnit: (offset: number) => number,
): boolean {
  if (offset <= 0 || offset >= length) return false
  const before = codeUnit(offset - 1)
  const after = codeUnit(offset)
  return before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff
}

function mergedOverlay(overlays: Iterable<HighlightOverlay>): HighlightOverlay | undefined {
  let dim = 1
  const decorations: (string | undefined)[] = []
  for (const overlay of overlays) {
    dim = Math.min(dim, overlay.dim ?? 1)
    decorations.push(overlay.textDecoration)
  }
  const textDecoration = mergeTextDecorations(decorations)
  if (dim === 1 && !textDecoration) return undefined
  return {
    ...(dim < 1 ? { dim } : {}),
    ...(textDecoration ? { textDecoration } : {}),
  }
}

function appendOverlay(
  mask: HighlightOverlayRange[],
  start: number,
  end: number,
  overlay: HighlightOverlay | undefined,
): void {
  if (!overlay || end <= start) return
  const previous = mask.at(-1)
  if (
    previous?.end === start &&
    previous.overlay.dim === overlay.dim &&
    previous.overlay.textDecoration === overlay.textDecoration
  ) {
    mask[mask.length - 1] = { start: previous.start, end, overlay: previous.overlay }
    return
  }
  mask.push({ start, end, overlay })
}

export function overlayColorStyle<
  T extends { readonly color?: string; readonly textDecoration?: string },
>(style: T, overlay: HighlightOverlay, dimmable = true): T & { readonly color: string } {
  const base = style.color ?? 'var(--editor-foreground)'
  const opacity = dimmable ? (overlay.dim ?? 1) : 1
  const color = opacity === 1 ? base : `color-mix(in srgb, ${base} ${opacity * 100}%, transparent)`
  const textDecoration = mergeTextDecorations([style.textDecoration, overlay.textDecoration])
  return { ...style, color, ...(textDecoration ? { textDecoration } : {}) }
}

const TEXT_DECORATION_LINES = new Set(['underline', 'overline', 'line-through', 'blink'])

/**
 * Unions the line keywords and keeps the first value's style, color and thickness. CSS requires the
 * line keywords to be contiguous, so `underline wavy red line-through` would drop the declaration.
 */
function mergeTextDecorations(values: readonly (string | undefined)[]): string {
  const lines = new Set<string>()
  let rest: readonly string[] | null = null
  for (const value of values) {
    const words = textDecorationWords(value ?? '')
    for (const word of words) if (TEXT_DECORATION_LINES.has(word)) lines.add(word)
    const others = words.filter((word) => word !== 'none' && !TEXT_DECORATION_LINES.has(word))
    if (!rest && others.length) rest = others
  }
  return Array.from(lines)
    .concat(rest ?? [])
    .join(' ')
}

// Splits on whitespace outside parentheses, so `rgb(0 0 0)` stays one word.
function textDecorationWords(value: string): string[] {
  const words: string[] = []
  let depth = 0
  let word = ''
  for (const character of value) {
    if (character === '(') depth++
    if (character === ')') depth = Math.max(0, depth - 1)
    if (depth > 0 || !/\s/.test(character)) {
      word += character
      continue
    }
    if (word) words.push(word)
    word = ''
  }
  if (word) words.push(word)
  return words
}
