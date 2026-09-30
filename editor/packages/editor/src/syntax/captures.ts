import type { EditorToken, EditorTokenStyle } from '../tokens'
import {
  createEditorScopeStyles,
  editorColorReference,
  editorColorValue,
  registerEditorColor,
  type EditorScopeStyleRule,
} from '../theme'
import type { EditorSyntaxCapture } from './session'

// Capture styling reads the registered colour ids rather than variable names of its own, so a theme
// that sets a syntax colour by id and a capture that paints with it cannot drift apart.
const SYNTAX_COLOR = {
  attribute: editorColorValue('syntax.attribute'),
  bracket: editorColorValue('syntax.bracket'),
  comment: editorColorValue('syntax.comment'),
  constant: editorColorValue('syntax.constant'),
  constructor: editorColorValue('syntax.typeDefinition'),
  function: editorColorValue('syntax.function'),
  keyword: editorColorValue('syntax.keyword'),
  keywordDeclaration: editorColorValue('syntax.keywordDeclaration'),
  keywordImport: editorColorValue('syntax.keywordImport'),
  namespace: editorColorValue('syntax.namespace'),
  number: editorColorValue('syntax.number'),
  property: editorColorValue('syntax.property'),
  string: editorColorValue('syntax.string'),
  tag: editorColorValue('syntax.keyword'),
  // Emphasis and strong are the two scopes a theme normally leaves uncoloured, because an editor
  // renders them with a slant and a weight instead — and a highlight pseudo-element cannot apply
  // either (see style-utils). Uncoloured, they painted nothing at all. These ids default to a hue
  // no other markdown scope already claims, and a theme that wants its own says so by id.
  textEmphasis: registerEditorColor('syntax.textEmphasis', editorColorReference('syntax.type')),
  textStrong: registerEditorColor('syntax.textStrong', editorColorReference('syntax.constant')),
  type: editorColorValue('syntax.type'),
  typeDefinition: editorColorValue('syntax.typeDefinition'),
  typeParameter: editorColorValue('syntax.typeParameter'),
  variable: editorColorValue('syntax.variable'),
  variableBuiltin: editorColorValue('syntax.variableBuiltin'),
} as const

const CAPTURE_STYLE_RULES: readonly EditorScopeStyleRule[] = [
  { scope: 'attribute', style: { color: SYNTAX_COLOR.attribute } },
  { scope: 'comment', style: { color: SYNTAX_COLOR.comment, fontStyle: 'italic' } },
  { scope: 'constant', style: { color: SYNTAX_COLOR.constant } },
  { scope: 'constant.builtin', style: { color: SYNTAX_COLOR.constant } },
  { scope: 'constructor', style: { color: SYNTAX_COLOR.constructor } },
  { scope: 'function', style: { color: SYNTAX_COLOR.function } },
  { scope: 'function.method', style: { color: SYNTAX_COLOR.function } },
  { scope: 'keyword', style: { color: SYNTAX_COLOR.keyword } },
  { scope: 'keyword.control', style: { color: SYNTAX_COLOR.keyword } },
  { scope: 'keyword.declaration', style: { color: SYNTAX_COLOR.keywordDeclaration } },
  { scope: 'keyword.import', style: { color: SYNTAX_COLOR.keywordImport } },
  { scope: 'keyword.type', style: { color: SYNTAX_COLOR.typeParameter } },
  { scope: 'namespace', style: { color: SYNTAX_COLOR.namespace } },
  { scope: 'number', style: { color: SYNTAX_COLOR.number } },
  { scope: 'operator', style: { color: SYNTAX_COLOR.bracket } },
  { scope: 'property', style: { color: SYNTAX_COLOR.property } },
  { scope: 'punctuation', style: { color: SYNTAX_COLOR.bracket } },
  { scope: 'punctuation.bracket', style: { color: SYNTAX_COLOR.bracket } },
  { scope: 'string', style: { color: SYNTAX_COLOR.string } },
  { scope: 'tag', style: { color: SYNTAX_COLOR.tag } },
  { scope: 'text.emphasis', style: { color: SYNTAX_COLOR.textEmphasis, fontStyle: 'italic' } },
  { scope: 'text.literal', style: { color: SYNTAX_COLOR.string } },
  { scope: 'text.reference', style: { color: SYNTAX_COLOR.property } },
  { scope: 'text.strong', style: { color: SYNTAX_COLOR.textStrong, fontWeight: 700 } },
  { scope: 'text.title', style: { color: SYNTAX_COLOR.keywordDeclaration, fontWeight: 700 } },
  { scope: 'text.uri', style: { color: SYNTAX_COLOR.string, textDecoration: 'underline' } },
  { scope: 'type', style: { color: SYNTAX_COLOR.type } },
  { scope: 'type.builtin', style: { color: SYNTAX_COLOR.type } },
  { scope: 'type.definition', style: { color: SYNTAX_COLOR.typeDefinition } },
  { scope: 'type.parameter', style: { color: SYNTAX_COLOR.typeParameter } },
  { scope: 'variable', style: { color: SYNTAX_COLOR.variable } },
  { scope: 'variable.builtin', style: { color: SYNTAX_COLOR.variableBuiltin } },
  { scope: 'variable.parameter', style: { color: SYNTAX_COLOR.keywordImport } },
]

