import type { TextEdit } from '../tokens'
import type { HighlighterGeneric, ThemedToken } from 'shiki/core'
import { createScopedLineTokenizer } from './scopedTokens'

export interface TokenLineSnapshot {
  text: string
  tokens: readonly ThemedToken[]
}

export interface TokenPatch {
  fromLine: number
  toLine: number
  lines: readonly TokenLineSnapshot[]
  /** The text `[fromOffset, oldEndOffset)` became `[fromOffset, newEndOffset)`: whole lines. */
  fromOffset: number
  oldEndOffset: number
  newEndOffset: number
}

export interface IncrementalTokenizerSnapshot {
  code: string
  lines: readonly TokenLineSnapshot[]
}

export interface LineTokens {
  tokens: readonly ThemedToken[]
  state: unknown
}

export type TokenizeLineFn = (line: string, previousState: unknown) => LineTokens
export type StatesEqualFn = (left: unknown, right: unknown) => boolean

type TokenizerHighlighter = Pick<HighlighterGeneric<string, string>, 'getLanguage' | 'getTheme'>

export interface CreateIncrementalTokenizerOptions<
  Highlighter = HighlighterGeneric<string, string>,
> {
  lang: string
  theme: string
  code?: string
  highlighter: Highlighter
}

export interface CreateIncrementalTokenizerResult<
  Highlighter = HighlighterGeneric<string, string>,
> {
  tokenizer: IncrementalTokenizer & { setTheme(theme: string): void }
  highlighter: Highlighter
}

export interface IncrementalTokenizer {
  applyEdit(edit: TextEdit): TokenPatch
  applyEdits(edits: readonly TextEdit[]): readonly TokenPatch[]
  update(code: string): TokenPatch
  reset(code?: string): TokenPatch
  getCode(): string
  getSnapshot(): IncrementalTokenizerSnapshot
  getTokens(): readonly (readonly ThemedToken[])[]
}

interface LineState {
  text: string
  tokens: readonly ThemedToken[]
  endState: unknown
}

function splitLines(code: string): string[] {
  return code.split('\n').map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line))
}

function cloneSnapshot(lines: readonly LineState[]): TokenLineSnapshot[] {
  return lines.map((line) => ({
    text: line.text,
    tokens: line.tokens.slice(),
  }))
}

function tokenLinesEqual(left: readonly ThemedToken[], right: readonly ThemedToken[]): boolean {
  if (left.length !== right.length) return false

  for (let index = 0; index < left.length; index++) {
    const leftToken = left[index]
    const rightToken = right[index]

    if (
      !leftToken ||
      !rightToken ||
      leftToken.content !== rightToken.content ||
      leftToken.color !== rightToken.color ||
      leftToken.fontStyle !== rightToken.fontStyle
    ) {
      return false
    }
  }

  return true
}

export class IncrementalShikiTokenizer implements IncrementalTokenizer {
  private code: string
  private lines: LineState[]
  private readonly tokenize: TokenizeLineFn
  private readonly statesEqual: StatesEqualFn

  public constructor(tokenizeLine: TokenizeLineFn, statesEqual: StatesEqualFn, code?: string) {
    this.tokenize = tokenizeLine
    this.statesEqual = statesEqual
    this.code = ''
    this.lines = []

    this.reset(code ?? '')
  }

