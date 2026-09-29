import { normalizeTabSize, visualColumnLength } from '../displayTransforms'
import { createStringTextSnapshot, type TextReadSnapshot } from '../documentTextSnapshot'
import type { ResolvedSelection } from '../selections'
import type { TextOffsetRange } from '../textRanges'
import type { TextEdit } from '../tokens'
import type { EditorCommandId } from './commands'
import type { EditorEditActionOptions, EditorEditActionResult } from './editActions'
import { leadingWhitespace } from './indentation'
import {
  editorLanguageConfiguration,
  matches,
  type EditorIndentationRules,
  type EditorLanguageConfiguration,
} from './languageConfiguration'
import { TextCursor } from './textCursor'

/**
 * Rewriting the indentation of whole rows from the language's indentation rules.
 *
 * Indenting answers "one level in from wherever this row is"; these commands answer "where does this
 * row belong", which only the rules can say. That is the gesture that cleans up after a paste, and
 * the two differ on every row that was already wrong.
 *
 * A row's level is read off the row above it, so a delimiter that is really the content of a string
 * or a comment does not move one row, it moves every row under it. The rules are patterns over a
 * line's text and nothing in them can tell content from code, so the text they are matched against
 * has every literal blanked out first. The parse cannot be what draws that line: its captures are
 * retained only while something else asks for them and they land a frame behind the edit, and a
 * command that rewrites a file must not be correct only when a highlighter happens to be installed.
 */

export type EditorDocumentSelectionEditCommandId =
  | 'editor.action.reindentlines'
  | 'editor.action.reindentselectedlines'

type RowRange = {
  readonly startRow: number
  readonly endRow: number
}

/**
 * All a row range is decided from, which is less than a selection carries.
 *
 * Stated as its own shape so a caller holding nothing but offsets — a feature correcting one row
 * while it is typed — can ask the same question without inventing a selection to ask it with.
 */
type ReindentRange = Pick<ResolvedSelection, 'startOffset' | 'endOffset' | 'collapsed'>

/** Strings and comments in document order, as parallel offsets; each ends where the next may start. */
type LiteralRanges = {
  readonly starts: readonly number[]
  readonly ends: readonly number[]
}

/** The document read a row at a time, and the literals the indentation rules must not see. */
type ReindentSource = {
  readonly text: TextReadSnapshot
  /** Every literal that starts before the end of the last row the command reads. */
  readonly literals: LiteralRanges
  readonly rows: RowReader
}

export function isEditorDocumentSelectionEditCommand(
  command: EditorCommandId,
): command is EditorDocumentSelectionEditCommandId {
  return (
    command === 'editor.action.reindentlines' || command === 'editor.action.reindentselectedlines'
  )
}

export function documentSelectionEditForCommand(
  command: EditorDocumentSelectionEditCommandId,
  text: TextReadSnapshot,
  selections: readonly ReindentRange[],
  options: EditorEditActionOptions = {},
): EditorEditActionResult {
  const wholeDocument = command === 'editor.action.reindentlines'
  const timingName = wholeDocument ? 'editor.reindentLines' : 'editor.reindentSelectedLines'
  const configuration = editorLanguageConfiguration(options.languageId)
  const rules = configuration?.indentationRules
  // A language that never described how its lines nest has no answer here, and a guessed one would
  // move rows for a reason the user has no way to inspect.
  if (!rules) return { edits: [], timingName }

  const ranges = wholeDocument
    ? [{ endRow: text.lineCount - 1, startRow: 0 }]
    : rowRangesForSelections(text, selections)
  // Ranges come merged and in order, so the last one reaches furthest.
  const lastRange = ranges.at(-1)
  if (!lastRange) return { edits: [], timingName }

  // Whether a row starts inside a literal depends on every row above it, so the scan starts at 0.
  const limit = text.lineRange(lastRange.endRow).end
  const cursor = new TextCursor(text)
  const source: ReindentSource = {
    text,
    literals: scanLiterals(cursor, configuration, limit),
    rows: new RowReader(text, cursor),
  }

  return {
    edits: ranges.flatMap((range) => reindentEdits(source, rules, range, options)),
    timingName,
  }
}

/**
 * What deciding a row's level takes beyond the document text.
 *
 * Narrower than what the commands are handed, so a caller reaching this by offset is not offered the
 * fields that only a selection-shaped edit has anything to do with.
 */
export type EditorReindentOptions = {
  readonly languageId?: string | null
  /** Levels are counted in columns, so a tab's width decides which of them a row lands on. */
  readonly tabSize?: number
}