const CAPTURE_SCOPE_STYLES = createEditorScopeStyles(CAPTURE_STYLE_RULES)

/**
 * Which capture wins when two of them cover exactly the same span, most specific first.
 *
 * Exact-span overlaps are ordinary rather than exotic: in a `.ts` file `const MAX = 10` produces
 * @variable, @constant, @constructor and @type over the same three characters, from four separate
 * rules across two shipped query files. Each resolves to a different style, each style gets its own
 * `Highlight`, all of them sit at the same priority, and equal-priority highlights paint in
 * registry insertion order — which is "the first time this session's shared registry saw that style
 * key". Without a rule between them the colour of an identifier was a function of which document
 * the session happened to open first.
 *
 * The principle is how much of the span's meaning the capture pins down. A `*.builtin` names one
 * specific known thing. A declaration role — `type.definition`, `constant`, `function.method` —
 * says what the identifier is for. A lexical kind — `type`, `string`, `number` — says only what
 * shape it has. `variable` is the fallback every identifier gets, so anything else matching the
 * same span knows strictly more than it does.
 *
 * `constant` sits above `constructor` and `type` because all three are heuristics over a
 * capitalised identifier and `constant`'s is the strictest of them: `^[A-Z_][A-Z\d_]+$` where the
 * other two ask only for `^[A-Z]`.
 *
 * The table resolves **every** overlap, not only exact-span duplicates. Exact spans were never a
 * separate phenomenon: `text.title` containing `text.strong`, and `string` containing
 * `punctuation.special`, land on the same registry-order lottery for the characters they share, so
 * a rule that covered one shape and not the other left the defect in place wherever a grammar
 * happened to nest. Resolution is per character rather than per capture — see
 * `resolveOverlappingCaptures` — so a capture that loses only its middle survives on both sides.
 */
const CAPTURE_SPECIFICITY: readonly string[] = [
  // Named a specific known thing.
  'variable.builtin',
  'constant.builtin',
  'type.builtin',
  'function.builtin',
  'string.escape',
  'string.special',
  'punctuation.special',
  // Named a role in a declaration.
  'type.definition',
  'type.parameter',
  'keyword.type',
  'keyword.declaration',
  'keyword.import',
  'keyword.control',
  'constant',
  'function.method',
  'function',
  'namespace',
  'attribute',
  'property',
  'variable.parameter',
  // Named a lexical kind.
  'type',
  // Below `type` deliberately, though it reads like a declaration role. The only shipped rule that
  // produces it is javascript-highlights.scm's `((identifier) @constructor (#match? "^[A-Z]"))` —
  // the identical capitalisation heuristic `((identifier) @type ...)` applies one file over, so
  // neither knows more than the other about the span. Ranked above `type` it won every bare
  // capitalised identifier and painted it `syntax.typeDefinition`, while the same name in a
  // `type_identifier` position — which only `@type` claims — kept `syntax.type`: one class name,
  // two different blues in one file.
  'constructor',
  'tag',
  'text.title',
  'text.strong',
  'text.emphasis',
  'text.uri',
  'text.literal',
  'text.reference',
  'comment',
  'string',
  'number',
  'keyword',
  'punctuation.bracket',
  'punctuation.delimiter',
  'punctuation',
  'operator',
  // The fallback every identifier gets.
  'variable',
]

