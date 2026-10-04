type TokenPaintStyle = {
  readonly color: string
  readonly backgroundColor: string
  readonly textDecoration: string
  readonly textDecorationColor: string
  readonly textDecorationStyle: string
  readonly textDecorationThickness: string
}

type TokenPaintRun = {
  readonly start: number
  readonly end: number
  readonly text: string
  readonly style: TokenPaintStyle
}

type TokenPaintRow = {
  readonly start: number
  readonly end: number
  readonly text: string
  readonly mapping: 'source' | 'unmapped'
  readonly presentation: 'live' | 'saved'
}

export type TokenPaintFrame = {
  readonly at: number
  readonly window: { readonly start: number; readonly end: number } | null
  readonly rows: readonly TokenPaintRow[]
  readonly runs: readonly TokenPaintRun[]
}

type TokenPaintIdentity = {
  readonly document: string | null
  readonly revision: number | null
  readonly configuration: string
  readonly paintedGeneration: 'unknown'
}

export type TokenPaintObservation = TokenPaintFrame & { readonly identity: TokenPaintIdentity }

export type TokenPaintReference = {
  readonly identity: TokenPaintIdentity
  readonly source: string
  readonly runs: readonly TokenPaintRun[]
  readonly expected: 'colored' | 'plain'
}

export type TokenPaintHandoff = {
  readonly frame: TokenPaintObservation
  readonly subject: 'old-held' | 'requested' | 'unknown' | 'wrong-source'
  readonly mismatch: string | null
}

export type TokenPaintProbe = {
  readonly source: string
  readonly viewportSelector: string
  readonly rowSelector: string
  readonly excludedLayers: string
  readonly highlightPrefix: string
}

