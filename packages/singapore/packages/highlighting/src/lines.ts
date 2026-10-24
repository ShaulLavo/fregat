import type { EditorToken, EditorTokenStyle } from '@singapore-editor/core/syntax'

export type HighlightSegment = {
  /** UTF-16 offset of the segment in the highlighted text; unique within the text. */
  readonly start: number
  readonly text: string
  /** Null where no token covers the text: it takes the theme foreground. */
  readonly style: Readonly<EditorTokenStyle> | null
}

/** Highlighted text as lines of styled runs, for renderers that draw spans. */
export function highlightLines(
  text: string,
  tokens: readonly Readonly<EditorToken>[],
): readonly (readonly HighlightSegment[])[] {
  const lines: HighlightSegment[][] = [[]]
  let offset = 0
  const advance = (end: number, style: Readonly<EditorTokenStyle> | null) => {
    while (offset < end) {
      const newline = text.indexOf('\n', offset)
      const breaks = newline !== -1 && newline < end
      const stop = breaks ? newline : end
      if (stop > offset)
        lines.at(-1)?.push({ start: offset, text: text.slice(offset, stop), style })
      if (breaks) lines.push([])
      offset = breaks ? stop + 1 : stop
    }
  }
  for (const token of tokens) {
    advance(Math.min(token.start, text.length), null)
    advance(Math.min(token.end, text.length), token.style)
  }
  advance(text.length, null)
  return lines
}