const CAPTURE_RANKS = new Map(CAPTURE_SPECIFICITY.map((name, index) => [name, index]))
// A name the table does not list ranks below every name it does, and ties are settled by arrival
// order — deterministic for a given tree, and never a function of anything outside this call.
const UNRANKED_CAPTURE_RANK = CAPTURE_SPECIFICITY.length

/**
 * The rank of a capture name, read the same way its style is: longest prefix first.
 *
 * Styles resolve through a trie, so `keyword.declaration.function` picks up `keyword.declaration`
 * and a grammar is free to name captures as deep as it likes — the shipped queries stop at two
 * segments, but a grammar contributed through `registerLanguage` need not. Ranking by exact lookup
 * would drop every such name to the bottom of the table, below `variable`, and hand the span to the
 * one capture the table calls the fallback. The specific name would lose to the generic one, which
 * is the opposite of the rule this table exists to enforce.
 */
const captureRank = (captureName: string): number => {
  for (let end = captureName.length; end > 0; end = captureName.lastIndexOf('.', end - 1)) {
    const rank = CAPTURE_RANKS.get(captureName.slice(0, end))
    if (rank !== undefined) return rank
  }

  return UNRANKED_CAPTURE_RANK
}

export const styleForTreeSitterCapture = (captureName: string): EditorTokenStyle | null => {
  const style = sharedStyleForTreeSitterCapture(captureName)
  return style ? { ...style } : null
}

const sharedStyleForTreeSitterCapture = (captureName: string): EditorTokenStyle | null =>
  CAPTURE_SCOPE_STYLES.resolve(captureName)

export const treeSitterCapturesToEditorTokens = (
  captures: readonly EditorSyntaxCapture[],
): EditorToken[] => resolveOverlappingCaptures(captures)

/** A capture that would paint something, with the two numbers that decide whether it gets to. */
type CaptureCandidate = {
  readonly start: number
  readonly end: number
  readonly rank: number
  readonly style: EditorTokenStyle
}

/**
 * One style per character, chosen by specificity rather than by registry order.
 *
 * Overlapping captures are ordinary: `const MAX = 10` is claimed by four rules over the same three
 * characters, a template literal's `${` is claimed by `string` and by `punctuation.special`, and a
 * bold word inside a markdown heading is claimed by `text.title` and by `text.strong`. Every one of
 * those pairs declares a `color`, each distinct style gets its own `Highlight` at the same
 * priority, and equal-priority highlights paint in registry insertion order — which is "the first
 * time this session's shared registry saw that style key". Left alone, the colour of those
 * characters is a function of which document the session opened first.
 *
 * So the question is answered per character instead of per capture. Sweeping the boundaries in
 * offset order gives every elementary interval one covering capture that outranks the rest, and
 * neighbouring intervals that resolved to the same style are re-joined into one token. A capture
 * that loses only its middle — the `string` around a `${` — comes back as two tokens, one either
 * side of the hole, rather than being dropped whole or left to contend for the characters it kept.
 *
 * The output is non-overlapping and ascending by construction, which is strictly better input for
 * the token index than the overlapping list this used to emit.
 */
const resolveOverlappingCaptures = (captures: readonly EditorSyntaxCapture[]): EditorToken[] => {
  const candidates = captureCandidates(captures)
  if (candidates.length === 0) return []

  const boundaries = captureBoundaries(candidates)
  // Checked rather than assumed, and rather than sorted: the worker hands these over already sorted
  // by start, so the ordinary path pays one linear scan instead of an N log N sort. This is a public
  // entry point, so the unsorted case still has to work.
  const byStart = isSortedByStart(candidates)
    ? candidates
    : candidates.toSorted((left, right) => left.start - right.start)
  const tokens: EditorToken[] = []
  const active: CaptureCandidate[] = []
  let admitted = 0

  for (let index = 0; index + 1 < boundaries.length; index += 1) {
    const start = boundaries[index] as number
    admitted = admitCandidates(byStart, admitted, start, active)
    evictClosedCandidates(active, start)

    const winner = bestCandidate(active)
    if (!winner) continue

    appendCaptureToken(tokens, start, boundaries[index + 1] as number, winner.style)
  }

  return tokens
}

