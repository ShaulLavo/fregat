import { activeComposerMention, collectComposerMentions } from '@workspace/contracts'

export type ComposerMentionSpan = {
  readonly start: number
  readonly end: number
  readonly path: string
  /** Stable while the mention's text is: its source and how many equal ones come before it. */
  readonly key: string
}

/**
 * The mentions to paint as chips. A mention still being typed at the caret stays text, unless it
 * was already a chip: deleting the blank after a chip must not turn it back into letters, or the
 * next Backspace would eat one character instead of the chip.
 */
export function composerMentionSpans(
  text: string,
  caret: number | null,
  chipped: ReadonlySet<string>,
): readonly ComposerMentionSpan[] {
  const typing = caret === null ? null : activeComposerMention(text, caret)
  const seen = new Map<string, number>()
  const spans: ComposerMentionSpan[] = []

  for (const token of collectComposerMentions(text)) {
    const ordinal = seen.get(token.source) ?? 0
    seen.set(token.source, ordinal + 1)
    const key = `${token.source}#${ordinal}`
    if (typing?.start === token.start && !chipped.has(key)) continue

    spans.push({ end: token.end, key, path: token.path, start: token.start })
  }

  return spans
}
