import type {
  EditorViewContributionContext,
  EditorRowPresentation,
  EditorViewSnapshot,
  EditorVisibleRowSnapshot,
  EditorVisibleChunkSnapshot,
} from '@singapore-editor/core/extensions'

/** Class on the scroll element that hides the real rows until each is revealed. */
export const ACTIVE_CLASS = 'editor-decode-active'

export type DecodeRevealRow = {
  readonly presentation: EditorRowPresentation
  /** The editor's own (already syntax-highlighted) row element. */
  readonly element: HTMLElement
  /** The row's text — diffusion builds one scramble glyph per character from this. */
  readonly text: string
  /** Document offset of the row's first character — diffusion maps glyphs to token colours. */
  readonly startOffset: number
  /** Character count, used to scale the per-line reveal duration. */
  readonly length: number
  readonly leftSpacerWidth: number
  /** Row top in content coordinates (matches the live row). */
  readonly top: number
  /** Row height in px. */
  readonly height: number
  /** Rendered text width in px — the clip target and the caret's travel distance. */
  readonly width: number
}

/**
 * Matches the snapshot's visible text rows to the editor's live row elements
 * (keyed by `data-editor-virtual-row`). We animate these real, highlight-painted
 * elements directly — never a clone — so the reveal is syntax-coloured from the
 * first frame. Geometry comes from the editor's own measurements so the caret
 * rides exactly on the reveal edge.
 */
export function collectRevealRows(
  context: EditorViewContributionContext,
  snapshot: EditorViewSnapshot,
  maxRows: number,
): DecodeRevealRow[] {
  const charWidth = snapshot.metrics.characterWidth
  const rows: DecodeRevealRow[] = []
  for (const row of snapshot.visibleRows) {
    if (row.kind !== 'text' || row.text.length === 0) continue

    const mounted = mountedRowText(row)
    if (!mounted.text) continue
    const presentation = context.getRowPresentation(row.index)
    if (!presentation) continue
    rows.push({
      element: presentation.element,
      presentation,
      text: mounted.text,
      startOffset: mounted.startOffset,
      length: mounted.text.length,
      leftSpacerWidth: row.leftSpacerWidth,
      top: row.top,
      height: row.height,
      width: textWidth(
        context,
        mounted.startOffset,
        mounted.endOffset,
        mounted.text.length,
        charWidth,
      ),
    })
    if (rows.length >= maxRows) break
  }
  return rows
}

/** Exact rendered width via the editor's geometry; monospace estimate as fallback. */
function textWidth(
  context: EditorViewContributionContext,
  startOffset: number,
  endOffset: number,
  length: number,
  charWidth: number,
): number {
  const rect = context.getRangeClientRect(startOffset, endOffset)
  if (rect && rect.width > 0) return rect.width
  return length * charWidth
}

function mountedRowText(row: EditorVisibleRowSnapshot): {
  readonly text: string
  readonly startOffset: number
  readonly endOffset: number
} {
  if (typeof row.text === 'string')
    return { text: row.text, startOffset: row.startOffset, endOffset: row.endOffset }
  return {
    text: row.chunks.map(mountedChunkText).join(''),
    startOffset: row.chunks[0]?.sourceStartOffset ?? row.startOffset,
    endOffset: row.chunks.at(-1)?.sourceEndOffset ?? row.endOffset,
  }
}

function mountedChunkText(chunk: EditorVisibleChunkSnapshot): string {
  if (typeof chunk.text === 'string') return chunk.text
  if (chunk.mountedPaint.kind !== 'replayable') return ''
  return chunk.mountedPaint.parts.map((part) => part.text).join('')
}