export function captureTokenPaint(probe: TokenPaintProbe): TokenPaintFrame {
  const sourceLines = probe.source.split('\n')
  const starts: number[] = []
  let offset = 0
  for (const line of sourceLines) {
    starts.push(offset)
    offset += line.length + 1
  }
  const rows: TokenPaintRow[] = []
  const runs: TokenPaintRun[] = []
  const viewport = document.querySelector<HTMLElement>(probe.viewportSelector)
  if (!viewport) return { at: performance.now(), window: null, rows, runs }
  const viewportBounds = viewport.getBoundingClientRect()
  const scroll = viewport.closest<HTMLElement>('.editor-virtualized')
  const rowHeight = scroll
    ? Number.parseFloat(getComputedStyle(scroll).getPropertyValue('--editor-row-height'))
    : 0
  const window =
    scroll && rowHeight > 0 && viewportBounds.height > 0
      ? {
          start: Math.floor(scroll.scrollTop / rowHeight),
          end: Math.ceil((scroll.scrollTop + viewportBounds.height) / rowHeight),
        }
      : null
  const rules = new Map<string, CSSStyleDeclaration>()
  for (const sheet of [...document.styleSheets, ...document.adoptedStyleSheets]) {
    try {
      visitRules(sheet.cssRules)
    } catch {
      continue
    }
  }
  for (const row of viewport.querySelectorAll<HTMLElement>(probe.rowSelector)) captureRow(row)
  return { at: performance.now(), window, rows, runs }

  function visitRules(list: CSSRuleList): void {
    for (const rule of list) {
      if (rule instanceof CSSGroupingRule) visitRules(rule.cssRules)
      if (!(rule instanceof CSSStyleRule)) continue
      const name = rule.selectorText.match(/::highlight\(([^)]+)\)/)?.[1]
      if (name?.startsWith(probe.highlightPrefix)) rules.set(name, rule.style)
    }
  }

  function textWithoutLayers(fragment: DocumentFragment): string {
    for (const layer of fragment.querySelectorAll(probe.excludedLayers)) layer.remove()
    return fragment.textContent ?? ''
  }

  function prefixLength(row: HTMLElement, node: Node, boundary: number): number {
    const range = document.createRange()
    range.selectNodeContents(row)
    range.setEnd(node, boundary)
    return textWithoutLayers(range.cloneContents()).length
  }

  function captureRow(row: HTMLElement): void {
    const bounds = row.getBoundingClientRect()
    if (!row.checkVisibility() || bounds.bottom <= viewportBounds.top) return
    if (bounds.top >= viewportBounds.bottom || bounds.width <= 0) return
    const content = document.createRange()
    content.selectNodeContents(row)
    const text = textWithoutLayers(content.cloneContents())
    const index = Number(row.dataset.editorVirtualRow)
    const line = Number.isInteger(index) ? index : -1
    const start = (starts[line] ?? -1) + Number(row.dataset.editorVirtualWindowStart ?? 0)
    const mapped = start >= 0 && probe.source.slice(start, start + text.length) === text
    rows.push({
      start,
      end: start + text.length,
      text,
      mapping: mapped ? 'source' : 'unmapped',
      presentation: row.hasAttribute('data-editor-provisional-row') ? 'saved' : 'live',
    })
    if (!mapped) return
    const styleProbe = document.createElement('span')
    styleProbe.style.display = 'none'
    row.append(styleProbe)
    for (const [name, highlight] of CSS.highlights)
      captureHighlight(row, start, styleProbe, name, highlight)
    for (const span of row.querySelectorAll<HTMLElement>(':scope > span[style]')) {
      if (span === styleProbe || !span.style.color || !span.textContent) continue
      const range = document.createRange()
      range.selectNodeContents(span)
      appendRun(row, start, range, styleFromComputed(getComputedStyle(span)))
    }
    styleProbe.remove()
  }

  function captureHighlight(
    row: HTMLElement,
    start: number,
    styleProbe: HTMLElement,
    name: string,
    highlight: Highlight,
  ): void {
    const declarations = rules.get(name)
    if (!declarations) return
    styleProbe.style.cssText = declarations.cssText
    styleProbe.style.display = 'none'
    const style = styleFromComputed(getComputedStyle(styleProbe))
    for (const painted of highlight) {
      if (!row.contains(painted.startContainer) || !row.contains(painted.endContainer)) continue
      const range = document.createRange()
      range.setStart(painted.startContainer, painted.startOffset)
      range.setEnd(painted.endContainer, painted.endOffset)
      appendRun(row, start, range, style)
    }
  }

  function appendRun(row: HTMLElement, start: number, range: Range, style: TokenPaintStyle): void {
    const text = textWithoutLayers(range.cloneContents())
    if (!text) return
    const runStart = start + prefixLength(row, range.startContainer, range.startOffset)
    runs.push({ start: runStart, end: runStart + text.length, text, style })
  }

  function styleFromComputed(style: CSSStyleDeclaration): TokenPaintStyle {
    return {
      color: style.color,
      backgroundColor: style.backgroundColor,
      textDecoration: style.textDecorationLine,
      textDecorationColor: style.textDecorationColor,
      textDecorationStyle: style.textDecorationStyle,
      textDecorationThickness: style.textDecorationThickness,
    }
  }
}

function tokenPaintReferenceFrame(
  reference: TokenPaintReference,
  window: NonNullable<TokenPaintFrame['window']>,
): TokenPaintObservation {
  let offset = 0
  const rows = reference.source
    .split('\n')
    .map((text) => {
      const start = offset
      offset += text.length + 1
      return {
        start,
        end: start + text.length,
        text,
        mapping: 'source',
        presentation: 'live',
      } as const
    })
    .slice(window.start, window.end)
  const runs = rows.flatMap((row) =>
    reference.runs.flatMap((run) => {
      const start = Math.max(row.start, run.start)
      const end = Math.min(row.end, run.end)
      if (start >= end) return []
      return [{ start, end, text: reference.source.slice(start, end), style: run.style }]
    }),
  )
  return { at: 0, identity: reference.identity, window, rows, runs }
}

