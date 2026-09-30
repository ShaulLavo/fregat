/**
 * LSP snippet syntax, parsed into text plus the stops a caret visits.
 *
 * Supports `$1`, `${1}`, `${1:default}` including nested ones, `${1|a,b|}`, `$0`, variables,
 * `${1/regex/format/flags}` transforms, and `\$` escapes. Anything that does not parse is left as
 * the literal text it was written as, because a server that speaks a dialect we do not should still
 * put its characters in the document rather than lose them.
 */

import type { TextReadSnapshot } from '../documentTextSnapshot'
import { readLeadingWhitespace } from '../textWindows'
import { leadingWhitespace } from './indentation'
import { guessedTabSize } from './indentationGuess'

export type SnippetRange = {
  readonly start: number
  readonly end: number
  /**
   * Renders the stop's text rather than holding text typed into it: a mirror, not a place to put
   * the caret. The function itself rather than a flag, because the copy has to be rendered again
   * every time the text it copies changes, and only the parser knows how.
   */
  readonly transform?: (value: string) => string
}

type SnippetStop = {
  /** Tab-stop number. `0` is the exit stop and always sorts last. */
  readonly index: number
  /** Where this stop's text sits in the expanded string; several for a repeated stop. */
  readonly ranges: readonly SnippetRange[]
}

export type ParsedSnippet = {
  /** The text to insert, with placeholders replaced by their defaults. */
  readonly text: string
  /** Stops in visit order: 1, 2, … then 0. */
  readonly stops: readonly SnippetStop[]
}

/** Where a snippet is landing, which is what decides how its continuation lines are indented. */
type SnippetInsertion = {
  readonly textSnapshot: TextReadSnapshot
  /** Offset of the snippet's first character, once whatever it replaces is gone. */
  readonly offset: number
}

export type SnippetOptions = {
  /** `$TM_SELECTED_TEXT`; any variable we cannot answer honestly expands to empty, as the spec allows. */
  readonly selection?: string
  /**
   * Omitted by a caller with no document behind it — a test of the grammar, a preview — which then
   * gets the snippet's own indentation verbatim rather than an invented one.
   */
  readonly insertion?: SnippetInsertion
}

export function parseSnippet(source: string, options: SnippetOptions = {}): ParsedSnippet {
  const expanded = expandSnippet(source, options)
  return options.insertion ? reindented(expanded, options.insertion) : expanded
}

function expandSnippet(source: string, options: SnippetOptions): ParsedSnippet {
  const parser = new SnippetParser(source, options)
  const parsed = parser.parse()
  // A transform reads the placeholder it mirrors, and the template is free to declare that
  // placeholder after it. Only once one has been seen is the walk worth repeating with every
  // default already collected.
  if (!parser.sawPlaceholderTransform) return parsed

  return new SnippetParser(source, options, parser.defaults).parse()
}

/**
 * Where the caret goes when a snippet has no tab stops at all: the end of the inserted text, which
 * is what a plain completion does.
 */
export function snippetInitialSelection(parsed: ParsedSnippet, offset: number): SnippetRange {
  const first = parsed.stops[0]
  if (!first) return { end: offset + parsed.text.length, start: offset + parsed.text.length }

  // A stop can render before it is declared — a transform of stop 1 written above `${1:default}` —
  // and the rendered copy is not the text the reader is being offered to replace.
  const range = first.ranges.find((candidate) => !candidate.transform) ?? first.ranges[0]
  if (!range) return { end: offset + parsed.text.length, start: offset + parsed.text.length }

  return { end: offset + range.end, start: offset + range.start }
}

/**
 * The expansion rewritten to sit where it is going.
 *
 * A server writes a snippet as though the file began at the caret: the first line carries no
 * indentation, and the lines under it are indented from column zero in whichever whitespace that
 * server happens to prefer. Dropped in verbatim under an indented caret, every line but the first
 * lands at the wrong depth and in the wrong characters — the one defect a reader sees before they
 * have read a word of what was inserted.
 *
 * Stops travel with the text they name, so what Tab visits afterwards is still the same characters.
 */