  public applyEdit(edit: TextEdit): TokenPatch {
    const { from, to, text } = edit
    const newCode = this.code.slice(0, from) + text + this.code.slice(to)

    const start = this.offsetToLine(from)
    const end = this.offsetToLine(to)

    // Splice the edit into the affected line text
    const prefixText = this.lines[start.line]?.text.slice(0, start.col) ?? ''
    const suffixText = this.lines[end.line]?.text.slice(end.col) ?? ''
    const editedLines = splitLines(prefixText + text + suffixText)

    // Retokenize edited lines using the grammar state before the first affected line
    const initialState = start.line === 0 ? undefined : this.lines[start.line - 1]?.endState
    const retokenized = this.tokenizeLines(editedLines, initialState)

    // Walk forward through old suffix lines until grammar state stabilizes
    const oldSuffixStart = end.line + 1
    let stableAt = oldSuffixStart
    let state = retokenized[retokenized.length - 1]?.endState

    for (let i = oldSuffixStart; i < this.lines.length; i++) {
      const oldLine = this.lines[i]!

      if (this.statesEqual(state, this.lines[i - 1]?.endState)) break

      const result = this.tokenize(oldLine.text, state)
      retokenized.push({ text: oldLine.text, tokens: result.tokens, endState: result.state })
      state = result.state
      stableAt = i + 1
    }

    const fromOffset = from - start.col
    const oldEndOffset = lineOffset(this.lines, stableAt)
    this.code = newCode
    this.lines = this.lines.slice(0, start.line).concat(retokenized, this.lines.slice(stableAt))

    return {
      fromLine: start.line,
      toLine: stableAt,
      lines: cloneSnapshot(retokenized),
      fromOffset,
      oldEndOffset,
      newEndOffset: lineOffset(this.lines, start.line + retokenized.length),
    }
  }

  /**
   * A batch shares the coordinates of the current text and applies highest-first, in the piece
   * table's own order, so each edit pays for its own lines only. One span over the batch would
   * retokenize everything between two distant edits. Each patch is in the coordinates of the
   * text as it stood when that edit applied.
   */
  public applyEdits(edits: readonly TextEdit[]): readonly TokenPatch[] {
    return edits.toSorted(compareEditsDescending).map((edit) => this.applyEdit(edit))
  }

  private offsetToLine(offset: number): { line: number; col: number } {
    let remaining = offset

    for (let i = 0; i < this.lines.length; i++) {
      const len = this.lines[i]!.text.length
      if (remaining <= len) return { line: i, col: remaining }
      remaining -= len + 1 // +1 for the \n separator
    }

    const last = this.lines.length - 1
    return { line: last, col: this.lines[last]?.text.length ?? 0 }
  }

  private append(chunk: string): TokenPatch {
    if (chunk.length === 0) {
      const length = this.code.length
      return {
        fromLine: this.lines.length,
        toLine: this.lines.length,
        lines: [],
        fromOffset: length,
        oldEndOffset: length,
        newEndOffset: length,
      }
    }

    const previousLength = this.lines.length
    const startLine = previousLength === 0 ? 0 : previousLength - 1
    const prefix = this.lines.slice(0, startLine)
    const previousTail = previousLength === 0 ? '' : (this.lines[previousLength - 1]?.text ?? '')
    const suffixLines = splitLines(previousTail + chunk)
    const nextTail = this.tokenizeLines(
      suffixLines,
      startLine === 0 ? undefined : prefix[startLine - 1]?.endState,
    )

    const fromOffset = lineOffset(this.lines, startLine)
    const oldEndOffset = this.code.length
    this.code += chunk
    this.lines = prefix.concat(nextTail)

    return {
      fromLine: startLine,
      toLine: previousLength,
      lines: cloneSnapshot(nextTail),
      fromOffset,
      oldEndOffset,
      newEndOffset: this.code.length,
    }
  }