export function tokenPaintMismatch(
  frame: TokenPaintObservation,
  reference: TokenPaintReference,
): string | null {
  if (JSON.stringify(frame.identity) !== JSON.stringify(reference.identity)) return 'identity'
  if (
    !frame.window ||
    frame.rows.length === 0 ||
    frame.rows.some((row) => row.mapping !== 'source')
  )
    return 'coverage'
  if (frame.rows.some((row) => row.presentation !== 'live')) return 'unsupported saved presentation'
  const expected = tokenPaintReferenceFrame(reference, frame.window)
  const rows = (value: TokenPaintFrame) =>
    value.rows
      .map(({ start, end, text }) => ({ start, end, text }))
      .toSorted((left, right) => left.start - right.start || left.end - right.end)
  if (JSON.stringify(rows(frame)) !== JSON.stringify(rows(expected))) return 'source rows'
  if (reference.expected === 'colored' && reference.runs.length < 2) return 'uncalibrated reference'
  if (reference.expected === 'plain' && reference.runs.length !== 0)
    return 'unexpected reference tokens'
  if (JSON.stringify(normalizedRuns(frame.runs)) !== JSON.stringify(normalizedRuns(expected.runs)))
    return 'token offsets or styles'
  return null
}

export function tokenPaintHandoff(
  frames: readonly TokenPaintObservation[],
  held: TokenPaintReference,
  requested: TokenPaintReference,
): TokenPaintHandoff[] {
  let activated = false
  return frames.map((frame) => {
    if (frame.identity.document === requested.identity.document) {
      activated = true
      return { frame, subject: 'requested', mismatch: tokenPaintMismatch(frame, requested) }
    }
    if (!activated && frame.identity.document === held.identity.document)
      return { frame, subject: 'old-held', mismatch: tokenPaintMismatch(frame, held) }
    const subject = frame.identity.document === null ? 'unknown' : 'wrong-source'
    return { frame, subject, mismatch: 'activation identity' }
  })
}

export function resolveTokenPaintRuns(input: {
  readonly source: string
  readonly viewportSelector: string
  readonly tokens: readonly {
    readonly start: number
    readonly end: number
    readonly style: {
      readonly color?: string
      readonly backgroundColor?: string
      readonly textDecoration?: string
    }
  }[]
}): TokenPaintRun[] {
  const viewport = document.querySelector<HTMLElement>(input.viewportSelector)
  if (!viewport) throw new RangeError('reference style viewport unavailable')
  const row = document.createElement('div')
  row.className = 'editor-virtualized-row'
  row.style.display = 'none'
  const probe = document.createElement('span')
  row.append(probe)
  viewport.append(row)
  try {
    return input.tokens
      .filter(({ style }) => style.color || style.backgroundColor || style.textDecoration)
      .map((token) => {
        probe.style.cssText = ''
        probe.style.color = token.style.color ?? ''
        probe.style.backgroundColor = token.style.backgroundColor ?? ''
        probe.style.textDecoration = token.style.textDecoration ?? ''
        const computed = getComputedStyle(probe)
        return {
          start: token.start,
          end: token.end,
          text: input.source.slice(token.start, token.end),
          style: {
            color: computed.color,
            backgroundColor: computed.backgroundColor,
            textDecoration: computed.textDecorationLine,
            textDecorationColor: computed.textDecorationColor,
            textDecorationStyle: computed.textDecorationStyle,
            textDecorationThickness: computed.textDecorationThickness,
          },
        }
      })
  } finally {
    row.remove()
  }
}

function normalizedRuns(runs: readonly TokenPaintRun[]): TokenPaintRun[] {
  const result: TokenPaintRun[] = []
  for (const run of runs.toSorted(
    (left, right) => left.start - right.start || left.end - right.end,
  )) {
    const previous = result.at(-1)
    if (
      previous?.end === run.start &&
      JSON.stringify(previous.style) === JSON.stringify(run.style)
    ) {
      result[result.length - 1] = { ...previous, end: run.end, text: previous.text + run.text }
      continue
    }
    result.push(run)
  }
  return result
}
