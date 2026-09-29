import type { SemanticTokenSpan } from '@singapore-editor/core/syntax'
import type * as lsp from 'vscode-languageserver-protocol'

/**
 * What the decoder threw away, one count per rejection rule.
 *
 * Counts rather than samples, and all of them zero in the healthy case. They exist because every
 * rule below discards input from an untrusted source, and a silent discard is indistinguishable
 * from a server that simply sent fewer tokens — which is how a legend ends up two thirds on the
 * floor while everything looks like it is working.
 *
 * The decoder neither aggregates nor logs. Whether these are summed per server, reported once per
 * session, or ignored is the host's policy, on the host's side of the seam: this package does not
 * know what a session is, or which server answered.
 */
export type SemanticTokenDecodeDrops = {
  /** Rule 2: `tokenTypeIndex` outside the legend. Tuple dropped, cursor still advanced. */
  readonly outOfLegendType: number
  /** Rule 4: zero-length tuple. */
  readonly zeroLength: number
  /**
   * Rule 5: the token began past the end of the text it addresses — either because `deltaLine` ran
   * past the last line, or because `character` ran past the end of the line it did reach. Both axes
   * of the same failure, and both usually mean one thing: the response describes a longer document
   * than the `lineStarts` and `textLength` it was decoded against, i.e. the host's own snapshot has
   * moved. Counting that under `zeroLength` would point the host at the server.
   *
   * The character axis is checked against `lineStarts[line + 1]`, not against `textLength`. Clamped
   * to the document alone, a `character` past the end of line 1 of a long file is still a valid
   * offset — one somewhere on line 3 — so the tuple decoded to a plausible span over unrelated text
   * and reported nothing.
   */
  readonly pastEndOfDocument: number
  /** Rule 3: modifier bits beyond the legend's length. The SPAN SURVIVES; only the bits are lost. */
  readonly unknownModifierBits: number
  /**
   * A trailing partial tuple, or a tuple carrying a value that is not a non-negative integer.
   * Neither is one of the five rules — it is input that was never a 5-tuple to begin with — but a
   * truncated frame that decoded to silence would be indistinguishable from a short answer.
   */
  readonly malformedTuple: number
}

export type SemanticTokenDecodeResult = {
  readonly spans: readonly SemanticTokenSpan[]
  readonly drops: SemanticTokenDecodeDrops
}

export type SemanticTokenDecodeDocument = {
  /** Offset of the first character of every line, ascending. */
  readonly lineStarts: readonly number[]
  /** Length of the document text in UTF-16 code units. Every offset is clamped to it. */
  readonly textLength: number
}

const TUPLE_LENGTH = 5
const MODIFIER_BITS = 32

/**
 * Turns an LSP semantic-tokens response into absolute spans with names on them.
 *
 * This is the one decoder. It lives in this package rather than in the editor because it is on the
 * *request* side of the seam — it runs on the host's schedule, against the host's legend, and the
 * editor's paint layer never sees a legend or a 5-tuple. A second implementation anywhere is a
 * defect: the relative cursor below is stateful, and its rejection rules are the kind that produce
 * plausible wrong offsets rather than exceptions. A copy that drops an out-of-legend tuple without
 * advancing the cursor corrupts every span after it and still paints something.
 *
 * Five rules, each of which exists because a real server violates it:
 *
 * 1. **Decode by index. Never invert the legend into a name-to-index map.** Real legends ship the
 *    same name at several indices — one server ships `variable` at three and `function` at two — and
 *    an inverted map silently mis-decodes every duplicate.
 * 2. **An out-of-legend `tokenTypeIndex` drops the tuple but still advances the cursor.**
 * 3. **Modifier bits beyond the legend's length are ignored, not errors.** The bitset is 32 bits
 *    wide and a legend may declare six.
 * 4. **Zero-length tuples are dropped.** They cannot paint and they are common in the wild.
 * 5. **Every offset is clamped to the document length**, and a tuple that begins past the end of
 *    the text it addresses — `deltaLine` past the last line, or `character` past the end of the
 *    line it reached — is dropped rather than throwing. Only the *start* is held to the line: an
 *    `end` beyond it is a multi-line span, which is a thing this decoder emits on purpose.
 *
 * Offsets come out absolute, in UTF-16 code units, which needs no encoding conversion at all: the
 * client declares `general.positionEncodings: ['utf-16']`, UTF-16 code units are JavaScript string
 * indices, and the editor's paint APIs take offsets.
 */