/**
 * The captures that could paint at all.
 *
 * A capture whose name resolves to no style paints nothing today, so it is not a candidate: letting
 * one win a span would swallow a sibling that does resolve — turning an ordering defect into a
 * missing colour.
 */
const captureCandidates = (captures: readonly EditorSyntaxCapture[]): CaptureCandidate[] => {
  const candidates: CaptureCandidate[] = []
  for (const capture of captures) {
    if (!capture) continue
    if (capture.endIndex <= capture.startIndex) continue

    const style = sharedStyleForTreeSitterCapture(capture.captureName)
    if (!style) continue

    candidates.push({
      end: capture.endIndex,
      rank: captureRank(capture.captureName),
      start: capture.startIndex,
      style,
    })
  }

  return candidates
}

const isSortedByStart = (candidates: readonly CaptureCandidate[]): boolean => {
  for (let index = 1; index < candidates.length; index += 1) {
    if (
      (candidates[index] as CaptureCandidate).start <
      (candidates[index - 1] as CaptureCandidate).start
    ) {
      return false
    }
  }

  return true
}

/**
 * Every offset at which the answer can change, ascending and deduplicated.
 *
 * `Int32Array` rather than `number[]`: its `sort()` is numeric by definition, so it needs no
 * comparator callback — which is the whole cost of sorting 2N boundaries on a large file. Document
 * offsets are non-negative and nowhere near 2³¹.
 */
const captureBoundaries = (candidates: readonly CaptureCandidate[]): Int32Array => {
  const offsets = new Int32Array(candidates.length * 2)
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index] as CaptureCandidate
    offsets[index * 2] = candidate.start
    offsets[index * 2 + 1] = candidate.end
  }

  offsets.sort()

  const boundaries = new Int32Array(offsets.length)
  let kept = 0
  for (const offset of offsets) {
    if (kept > 0 && boundaries[kept - 1] === offset) continue

    boundaries[kept] = offset
    kept += 1
  }

  return boundaries.subarray(0, kept)
}

/** Opens every candidate that has started by `offset`. Returns the new cursor into `byStart`. */
const admitCandidates = (
  byStart: readonly CaptureCandidate[],
  cursor: number,
  offset: number,
  active: CaptureCandidate[],
): number => {
  let next = cursor
  while (next < byStart.length && (byStart[next] as CaptureCandidate).start <= offset) {
    active.push(byStart[next] as CaptureCandidate)
    next += 1
  }

  return next
}

/** Drops every candidate whose span ended at or before `offset`, in place. */
const evictClosedCandidates = (active: CaptureCandidate[], offset: number): void => {
  let kept = 0
  for (const candidate of active) {
    if (candidate.end <= offset) continue

    active[kept] = candidate
    kept += 1
  }

  active.length = kept
}

/**
 * The most specific candidate covering the current interval.
 *
 * Ties go to the earliest arrival — `>=` rather than `>` — so two equally ranked names resolve the
 * same way for a given tree however the shared registry has been used, which is the whole point.
 */
const bestCandidate = (active: readonly CaptureCandidate[]): CaptureCandidate | null => {
  let best: CaptureCandidate | null = null
  for (const candidate of active) {
    if (best && candidate.rank >= best.rank) continue
    best = candidate
  }

  return best
}

/**
 * Extends the previous token rather than starting one, when the style is the same object.
 *
 * `EditorScopeStyles.resolve` memoises per scope, so two capture names that inherit one rule share
 * a style by reference — and a capture split around a more specific child is that one style on
 * either side of the hole. Both cases want one token per contiguous run, not one per interval.
 */
const appendCaptureToken = (
  tokens: EditorToken[],
  start: number,
  end: number,
  style: EditorTokenStyle,
): void => {
  const previous = tokens[tokens.length - 1]
  if (previous && previous.end === start && previous.style === style) {
    previous.end = end
    return
  }

  tokens.push({ end, start, style })
}