  public update(code: string): TokenPatch {
    if (code === this.code) return emptyPatch()

    if (code.startsWith(this.code)) return this.append(code.slice(this.code.length))

    const nextLines = splitLines(code)
    const previousLines = this.lines
    const previousLength = previousLines.length
    const nextLength = nextLines.length

    let prefixLength = 0
    while (
      prefixLength < previousLength &&
      prefixLength < nextLength &&
      previousLines[prefixLength]?.text === nextLines[prefixLength]
    ) {
      prefixLength++
    }

    let suffixLength = 0
    while (
      suffixLength < previousLength - prefixLength &&
      suffixLength < nextLength - prefixLength &&
      previousLines[previousLength - 1 - suffixLength]?.text ===
        nextLines[nextLength - 1 - suffixLength]
    ) {
      suffixLength++
    }

    const nextPrefix = previousLines.slice(0, prefixLength)
    const rebuiltMiddle: LineState[] = []
    let previousState = prefixLength === 0 ? undefined : nextPrefix[prefixLength - 1]?.endState
    const previousTailStart = previousLength - suffixLength
    const nextTailStart = nextLength - suffixLength

    for (let nextIndex = prefixLength; nextIndex < nextLength; nextIndex++) {
      const line = nextLines[nextIndex] ?? ''
      const result = this.tokenize(line, previousState)
      const tokenizedLine: LineState = {
        text: line,
        tokens: result.tokens,
        endState: result.state,
      }
      previousState = tokenizedLine.endState

      const inSharedSuffix = suffixLength > 0 && nextIndex >= nextTailStart
      if (inSharedSuffix) {
        const previousIndex = previousTailStart + (nextIndex - nextTailStart)
        const previousLine = previousLines[previousIndex]
        if (
          previousLine &&
          previousLine.text === line &&
          tokenLinesEqual(tokenizedLine.tokens, previousLine.tokens) &&
          this.statesEqual(tokenizedLine.endState, previousLine.endState)
        ) {
          const nextDocument = nextPrefix.concat(rebuiltMiddle, previousLines.slice(previousIndex))

          this.code = code
          this.lines = nextDocument

          return {
            fromLine: prefixLength,
            toLine: previousIndex,
            lines: cloneSnapshot(rebuiltMiddle),
            fromOffset: lineOffset(previousLines, prefixLength),
            oldEndOffset: lineOffset(previousLines, previousIndex),
            newEndOffset: lineOffset(nextDocument, prefixLength + rebuiltMiddle.length),
          }
        }
      }

      rebuiltMiddle.push(tokenizedLine)
    }

    const oldEndOffset = this.code.length
    this.code = code
    this.lines = nextPrefix.concat(rebuiltMiddle)

    return {
      fromLine: prefixLength,
      toLine: previousLength,
      lines: cloneSnapshot(rebuiltMiddle),
      fromOffset: lineOffset(previousLines, prefixLength),
      oldEndOffset,
      newEndOffset: code.length,
    }
  }

  public reset(code = ''): TokenPatch {
    const previousLength = this.lines.length
    const oldEndOffset = this.code.length
    this.code = code
    this.lines = this.tokenizeLines(splitLines(code))

    return {
      fromLine: 0,
      toLine: previousLength,
      lines: cloneSnapshot(this.lines),
      fromOffset: 0,
      oldEndOffset,
      newEndOffset: code.length,
    }
  }

  public getCode(): string {
    return this.code
  }

  public getSnapshot(): IncrementalTokenizerSnapshot {
    return {
      code: this.code,
      lines: cloneSnapshot(this.lines),
    }
  }

  public getTokens(): readonly (readonly ThemedToken[])[] {
    return this.lines.map((line) => line.tokens.slice())
  }

  private tokenizeLines(lines: readonly string[], initialState?: unknown): LineState[] {
    const tokenized: LineState[] = []
    let previousState = initialState

    for (const line of lines) {
      const result = this.tokenize(line, previousState)
      const lineState: LineState = { text: line, tokens: result.tokens, endState: result.state }
      tokenized.push(lineState)
      previousState = result.state
    }

    return tokenized
  }
}

function emptyPatch(): TokenPatch {
  return { fromLine: 0, toLine: 0, lines: [], fromOffset: 0, oldEndOffset: 0, newEndOffset: 0 }
}

/** Offset of the start of `line`; the document length when `line` is the line count. */
function lineOffset(lines: readonly { readonly text: string }[], line: number): number {
  let offset = 0
  const separators = Math.min(line, Math.max(0, lines.length - 1))
  for (let index = 0; index < line && index < lines.length; index += 1) {
    offset += lines[index]!.text.length
  }
  return offset + separators
}

function compareEditsDescending(left: TextEdit, right: TextEdit): number {
  return right.from - left.from || right.to - left.to
}

export async function createIncrementalTokenizer<Highlighter extends TokenizerHighlighter>(
  options: CreateIncrementalTokenizerOptions<Highlighter>,
): Promise<CreateIncrementalTokenizerResult<Highlighter>> {
  const { highlighter } = options

  const engine = createScopedLineTokenizer(highlighter, options.lang, options.theme)

  return {
    tokenizer: Object.assign(
      new IncrementalShikiTokenizer(engine.tokenize, engine.statesEqual, options.code),
      { setTheme: engine.setTheme },
    ),
    highlighter,
  }
}