function reindented(parsed: ParsedSnippet, insertion: SnippetInsertion): ParsedSnippet {
  const lines = parsed.text.split('\n')
  if (lines.length < 2) return parsed

  const base = insertionLineIndent(insertion)
  const written = writtenIndentUnit(lines)
  const unit = documentIndentUnit(base, insertion.textSnapshot, written)
  if (base.length === 0 && unit === written) return parsed

  const shifts: LineShift[] = []
  let text = lines[0] ?? ''
  let start = text.length + 1
  let before = 0

  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    const wrote = leadingWhitespace(line)
    const indent = reindentedLineIndent(line, base, unit, written)

    text += `\n${indent}${line.slice(wrote.length)}`
    shifts.push({
      delta: before + indent.length - wrote.length,
      floor: start + before + indent.length,
      start,
    })
    before += indent.length - wrote.length
    start += line.length + 1
  }

  return {
    text,
    stops: parsed.stops.map((stop) => ({
      index: stop.index,
      ranges: stop.ranges.map((range) => ({
        ...range,
        end: shiftedOffset(shifts, range.end),
        start: shiftedOffset(shifts, range.start),
      })),
    })),
  }
}

type LineShift = {
  /** Where the line begins in the text as the snippet wrote it. */
  readonly start: number
  /** How far this line and every line under it moved. */
  readonly delta: number
  /** Where the line's first non-indent character ends up; nothing on it can sit before that. */
  readonly floor: number
}

/**
 * A written offset in the re-indented text.
 *
 * The floor is what answers a stop that opened inside the indentation the rewrite replaced — an
 * empty `$0` on its own line is exactly that — by putting it where that indentation now ends.
 */
function shiftedOffset(shifts: readonly LineShift[], offset: number): number {
  let result = offset
  for (const shift of shifts) {
    if (offset < shift.start) break

    result = Math.max(offset + shift.delta, shift.floor)
  }
  return result
}

function reindentedLineIndent(line: string, base: string, unit: string, written: string): string {
  // A line with nothing on it is left alone rather than filled with the spaces no one asked for.
  if (line.length === 0) return ''

  const lead = leadingWhitespace(line)
  if (written.length === 0) return base + lead

  const step = written[0] === '\t' ? '\t' : ' '
  let counted = 0
  while (counted < lead.length && lead[counted] === step) counted += 1

  // Whatever does not divide into levels is alignment the author put there on purpose, and it
  // survives at its own width: converting it would move the thing it was lined up with.
  const rest = step.repeat(counted % written.length) + lead.slice(counted)
  return base + unit.repeat(Math.floor(counted / written.length)) + rest
}

/**
 * One level as the snippet itself writes it: a tab where it uses tabs, otherwise the narrowest step
 * it indents by. Empty when nothing below the first line is indented, which leaves nothing to scale.
 */
function writtenIndentUnit(lines: readonly string[]): string {
  let narrowest = 0

  for (let index = 1; index < lines.length; index += 1) {
    const lead = leadingWhitespace(lines[index] ?? '')
    if (lead.includes('\t')) return '\t'
    if (lead.length > 0 && (narrowest === 0 || lead.length < narrowest)) narrowest = lead.length
  }
  return ' '.repeat(narrowest)
}

/**
 * One level as the document writes it.
 *
 * Tabs or spaces is the landing line's own answer, on the same reasoning the line-break indent uses:
 * in a file that mixes the two, what the neighbouring line does beats any document-wide vote. The
 * width is the document's, read off its text, because the file is the authority on how wide a level
 * is there and a host setting is the authority on some other file.
 */
function documentIndentUnit(base: string, textSnapshot: TextReadSnapshot, written: string): string {
  if (base.includes('\t')) return '\t'

  // Zero is not a width, so it comes back only when the text held nothing to measure — and on no
  // evidence at all, rewriting what the server sent is worse than leaving it.
  const guessed = guessedTabSize(textSnapshot, 0)
  return guessed > 0 ? ' '.repeat(guessed) : written
}