/**
 * The same answer the reindent commands give, for callers that address the document by offset.
 *
 * A feature that corrects one row as it is being typed is asking exactly what a reindent of that
 * row asks, and a second implementation of it would be a second set of indentation rules to keep in
 * step with the language records — the failure this module was consolidated to end.
 */
export function reindentEditsForRanges(
  text: string,
  ranges: readonly TextOffsetRange[],
  options: EditorReindentOptions = {},
): readonly TextEdit[] {
  return documentSelectionEditForCommand(
    'editor.action.reindentselectedlines',
    createStringTextSnapshot(text),
    ranges.map((range) => ({
      collapsed: range.start === range.end,
      endOffset: range.end,
      startOffset: range.start,
    })),
    options,
  ).edits
}

/**
 * Every string and comment starting before `limit`, delimiters included.
 *
 * A quoted run may cross line breaks, because a template literal is written that way and the braces
 * inside one must not drive the indentation of the rows it spans — reindent would otherwise rewrite
 * the string's own contents. A run that never closes falls back to ending at its line break: an
 * unbalanced delimiter is more often an apostrophe than the start of a literal, and one of those
 * must not swallow the rest of the file.
 */
function scanLiterals(
  cursor: TextCursor,
  configuration: EditorLanguageConfiguration | null,
  limit: number,
): LiteralRanges {
  const tokens: LiteralTokens = {
    quotes: new Set(
      (configuration?.autoClosingPairs ?? [])
        .filter((pair) => pair.quote === true && pair.open.length === 1)
        .map((pair) => pair.open.charCodeAt(0)),
    ),
    lineComment: configuration?.comments?.line,
    blockComment: configuration?.comments?.block,
  }
  const starts: number[] = []
  const ends: number[] = []
  const opener = literalOpener(tokens)
  if (!opener) return { starts, ends }

  // Only a unit that can open a literal stops the scan; every other one is stepped over.
  for (let index = cursor.search(opener, 0, limit); index !== -1;) {
    const end = literalEndAt(cursor, index, tokens)
    if (end !== null) {
      starts.push(index)
      ends.push(end)
    }
    index = cursor.search(opener, end ?? index + 1, limit)
  }

  return { starts, ends }
}

/** Matches the first unit of every token that opens a literal. */
function literalOpener(tokens: LiteralTokens): RegExp | null {
  const units = new Set(tokens.quotes)
  if (tokens.lineComment) units.add(tokens.lineComment.charCodeAt(0))
  if (tokens.blockComment?.open) units.add(tokens.blockComment.open.charCodeAt(0))
  if (units.size === 0) return null

  const escaped = [...units].map((unit) => `\\u${unit.toString(16).padStart(4, '0')}`)
  return new RegExp(`[${escaped.join('')}]`, 'g')
}

type LiteralTokens = {
  readonly quotes: ReadonlySet<number>
  readonly lineComment: string | undefined
  readonly blockComment: { readonly open: string; readonly close: string } | undefined
}

/** Where the literal opening at `index` ends, or null when none opens there. */
function literalEndAt(cursor: TextCursor, index: number, tokens: LiteralTokens): number | null {
  const code = cursor.codeAt(index)
  if (code === LINE_FEED) return null

  const { blockComment, lineComment } = tokens
  if (blockComment && cursor.startsWith(blockComment.open, index)) {
    return offsetPast(cursor, index + blockComment.open.length, blockComment.close)
  }
  if (lineComment && cursor.startsWith(lineComment, index)) return lineBreakFrom(cursor, index)
  if (tokens.quotes.has(code)) return offsetPastQuoted(cursor, index, code)
  return null
}

/** Just past `token`, or the end of the text for a literal nothing closes. */
function offsetPast(cursor: TextCursor, from: number, token: string): number {
  const found = cursor.indexOf(token, from)

  return found === -1 ? cursor.length : found + token.length
}

function lineBreakFrom(cursor: TextCursor, from: number): number {
  const found = cursor.indexOf('\n', from)

  return found === -1 ? cursor.length : found
}

function offsetPastQuoted(cursor: TextCursor, from: number, quote: number): number {
  for (let index = from + 1; index < cursor.length; index += 1) {
    const code = cursor.codeAt(index)
    // An escaped delimiter is content, and so is whatever the escape was hiding.
    if (code === BACKSLASH) index += 1
    else if (code === quote) return index + 1
  }

  return lineBreakFrom(cursor, from)
}

const LINE_FEED = 0x0a
const BACKSLASH = 0x5c