export function decodeSemanticTokens(
  data: ArrayLike<number>,
  legend: lsp.SemanticTokensLegend,
  document: SemanticTokenDecodeDocument,
): SemanticTokenDecodeResult {
  const spans: SemanticTokenSpan[] = []
  const tokenTypes = legend.tokenTypes
  const tokenModifiers = legend.tokenModifiers
  const lineStarts = document.lineStarts
  const textLength = document.textLength

  let outOfLegendType = 0
  let zeroLength = 0
  let pastEndOfDocument = 0
  let unknownModifierBits = 0
  let malformedTuple = 0

  let line = 0
  let character = 0
  let index = 0

  for (; index + TUPLE_LENGTH <= data.length; index += TUPLE_LENGTH) {
    const deltaLine = data[index] as number
    const deltaStartChar = data[index + 1] as number
    const length = data[index + 2] as number
    const tokenTypeIndex = data[index + 3] as number
    const modifierBitset = data[index + 4] as number

    if (
      !isUnsignedInteger(deltaLine) ||
      !isUnsignedInteger(deltaStartChar) ||
      !isUnsignedInteger(length) ||
      !isUnsignedInteger(tokenTypeIndex) ||
      !isUnsignedInteger(modifierBitset)
    ) {
      // The cursor cannot be advanced by a value that is not a number, and guessing would put every
      // later span at a plausible wrong offset. Stop rather than corrupt the rest.
      malformedTuple += 1
      break
    }

    // Advance first, unconditionally: every rule below may reject the tuple, and a rejection that
    // skipped the advance would shift every span after it.
    line += deltaLine
    character = deltaLine === 0 ? character + deltaStartChar : deltaStartChar

    if (line >= lineStarts.length) {
      pastEndOfDocument += 1
      continue
    }
    if (length === 0) {
      zeroLength += 1
      continue
    }

    // Rule 1: by index. Inverting the legend would collapse the duplicate names real legends carry.
    const tokenType = tokenTypes[tokenTypeIndex]
    if (tokenType === undefined) {
      outOfLegendType += 1
      continue
    }

    const lineStart = lineStarts[line] as number
    // Where the line the tuple addresses actually stops. LSP's own `Position` rule says a character
    // past the end of a line means the end of that line, so a `character` beyond it describes text
    // that is not there — and clamping only to `textLength` cannot see that: `lineStart + character`
    // lands on a perfectly valid offset somewhere further down the file. A stale host snapshot after
    // a line was shortened produced exactly that, and the span painted on an unrelated line with
    // every drop counter still reading zero.
    const lineEnd = lineStarts[line + 1] ?? textLength
    const start = clampOffset(lineStart + character, textLength)
    const end = clampOffset(lineStart + character + length, textLength)
    // A tuple that clamped away to nothing is not a zero-length tuple — it arrived with a real
    // length and began past the end of the text it addresses. Same failure as `deltaLine`
    // overrunning, one axis over, so it is counted the same way. `end` is deliberately NOT clamped
    // to the line: a span crossing a newline is a thing this decoder produces on purpose, for a
    // client that declared `multilineTokenSupport`.
    if (end <= start || start >= lineEnd) {
      pastEndOfDocument += 1
      continue
    }

    const modifiers = decodeModifiers(modifierBitset, tokenModifiers)
    if (modifiers.unknownBits) unknownModifierBits += 1

    spans.push(
      modifiers.names.length > 0
        ? { end, start, tokenModifiers: modifiers.names, tokenType }
        : { end, start, tokenType },
    )
  }

  if (index < data.length && malformedTuple === 0) malformedTuple += 1

  return {
    drops: {
      malformedTuple,
      outOfLegendType,
      pastEndOfDocument,
      unknownModifierBits,
      zeroLength,
    },
    spans,
  }
}

function decodeModifiers(
  bitset: number,
  tokenModifiers: readonly string[],
): { readonly names: readonly string[]; readonly unknownBits: boolean } {
  if (bitset === 0) return { names: [], unknownBits: false }

  const names: string[] = []
  let unknownBits = false
  for (let bit = 0; bit < MODIFIER_BITS; bit += 1) {
    if ((bitset & (1 << bit)) === 0) continue

    const name = tokenModifiers[bit]
    // Rule 3: a bit the legend does not name is ignored rather than fatal, and the span survives it
    // — losing a modifier costs a shade of colour, where dropping the span costs the colour itself.
    if (name === undefined) unknownBits = true
    else names.push(name)
  }

  return { names, unknownBits }
}

function isUnsignedInteger(value: number): boolean {
  return Number.isInteger(value) && value >= 0
}

function clampOffset(offset: number, textLength: number): number {
  if (offset < 0) return 0
  return offset > textLength ? textLength : offset
}