function insertionLineIndent(insertion: SnippetInsertion): string {
  const source = insertion.textSnapshot
  const offset = Math.max(0, Math.min(insertion.offset, source.length))
  return readLeadingWhitespace(source, source.lineStart(source.lineAt(offset)), offset)
}

class SnippetParser {
  private index = 0
  private out = ''
  private readonly byStop = new Map<number, SnippetRange[]>()
  /** Set once a transform on a numbered placeholder has been read, never cleared. */
  sawPlaceholderTransform = false

  constructor(
    private readonly source: string,
    private readonly options: SnippetOptions,
    /** Expanded default text per placeholder number, which is what a transform on it reads. */
    readonly defaults = new Map<number, string>(),
  ) {}

  parse(): ParsedSnippet {
    while (this.index < this.source.length) {
      const char = this.source[this.index]
      if (char === undefined) break

      if (char === '\\') {
        this.readEscape()
        continue
      }
      if (char === '$') {
        if (this.readTabStop()) continue
      }

      this.out += char
      this.index += 1
    }

    return { stops: this.orderedStops(), text: this.out }
  }

  /** `\$`, `\}` and `\\` are literals; a lone backslash stays a backslash. */
  private readEscape(): void {
    const next = this.source[this.index + 1]
    if (next === '$' || next === '}' || next === '\\') {
      this.out += next
      this.index += 2
      return
    }

    this.out += '\\'
    this.index += 1
  }

  /** Reads any `$…` form at the cursor. Returns false when it is a bare `$`. */
  private readTabStop(): boolean {
    const simple = /^\$(\d+)/.exec(this.source.slice(this.index))
    if (simple?.[1] !== undefined) {
      this.recordStop(Number(simple[1]), this.out.length, this.out.length)
      this.index += simple[0].length
      return true
    }

    const simpleVariable = /^\$([A-Za-z_][A-Za-z0-9_]*)/.exec(this.source.slice(this.index))
    if (simpleVariable?.[1] !== undefined) {
      this.out += this.variableValue(simpleVariable[1])
      this.index += simpleVariable[0].length
      return true
    }

    if (this.source[this.index + 1] !== '{') return false

    return this.readBracedStop()
  }

  private readBracedStop(): boolean {
    const braced = this.readBracedBody()
    if (braced === null) return false

    const { body, end } = braced
    const numbered = /^(\d+)(?::([\s\S]*))?$/.exec(body)
    if (numbered?.[1] !== undefined) {
      this.index = end
      const start = this.out.length
      if (numbered[2] !== undefined) this.expand(numbered[2])
      this.recordStop(Number(numbered[1]), start, this.out.length)
      this.rememberDefault(Number(numbered[1]), start)
      return true
    }

    const choice = /^(\d+)\|([\s\S]*)\|$/.exec(body)
    if (choice?.[1] !== undefined && choice[2] !== undefined) {
      this.index = end
      const start = this.out.length
      // The first choice is the default, matching what an editor shows before the user picks.
      this.out += choiceOptions(choice[2])[0] ?? ''
      this.recordStop(Number(choice[1]), start, this.out.length)
      this.rememberDefault(Number(choice[1]), start)
      return true
    }

    const variable = /^([A-Za-z_][A-Za-z0-9_]*)(?::([\s\S]*))?$/.exec(body)
    if (variable?.[1] !== undefined) {
      this.index = end
      const value = this.variableValue(variable[1])
      if (value.length > 0) this.out += value
      else if (variable[2] !== undefined) this.expand(variable[2])
      return true
    }

    return this.readTransformed(body, end)
  }

  /**
   * A `${name/regex/format/flags}` occurrence.
   *
   * Tried last, so a default that merely contains slashes — `${1:a/b/c}` — is still read as the
   * placeholder it is.
   */
  private readTransformed(body: string, end: number): boolean {
    const parts = transformParts(body)
    if (!parts) return false

    const transform = compileTransform(parts.pattern, parts.format, parts.flags)
    if (!transform) return false

    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(parts.name)) {
      this.index = end
      this.out += transform(this.variableValue(parts.name))
      return true
    }
    if (!/^\d+$/.test(parts.name)) return false