/**
 * The row ranges the selections ask to have made consistent.
 *
 * Each range reaches one row further up than the selection does, because the first selected row's own
 * level is only decided by the row above it — without that row the range would be measured from a
 * row the user is asking to have corrected. A caret on the first row of the document has nothing
 * above it and nothing selected below it, so it asks for nothing.
 */
function rowRangesForSelections(
  text: TextReadSnapshot,
  selections: readonly ReindentRange[],
): readonly RowRange[] {
  const ranges = selections
    .map((selection) => rowRangeForSelection(text, selection))
    .filter((range): range is RowRange => range !== null)
  const merged: RowRange[] = []

  for (const range of ranges.toSorted((left, right) => left.startRow - right.startRow)) {
    const previous = merged[merged.length - 1]
    if (!previous || range.startRow > previous.endRow + 1) {
      merged.push(range)
      continue
    }

    merged[merged.length - 1] = {
      endRow: Math.max(previous.endRow, range.endRow),
      startRow: previous.startRow,
    }
  }

  return merged
}

function rowRangeForSelection(text: TextReadSnapshot, selection: ReindentRange): RowRange | null {
  const startRow = text.lineAt(selection.startOffset)
  const endRow = endRowForSelection(text, selection, startRow)
  if (startRow === 0) return endRow === 0 ? null : { endRow, startRow: 0 }

  return { endRow, startRow: startRow - 1 }
}

function endRowForSelection(
  text: TextReadSnapshot,
  selection: ReindentRange,
  startRow: number,
): number {
  if (selection.collapsed) return startRow

  const endRow = text.lineAt(selection.endOffset)
  // A selection stopping at a row start has not reached into that row.
  if (endRow > startRow && selection.endOffset === text.lineStart(endRow)) return endRow - 1

  return endRow
}

/**
 * One replace edit per row whose leading whitespace is not what the rules ask for.
 *
 * The nearest ruled row at or above the range is the level the rest is measured from: the range is
 * being made self-consistent, not moved somewhere else, so a block that is uniformly too deep stays
 * where the user put it.
 */
function reindentEdits(
  source: ReindentSource,
  rules: EditorIndentationRules,
  range: RowRange,
  options: EditorEditActionOptions,
): readonly TextEdit[] {
  const baseRow = referenceRow(source, rules, range)
  if (baseRow === null || baseRow >= range.endRow) return []

  const tabSize = normalizeTabSize(options.tabSize)
  const unit = indentTextForRange(source, range, tabSize)
  const step = Math.max(1, visualColumnLength(unit, tabSize))
  const edits: TextEdit[] = []
  let column = visualColumnLength(indentationOfRow(source, baseRow), tabSize)
  if (matches(rules.increaseIndentPattern, maskedRowText(source, baseRow))) column += step

  for (let row = baseRow + 1; row <= range.endRow; row += 1) {
    if (skipsRules(source, rules, row)) continue

    const masked = maskedRowText(source, row)
    if (matches(rules.decreaseIndentPattern, masked)) column = Math.max(0, column - step)

    const indentation = indentationOfRow(source, row)
    const wanted = indentationForColumn(column, unit, tabSize)
    if (wanted !== indentation) {
      const start = rowStart(source, row)
      edits.push({ from: start, text: wanted, to: start + indentation.length })
    }

    if (matches(rules.increaseIndentPattern, masked)) column += step
  }

  return edits
}

/**
 * The row the rest of the range is measured from.
 *
 * The search goes up, not down. A range already reaches one row past the selection to find this row,
 * and a row the rules skip is not one to measure from — a blank row separating a statement from the
 * closer being typed under it is the ordinary case. Walking down into the range instead would take
 * the reference off a row the user asked to have corrected, which is how a caret under a blank row
 * comes back with nothing to do at all. Rows passed on the way up are ones the loop below skips
 * anyway, so nothing outside the range can move.
 *
 * Only a range with nothing ruled above it falls back to looking inside itself, because a document
 * that opens with blank rows has no other level to offer.
 */
function referenceRow(
  source: ReindentSource,
  rules: EditorIndentationRules,
  range: RowRange,
): number | null {
  for (let row = range.startRow; row >= 0; row -= 1) {
    if (!skipsRules(source, rules, row)) return row
  }

  for (let row = range.startRow + 1; row <= range.endRow; row += 1) {
    if (!skipsRules(source, rules, row)) return row
  }

  return null
}

