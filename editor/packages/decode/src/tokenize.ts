// Approximates how an LLM tokenizer chunks a line: a leading space sticks to the
// word/punctuation that follows it (GPT-style "▁word"), each punctuation mark is
// its own token, and a run of whitespace with no following glyph (indentation,
// trailing space) is one token. Good enough to *read* as token-by-token; we only
// need the chunk lengths, never the chunk text.
const TOKEN = / ?[A-Za-z0-9_]+| ?[^A-Za-z0-9_\s]|\s+/g
const HAS_WORD = /[A-Za-z0-9_]/

/**
 * Splits a line into LLM-ish token lengths (character counts). The lengths sum
 * to `text.length` and partition it with no gaps, so cumulative sums land on
 * real character boundaries — which is what the token reveal clips to.
 *
 * Trailing punctuation is folded into the token before it. A closing bracket is
 * the last glyph on most code lines, and a left-to-right clip can only ever
 * reveal it last; emitted as its own token it lands a whole step *after* the
 * line already looks complete, so every row reads as briefly "missing" its
 * bracket. Folding the line's trailing punctuation run into the preceding token
 * makes the bracket arrive in the same step as its line-mates, never alone.
 */
export function tokenizeLengths(text: string): number[] {
  const tokens = text.match(TOKEN) ?? []
  foldTrailingPunctuation(tokens)
  return tokens.map((token) => token.length)
}

// Merge the line's trailing run of punctuation/whitespace tokens into the token
// before it, so the final reveal step never lands on a bare bracket. Mutates in
// place; concatenation preserves the partition (lengths still sum to text.length).
function foldTrailingPunctuation(tokens: string[]): void {
  while (tokens.length > 1) {
    const trailing = tokens[tokens.length - 1]
    if (trailing === undefined || HAS_WORD.test(trailing)) return

    tokens.pop()
    const previous = tokens[tokens.length - 1]
    if (previous === undefined) return

    tokens[tokens.length - 1] = previous + trailing
  }
}