    this.index = end
    this.sawPlaceholderTransform = true
    const index = Number(parts.name)
    const start = this.out.length
    this.out += transform(this.defaults.get(index) ?? '')
    this.recordStop(index, start, this.out.length, transform)
    return true
  }

  /** Expands a `${…}` default in place, so the stops declared inside it stay stops. */
  private expand(body: string): void {
    const start = this.out.length
    const nested = new SnippetParser(body, this.options, this.defaults)
    const parsed = nested.parse()

    this.out += parsed.text
    this.sawPlaceholderTransform ||= nested.sawPlaceholderTransform
    for (const stop of parsed.stops) {
      for (const range of stop.ranges) {
        this.recordStop(stop.index, start + range.start, start + range.end, range.transform)
      }
    }
  }

  /**
   * Body of a `${…}` and the offset just past it, honouring nesting and escapes. Null when
   * unterminated. Leaves the cursor alone: a body no branch below recognises has to be re-read as
   * the literal text it was written as.
   */
  private readBracedBody(): { readonly body: string; readonly end: number } | null {
    let cursor = this.index + 2
    let depth = 1
    let body = ''

    while (cursor < this.source.length) {
      const char = this.source[cursor]
      if (char === undefined) break

      if (char === '\\') {
        body += char + (this.source[cursor + 1] ?? '')
        cursor += 2
        continue
      }
      if (char === '{') depth += 1
      if (char === '}') {
        depth -= 1
        if (depth === 0) return { body, end: cursor + 1 }
      }

      body += char
      cursor += 1
    }

    return null
  }

  /** The first non-empty expansion of a placeholder number is the value its transforms read. */
  private rememberDefault(index: number, start: number): void {
    if (this.out.length === start) return
    if (this.defaults.has(index)) return

    this.defaults.set(index, this.out.slice(start))
  }

  private recordStop(
    index: number,
    start: number,
    end: number,
    transform?: (value: string) => string,
  ): void {
    const range = transform ? { end, start, transform } : { end, start }
    const ranges = this.byStop.get(index)
    if (ranges) {
      ranges.push(range)
      return
    }

    this.byStop.set(index, [range])
  }

  /** 1, 2, 3 … then 0, because `$0` is where the caret exits. */
  private orderedStops(): readonly SnippetStop[] {
    return [...this.byStop.entries()]
      .map(([index, ranges]) => ({ index, ranges }))
      .sort((left, right) => stopOrder(left.index) - stopOrder(right.index))
  }

  private variableValue(name: string): string {
    if (name === 'TM_SELECTED_TEXT') return this.options.selection ?? ''

    return ''
  }
}

function stopOrder(index: number): number {
  return index === 0 ? Number.MAX_SAFE_INTEGER : index
}

/** Options of a `${1|a,b|}` body, split on the commas the author did not escape. */
function choiceOptions(body: string): readonly string[] {
  const options: string[] = []
  let current = ''

  for (let cursor = 0; cursor < body.length; cursor += 1) {
    const char = body[cursor]
    if (char === '\\') {
      const next = body[cursor + 1]
      current += next === ',' || next === '|' || next === '\\' ? next : char + (next ?? '')
      cursor += 1
      continue
    }
    if (char === ',') {
      options.push(current)
      current = ''
      continue
    }

    current += char
  }

  options.push(current)
  return options
}

type TransformParts = {
  readonly name: string
  readonly pattern: string
  readonly format: string
  readonly flags: string
}

/**
 * Splits `name/regex/format/flags` on its top-level slashes.
 *
 * Depth matters because the format carries its own braces — `${1:/upcase}` holds a slash that is
 * part of the format, not a separator.
 */