/**
 * Whether a row is one the rules have nothing to say about, and which therefore neither moves nor
 * changes the level the rows under it get.
 *
 * A blank row has no indentation to correct — writing one would leave trailing whitespace behind —
 * and a row that begins inside a literal has indentation that is part of the text's value. The
 * language's own exemption is matched against the row as written, since it names shapes such as a
 * comment's continuation leader that the mask has already blanked out.
 */
function skipsRules(source: ReindentSource, rules: EditorIndentationRules, row: number): boolean {
  if (startsInsideLiteral(source, row)) return true

  const text = rowText(source, row)
  if (text.trim().length === 0) return true

  return rules.unIndentedLinePattern !== undefined && matches(rules.unIndentedLinePattern, text)
}

/**
 * One level, in the currency the range already spends.
 *
 * The width is the editor's, which the document itself has already had a say in; the choice between
 * tabs and spaces stays with the text, so a tabbed file stays tabbed without anyone configuring it.
 *
 * Which of the two the text spends is settled by however many of its rows spend each, because a
 * command that tidies a range is not being asked to convert it: a single row pasted in from a file
 * written the other way would otherwise rewrite every other row's indentation characters.
 */
function indentTextForRange(source: ReindentSource, range: RowRange, tabSize: number): string {
  let tabbed = 0
  let spaced = 0

  for (let row = range.startRow; row <= range.endRow; row += 1) {
    const indentation = indentationOfRow(source, row)
    if (indentation.includes('\t')) tabbed += 1
    else if (indentation.length > 0) spaced += 1
  }

  return tabbed > spaced ? '\t' : ' '.repeat(tabSize)
}

/** A column back into text. Levels are counted in columns so a mixed file collapses onto one unit. */
function indentationForColumn(column: number, unit: string, tabSize: number): string {
  if (!unit.includes('\t')) return ' '.repeat(column)

  return '\t'.repeat(Math.floor(column / tabSize)) + ' '.repeat(column % tabSize)
}

function rowStart(source: ReindentSource, row: number): number {
  return source.rows.read(row).start
}

function rowText(source: ReindentSource, row: number): string {
  return source.rows.read(row).text
}

type Row = {
  readonly start: number
  readonly text: string
}

/**
 * Rows by index. The commands walk down a range and ask each row several questions, so the last row
 * is kept and the next one is found from its end.
 */
class RowReader {
  #index = -1
  #row: Row = { start: 0, text: '' }

  constructor(
    private readonly text: TextReadSnapshot,
    private readonly cursor: TextCursor,
  ) {}

  read(index: number): Row {
    if (index === this.#index) return this.#row

    const start = this.startOf(index)
    const end = lineBreakFrom(this.cursor, start)
    this.#index = index
    this.#row = { start, text: this.cursor.slice(start, end) }
    return this.#row
  }

  private startOf(index: number): number {
    if (index > 0 && index === this.#index + 1) {
      return this.#row.start + this.#row.text.length + 1
    }
    return this.text.lineStart(index)
  }
}

/**
 * The row with every literal blanked, delimiters included: a line comment's own marker is what a
 * rule written to skip commented delimiters looks for, and blanking it leaves nothing to skip.
 */
function maskedRowText(source: ReindentSource, row: number): string {
  const text = rowText(source, row)
  const start = rowStart(source, row)
  const end = start + text.length
  const { starts, ends } = source.literals
  let masked = ''
  let cursor = 0

  for (
    let index = firstLiteralEndingAfter(source.literals, start);
    index < starts.length;
    index++
  ) {
    const literalStart = Math.max(start, starts[index]!)
    if (literalStart >= end) break

    const literalEnd = Math.min(end, ends[index]!)
    masked += text.slice(cursor, literalStart - start) + ' '.repeat(literalEnd - literalStart)
    cursor = literalEnd - start
  }

  return masked + text.slice(cursor)
}

/** Whether the break before `row` sits inside a literal, which makes the row's indentation content. */
function startsInsideLiteral(source: ReindentSource, row: number): boolean {
  if (row === 0) return false

  const start = rowStart(source, row)
  const index = firstLiteralEndingAfter(source.literals, start - 1)
  const literalStart = source.literals.starts[index]
  return literalStart !== undefined && literalStart < start
}

/** The first literal whose end lies past `offset`. */
function firstLiteralEndingAfter(literals: LiteralRanges, offset: number): number {
  let low = 0
  let high = literals.ends.length

  while (low < high) {
    const middle = (low + high) >>> 1
    if (literals.ends[middle]! <= offset) low = middle + 1
    else high = middle
  }

  return low
}

function indentationOfRow(source: ReindentSource, row: number): string {
  return leadingWhitespace(rowText(source, row))
}
