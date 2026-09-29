import ts from 'typescript'
import type * as lsp from 'vscode-languageserver-protocol'
import type { DocumentContext } from './context'
import { rangeParam } from './protocol'

/**
 * The legend this worker publishes, and it is awkward on purpose.
 *
 * This worker is a conformance fixture for the semantic-token seam as much as it is the example
 * app's language server, and a fixture that only exercises the easy path proves nothing about the
 * servers the product actually runs. So the three shapes that break decoders are here by
 * construction rather than by accident:
 *
 * - **`function` is the name at two distinct indices.** Legends are not sets, and real ones ship the
 *   same name several times; a decoder that inverts the legend into a name-to-index map mis-decodes
 *   every duplicate. Here TypeScript's `function` and its `member` both answer to `function`, which
 *   is the legend a server that draws no method/function distinction really does publish.
 * - **`typeAlias` is not one of LSP's standard type names**, and the editor's theme has no rule for
 *   it at any prefix, so every span carrying it paints nothing until the host supplies a
 *   `scopeAliases` entry — Contract §C4. A legend whose non-standard names outnumber its standard
 *   ones is the ordinary case for a real server, not the exception.
 * - **`local` is a modifier the editor's precedence ranks below `readonly`**, and TypeScript sets
 *   both on the same token for every reference to a local `const`. Only the higher-ranked one
 *   reaches the scope, so a `const` reference paints as a constant while a `let` reference beside it
 *   paints as a variable.
 *
 * Both arrays are index-aligned with TypeScript's own `classifier.v2020` enums — `TokenType` is
 * class, enum, interface, namespace, typeParameter, type, parameter, variable, enumMember, property,
 * function, member, and `TokenModifier` is declaration, static, async, readonly, defaultLibrary,
 * local. Those are internal `const enum`s the public API does not expose, so the order is written
 * out here; keeping it aligned is what lets the encoder pass TypeScript's index through as the
 * legend index untouched.
 */
export const SEMANTIC_TOKEN_LEGEND: lsp.SemanticTokensLegend = {
  tokenTypes: [
    'class',
    'enum',
    'interface',
    'namespace',
    'typeParameter',
    'typeAlias',
    'parameter',
    'variable',
    'enumMember',
    'property',
    'function',
    'function',
  ],
  tokenModifiers: ['declaration', 'static', 'async', 'readonly', 'defaultLibrary', 'local'],
}

/** `encoded = ((typeIndex + 1) << 8) | modifierSet`, TypeScript's own packing. */
const SEMANTIC_TOKEN_TYPE_OFFSET = 8
const SEMANTIC_TOKEN_MODIFIER_MASK = 255
/** `getEncodedSemanticClassifications` answers `(start, length, encoded)` triples. */
const SEMANTIC_CLASSIFICATION_STRIDE = 3

/**
 * Whole-document tokens, and Milestone 2's measurements say when a host should ask for them.
 *
 * On a warm service a 100-line span classifies in 0.380 ms against 22.514 ms for the whole of a
 * 5,027-line file, and this worker has one message loop with no queue — so those 22 ms are time no
 * completion (0.212 ms) and no hover (0.114 ms) can use. Classification is linear in the span asked
 * for and carries no fixed cost worth naming, which is what makes the split worth making.
 *
 * Both requests are answered rather than one: `full` is what a host has to ask on open, when there
 * is no viewport yet and the answer is bounded by the document. **The demand signal of §C8 should be
 * answered with `range`**, and the fixture is built around that being the hot path.
 */
export function semanticTokensFull(ctx: DocumentContext): lsp.SemanticTokens {
  return { data: encodeSemanticTokens(ctx, { start: 0, length: ctx.document.text.length }) }
}

/** See `semanticTokensFull` for which of the two a host should be asking. */
export function semanticTokensRange(
  ctx: DocumentContext,
  params: unknown,
): lsp.SemanticTokens | null {
  const range = rangeParam(params)
  if (!range) return null

  const start = ctx.lines.offset(range.start)
  const end = ctx.lines.offset(range.end)
  return { data: encodeSemanticTokens(ctx, { start, length: Math.max(end - start, 0) }) }
}

/**
 * TypeScript's absolute triples, re-encoded as LSP's relative 5-tuples.
 *
 * `getEncodedSemanticClassifications` answers `(start, length, encoded)` in document offsets, where
 * `encoded = ((typeIndex + 1) << 8) | modifierSet`. The `+ 1` is how TypeScript spells "no
 * classification", so a triple that decodes to -1 is dropped rather than encoded as type zero.
 *
 * **The first tuple's `deltaLine` is measured from line zero even when the caller asked for a range
 * halfway down the file.** LSP's cursor starts at the top of the document, not at the top of the
 * request; encoding it relative to the range start is invisible until a host scrolls, at which point
 * every span in the answer paints a screenful too high.
 *
 * Nothing here crosses a newline: TypeScript classifies identifiers, and a client that has not
 * declared `multilineTokenSupport` must not be sent one (Contract §C1).
 */
function encodeSemanticTokens(ctx: DocumentContext, span: ts.TextSpan): number[] {
  const classifications = ctx.env.languageService.getEncodedSemanticClassifications(
    ctx.document.fileName,
    span,
    ts.SemanticClassificationFormat.TwentyTwenty,
  )
  const spans = classifications.spans
  const data: number[] = []
  let previousLine = 0
  let previousCharacter = 0

  for (
    let index = 0;
    index + SEMANTIC_CLASSIFICATION_STRIDE <= spans.length;
    index += SEMANTIC_CLASSIFICATION_STRIDE
  ) {
    const start = spans[index] as number
    const length = spans[index + 1] as number
    const encoded = spans[index + 2] as number
    const tokenType = (encoded >> SEMANTIC_TOKEN_TYPE_OFFSET) - 1
    if (tokenType < 0 || tokenType >= SEMANTIC_TOKEN_LEGEND.tokenTypes.length) continue

    const line = ctx.lines.lineAt(start)
    const character = start - ctx.lines.lineStart(line)
    data.push(
      line - previousLine,
      line === previousLine ? character - previousCharacter : character,
      length,
      tokenType,
      encoded & SEMANTIC_TOKEN_MODIFIER_MASK,
    )
    previousLine = line
    previousCharacter = character
  }

  return data
}