function transformParts(body: string): TransformParts | null {
  const parts: string[] = []
  let current = ''
  let depth = 0

  for (let cursor = 0; cursor < body.length; cursor += 1) {
    const char = body[cursor]
    if (char === '\\') {
      current += char + (body[cursor + 1] ?? '')
      cursor += 1
      continue
    }
    if (char === '{') depth += 1
    if (char === '}') depth -= 1
    if (char === '/' && depth === 0) {
      parts.push(current)
      current = ''
      continue
    }

    current += char
  }

  parts.push(current)
  if (parts.length !== 4) return null

  const [name, pattern, format, flags] = parts
  if (name === undefined || pattern === undefined || format === undefined || flags === undefined) {
    return null
  }

  return { flags, format, name, pattern }
}

/** Null for a regex the platform rejects, which leaves the whole occurrence literal text. */
function compileTransform(
  pattern: string,
  format: string,
  flags: string,
): ((value: string) => string) | null {
  let regex: RegExp
  try {
    regex = new RegExp(pattern.replace(/\\\//g, '/'), flags)
  } catch {
    return null
  }

  const pieces = parseFormat(format)
  return (value) => resolveTransform(regex, pieces, value)
}

function resolveTransform(regex: RegExp, pieces: readonly FormatPiece[], value: string): string {
  let matched = false
  const replaced = value.replace(regex, (...args: unknown[]) => {
    matched = true
    // Everything before the first numeric argument is the match and its captures; what follows is
    // the offset, the subject, and the named-group object a pattern may add.
    const captureEnd = args.findIndex((arg) => typeof arg === 'number')
    return renderFormat(pieces, args.slice(0, captureEnd) as (string | undefined)[])
  })
  if (matched) return replaced

  // An else branch exists precisely to answer the no-match case, so it still gets to run.
  const hasElse = pieces.some((piece) => piece.kind === 'group' && piece.elseValue !== undefined)
  return hasElse ? renderFormat(pieces, []) : replaced
}

type FormatPiece =
  | { readonly kind: 'text'; readonly value: string }
  | {
      readonly kind: 'group'
      readonly index: number
      readonly shorthand?: string
      readonly ifValue?: string
      readonly elseValue?: string
    }

function parseFormat(format: string): readonly FormatPiece[] {
  const pieces: FormatPiece[] = []
  let text = ''
  let cursor = 0

  const flushText = (): void => {
    if (text.length === 0) return

    pieces.push({ kind: 'text', value: text })
    text = ''
  }

  while (cursor < format.length) {
    const char = format[cursor]
    if (char === '\\') {
      const next = format[cursor + 1]
      // Only the two characters a transform is built out of are escapable here. Any other backslash
      // is text the author wrote, and eating it would quietly rewrite the replacement.
      if (next === '\\' || next === '/') {
        text += next
        cursor += 2
        continue
      }

      text += char
      cursor += 1
      continue
    }
    if (char === '$') {
      const group = readFormatGroup(format, cursor)
      if (group) {
        flushText()
        pieces.push(group.piece)
        cursor = group.end
        continue
      }
    }

    text += char ?? ''
    cursor += 1
  }

  flushText()
  return pieces
}

function readFormatGroup(
  format: string,
  start: number,
): { readonly piece: FormatPiece; readonly end: number } | null {
  const simple = /^\$(\d+)/.exec(format.slice(start))
  if (simple?.[1] !== undefined) {
    return { end: start + simple[0].length, piece: { index: Number(simple[1]), kind: 'group' } }
  }
  if (format[start + 1] !== '{') return null

  const close = closingBrace(format, start + 2)
  if (close === null) return null

  const piece = formatGroupPiece(format.slice(start + 2, close))
  return piece ? { end: close + 1, piece } : null
}

function formatGroupPiece(body: string): FormatPiece | null {
  const plain = /^(\d+)$/.exec(body)
  if (plain?.[1] !== undefined) return { index: Number(plain[1]), kind: 'group' }

  const shorthand = /^(\d+):\/([A-Za-z]+)$/.exec(body)
  if (shorthand?.[1] !== undefined && shorthand[2] !== undefined) {
    return { index: Number(shorthand[1]), kind: 'group', shorthand: shorthand[2] }
  }

  const branches = /^(\d+):\?([\s\S]*?):([\s\S]*)$/.exec(body)
  if (branches?.[1] !== undefined && branches[2] !== undefined && branches[3] !== undefined) {
    return {
      elseValue: unescapeBranch(branches[3]),
      ifValue: unescapeBranch(branches[2]),
      index: Number(branches[1]),
      kind: 'group',
    }
  }

  const ifOnly = /^(\d+):\+([\s\S]*)$/.exec(body)
  if (ifOnly?.[1] !== undefined && ifOnly[2] !== undefined) {
    return { ifValue: unescapeBranch(ifOnly[2]), index: Number(ifOnly[1]), kind: 'group' }
  }

  const elseOnly = /^(\d+):-?([\s\S]*)$/.exec(body)
  if (elseOnly?.[1] !== undefined && elseOnly[2] !== undefined) {
    return { elseValue: unescapeBranch(elseOnly[2]), index: Number(elseOnly[1]), kind: 'group' }
  }

  return null
}

/** Offset of the `}` closing a `${` opened at `from`, or null when the format never closes it. */
function closingBrace(format: string, from: number): number | null {
  let depth = 1

  for (let cursor = from; cursor < format.length; cursor += 1) {
    const char = format[cursor]
    if (char === '\\') {
      cursor += 1
      continue
    }
    if (char === '{') depth += 1
    if (char === '}') {
      depth -= 1
      if (depth === 0) return cursor
    }
  }

  return null
}

function unescapeBranch(value: string): string {
  return value.replace(/\\([$}\\])/g, '$1')
}

function renderFormat(
  pieces: readonly FormatPiece[],
  captures: readonly (string | undefined)[],
): string {
  let result = ''
  for (const piece of pieces) {
    result += piece.kind === 'text' ? piece.value : groupValue(piece, captures[piece.index] ?? '')
  }

  return result
}

function groupValue(piece: Extract<FormatPiece, { kind: 'group' }>, value: string): string {
  if (piece.shorthand !== undefined) return CASE_SHORTHANDS.get(piece.shorthand)?.(value) ?? value
  if (piece.ifValue !== undefined && value.length > 0) return piece.ifValue
  if (piece.elseValue !== undefined && value.length === 0) return piece.elseValue

  return value
}

/**
 * A run of letters or digits that reads as one word: an all-caps run, a capitalised or lower-case
 * run, or a lone capital. Splitting on the case change is what lets `fooBar` reach `foo-bar`.
 */
const FORMAT_WORD = /\p{Lu}+(?!\p{Ll})|\p{Lu}?[\p{Ll}\p{N}]+|\p{Lu}/gu

/** A map rather than an object literal, so a name like `toString` reaches nothing. */
const CASE_SHORTHANDS = new Map<string, (value: string) => string>([
  [
    'camelcase',
    (value) =>
      formatWords(value)
        .map((word, index) => (index === 0 ? lowerFirst(word) : upperFirst(word)))
        .join(''),
  ],
  ['capitalize', upperFirst],
  ['downcase', (value) => value.toLocaleLowerCase()],
  ['kebabcase', (value) => joinLowered(value, '-')],
  ['pascalcase', (value) => formatWords(value).map(upperFirst).join('')],
  ['snakecase', (value) => joinLowered(value, '_')],
  ['upcase', (value) => value.toLocaleUpperCase()],
])

/** Falls back to the value itself when it holds no words at all, so punctuation is never eaten. */
function formatWords(value: string): readonly string[] {
  const words = value.match(FORMAT_WORD)
  return words && words.length > 0 ? words : [value]
}

function joinLowered(value: string, separator: string): string {
  return formatWords(value)
    .map((word) => word.toLocaleLowerCase())
    .join(separator)
}

function upperFirst(value: string): string {
  return value.length === 0 ? value : value[0]!.toLocaleUpperCase() + value.slice(1)
}

function lowerFirst(value: string): string {
  return value.length === 0 ? value : value[0]!.toLocaleLowerCase() + value.slice(1)
}
