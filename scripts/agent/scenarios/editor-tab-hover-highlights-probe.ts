type TokenPaintStyle = {
  readonly color: string
  readonly backgroundColor: string
  readonly textDecoration: string
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
  readonly rows: readonly TokenPaintRow[]
  readonly runs: readonly TokenPaintRun[]
}

type TokenPaintIdentity = {
  readonly document: string
  readonly revision: number | null
  readonly configuration: string
}

export type TokenPaintObservation = TokenPaintFrame & { readonly identity: TokenPaintIdentity }

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
  if (!viewport) return { at: performance.now(), rows, runs }
  const viewportBounds = viewport.getBoundingClientRect()
  const rules = new Map<string, CSSStyleDeclaration>()
  for (const sheet of [...document.styleSheets, ...document.adoptedStyleSheets]) {
    try {
      visitRules(sheet.cssRules)
    } catch {
      continue
    }
  }
  for (const row of viewport.querySelectorAll<HTMLElement>(probe.rowSelector)) captureRow(row)
  return { at: performance.now(), rows, runs }

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
    const line = Number.isInteger(index) ? index : sourceLines.indexOf(text)
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
    }
  }
}

export function tokenPaintMismatch(
  frame: TokenPaintObservation,
  reference: TokenPaintObservation,
  expected: 'colored' | 'plain' = 'colored',
): string | null {
  if (JSON.stringify(frame.identity) !== JSON.stringify(reference.identity)) return 'identity'
  if (frame.rows.length === 0 || frame.rows.some((row) => row.mapping !== 'source'))
    return 'coverage'
  const rows = (value: TokenPaintFrame) =>
    value.rows.map(({ start, end, text }) => ({ start, end, text }))
  if (JSON.stringify(rows(frame)) !== JSON.stringify(rows(reference))) return 'source rows'
  if (expected === 'colored' && reference.runs.length < 2) return 'uncalibrated reference'
  if (expected === 'plain' && reference.runs.length !== 0) return 'unexpected reference tokens'
  if (JSON.stringify(normalizedRuns(frame.runs)) !== JSON.stringify(normalizedRuns(reference.runs)))
    return 'token offsets or styles'
  return null
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
