/** A rendered block and the one-based source line it starts on. */
export type SourceAnchor = { readonly line: number; readonly top: number }

/**
 * Where source `line` sits in the rendered pane, interpolated between the blocks around it, so a
 * hundred-line fence scrolls through its rendered height instead of jumping over it.
 */
export function renderedTopForLine(anchors: readonly SourceAnchor[], line: number): number {
  const after = anchors.findIndex((anchor) => anchor.line > line)
  if (after === 0) return 0
  const before = anchors[(after < 0 ? anchors.length : after) - 1]
  if (!before) return 0
  const next = after < 0 ? null : anchors[after]!
  if (!next) return before.top
  return before.top + ((line - before.line) / (next.line - before.line)) * (next.top - before.top)
}

/** The source line at rendered offset `top`: the inverse of `renderedTopForLine`. */
export function lineForRenderedTop(anchors: readonly SourceAnchor[], top: number): number {
  const after = anchors.findIndex((anchor) => anchor.top > top)
  if (after === 0) return anchors[0]!.line
  const before = anchors[(after < 0 ? anchors.length : after) - 1]
  if (!before) return 1
  const next = after < 0 ? null : anchors[after]!
  if (!next || next.top === before.top) return before.line
  return Math.round(
    before.line + ((top - before.top) / (next.top - before.top)) * (next.line - before.line),
  )
}

/** Every rendered block's source line and offset inside the scrolling `container`, by position. */
export function sourceAnchors(container: HTMLElement): SourceAnchor[] {
  const origin = container.getBoundingClientRect().top - container.scrollTop
  const anchors: SourceAnchor[] = []
  for (const element of container.querySelectorAll<HTMLElement>('[data-source-line]')) {
    const line = Number(element.dataset.sourceLine)
    if (!Number.isFinite(line)) continue
    const rect = element.getBoundingClientRect()
    if (rect.width === 0 && rect.height === 0) continue
    anchors.push({ line, top: rect.top - origin })
    const end = Number(element.dataset.sourceEndLine)
    if (Number.isFinite(end) && end > line) anchors.push({ line: end, top: rect.bottom - origin })
  }
  return risingAnchors(anchors)
}

/** Nested blocks share tops and footnotes render out of order; keep lines rising with the page. */
export function risingAnchors(anchors: readonly SourceAnchor[]): SourceAnchor[] {
  const rising: SourceAnchor[] = []
  const byTop = anchors.toSorted((left, right) => left.top - right.top || left.line - right.line)
  for (const anchor of byTop) {
    const last = rising.at(-1)
    if (last && anchor.line <= last.line) continue
    rising.push(anchor)
  }
  return rising
}
