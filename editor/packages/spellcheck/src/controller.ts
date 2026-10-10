import type {
  EditorDisposable,
  EditorEditContributionContext,
  EditorViewContributionContext,
  EditorViewContributionUpdateKind,
  EditorViewSnapshot,
} from '@singapore-editor/core/extensions'
import type { EditorSpellcheckFeature, SpellIssue } from './feature'
import { spellcheckRegions, type SpellcheckRegions, type SpellcheckScope } from './proseRanges'
import type { SpellcheckService } from './service'
import { SPELLING_STYLE } from './styles'
import {
  foldApostrophes,
  MAX_SPELLCHECK_LINE_LENGTH,
  tokenizeSpellWords,
  type SpellTextRange,
  type SpellWord,
} from './tokenizer'

export type SpellcheckChecker = Pick<
  SpellcheckService,
  'check' | 'suggest' | 'isAccepted' | 'setAcceptedWords' | 'onDidChangeAcceptedWords'
>

const DEFAULT_SUGGESTIONS = 5
// Lines keyed by their text: typing re-tokenizes the line it changes, never the whole window.
const MAX_CACHED_LINES = 4096
const RECHECK_KINDS: ReadonlySet<EditorViewContributionUpdateKind> = new Set([
  'document',
  'content',
  'tokens',
  'selection',
  'viewport',
  'layout',
])

/**
 * One editor's spellcheck. Marks are always derived from the current text: the worker answers with
 * verdicts per word, never with offsets, so a reply that lands after an edit cannot paint stale ranges.
 */
export class SpellcheckController {
  private view: EditorViewContributionContext | null = null
  private edit: EditorEditContributionContext | null = null
  private highlightName = ''
  private readonly verdicts = new Map<string, boolean>()
  private readonly pending = new Set<string>()
  private readonly lines = new Map<string, readonly SpellWord[]>()
  private issues: readonly SpellIssue[] = []
  private held: readonly SpellTextRange[] = []
  private paintedKey = ''
  private recheckInputs = ''
  private dictionaryVersion = 0
  private verdictVersion = 0
  private wordsKey = ''
  private wordsCaptures: readonly unknown[] | null = null
  private cachedWords: readonly SpellWord[] = []
  private failed = false
  private disposed = false

  public constructor(
    private readonly checker: SpellcheckChecker,
    private readonly scope: SpellcheckScope,
  ) {}

  public attachView(context: EditorViewContributionContext): EditorDisposable {
    this.view = context
    this.highlightName = `${context.highlightPrefix}-spelling`
    const captures = context.requestSyntaxCaptures()
    const accepted = this.checker.onDidChangeAcceptedWords(() => {
      this.dictionaryVersion += 1
      this.verdicts.clear()
      this.pending.clear()
      this.verdictVersion += 1
      this.refresh()
    })
    return {
      dispose: () => {
        captures.dispose()
        accepted.dispose()
        context.clearRangeHighlight(this.highlightName)
        this.view = null
        this.disposed = true
      },
    }
  }

  public attachEdit(context: EditorEditContributionContext): EditorDisposable {
    this.edit = context
    return { dispose: () => (this.edit = null) }
  }

  public feature(): EditorSpellcheckFeature {
    return {
      issueAt: (offset) => this.issueAt(offset),
      suggestions: (offset, limit = DEFAULT_SUGGESTIONS) => {
        const issue = this.issueAt(offset)
        return issue ? this.checker.suggest(issue.word, limit) : Promise.resolve([])
      },
      replace: (offset, word) => this.replace(offset, word),
      setAcceptedWords: (words) => this.checker.setAcceptedWords(words),
    }
  }

  public update(snapshot: EditorViewSnapshot, kind: EditorViewContributionUpdateKind): void {
    if (kind === 'clear') {
      this.paint([], null)
      return
    }
    if (!RECHECK_KINDS.has(kind)) return
    if (kind === 'document') this.held = []
    this.recheck(snapshot, kind === 'content')
  }

  private refresh(): void {
    if (this.view) this.recheck(this.view.getSnapshot(), false)
  }

  private recheck(snapshot: EditorViewSnapshot, edited: boolean): void {
    const context = this.view
    if (!context || !context.hasDocument()) return this.paint([], null)

    const window = checkWindow(snapshot)
    const words = window ? this.windowWords(snapshot, context, window) : []
    if (!words) {
      this.recheckInputs = ''
      return this.paint([], null)
    }

    const carets = caretOffsets(snapshot)
    const mounted = mountedRange(snapshot)
    const inputs = `${this.wordsKey}|${carets.join(',')}|${mounted?.start}:${mounted?.end}|${this.verdictVersion}`
    if (!edited && inputs === this.recheckInputs) return
    this.recheckInputs = inputs
    this.held = edited ? wordsAtCarets(words, carets) : stillHeld(this.held, carets)

    const issues: SpellIssue[] = []
    const unknown = new Set<string>()
    for (const word of words) {
      const verdict = this.verdicts.get(word.word)
      if (verdict === false) continue
      if (isHeld(word, this.held)) continue
      if (verdict === undefined) unknown.add(word.word)
      else if (!this.checker.isAccepted(word.word)) issues.push(word)
    }

    this.paint(issues, mounted)
    this.request(unknown)
  }

  /** Selection and scroll updates outnumber edits; they reuse the words while the window holds. */
  private windowWords(
    snapshot: EditorViewSnapshot,
    context: EditorViewContributionContext,
    window: SpellTextRange,
  ): readonly SpellWord[] | null {
    const captures = context.getSyntaxCaptures()
    const replacements = context.getInlineReplacementRanges()
    const key = [snapshot.languageId, snapshot.textVersion, window.start, window.end]
      .concat(replacements.flatMap((range) => [range.start, range.end]))
      .join(',')
    if (key === this.wordsKey && captures === this.wordsCaptures) return this.cachedWords

    const regions = spellcheckRegions({
      languageId: snapshot.languageId,
      captures,
      window,
      scope: this.scope,
    })
    if (!regions) return null
    this.recheckInputs = ''
    this.cachedWords = this.words(snapshot, regions, replacements)
    this.wordsKey = key
    this.wordsCaptures = captures
    return this.cachedWords
  }

  private words(
    snapshot: EditorViewSnapshot,
    regions: SpellcheckRegions,
    replacements: readonly SpellTextRange[],
  ): readonly SpellWord[] {
    const text = snapshot.textSnapshot
    const excluded = regions.excluded.concat(replacements)
    const words: SpellWord[] = []
    for (const region of regions.prose) this.proseWords(text, region, excluded, words)
    for (const region of regions.code) {
      if (region.end - region.start > MAX_SPELLCHECK_LINE_LENGTH) continue
      const source = text.readRange(region.start, region.end)
      const local = localRanges(excluded, region)
      for (const word of tokenizeSpellWords(source, { mode: 'code', excluded: local })) {
        words.push(shifted(word, region.start))
      }
    }
    return words
  }

  private proseWords(
    text: EditorViewSnapshot['textSnapshot'],
    region: SpellTextRange,
    excluded: readonly SpellTextRange[],
    words: SpellWord[],
  ): void {
    const firstLine = text.lineAt(region.start)
    const lastLine = text.lineAt(region.end)
    for (let line = firstLine; line <= lastLine; line++) {
      const range = text.lineRange(line)
      if (range.end - range.start > MAX_SPELLCHECK_LINE_LENGTH) continue
      const local = localRanges(excluded, range)
      const lineWords = this.lineWords(text.readRange(range.start, range.end), local)
      for (const word of lineWords) words.push(shifted(word, range.start))
    }
  }

  private lineWords(line: string, excluded: readonly SpellTextRange[]): readonly SpellWord[] {
    if (excluded.length > 0) return tokenizeSpellWords(line, { excluded })

    const cached = this.lines.get(line)
    if (cached) return cached
    if (this.lines.size >= MAX_CACHED_LINES) this.lines.clear()
    const words = tokenizeSpellWords(line)
    this.lines.set(line, words)
    return words
  }

  private request(unknown: ReadonlySet<string>): void {
    if (this.failed) return
    const words = [...unknown].filter((word) => !this.pending.has(word))
    if (words.length === 0) return

    for (const word of words) this.pending.add(word)
    const dictionaryVersion = this.dictionaryVersion
    this.checker.check(words).then(
      (misspelled) => {
        if (dictionaryVersion === this.dictionaryVersion) this.settle(words, new Set(misspelled))
      },
      (error: unknown) => {
        if (dictionaryVersion === this.dictionaryVersion) this.fail(words, error)
      },
    )
  }

  private settle(words: readonly string[], misspelled: ReadonlySet<string>): void {
    for (const word of words) {
      this.pending.delete(word)
      this.verdicts.set(word, misspelled.has(word))
    }
    this.verdictVersion += 1
    if (!this.disposed) this.refresh()
  }

  /** A failed worker is not asked again by this editor: every keystroke would start another. */
  private fail(words: readonly string[], error: unknown): void {
    for (const word of words) this.pending.delete(word)
    if (this.disposed || this.failed) return
    this.failed = true
    this.view?.log({
      action: 'spellcheck.check',
      level: 'warn',
      message: 'Spellcheck stopped: the dictionary worker failed',
      reason: error instanceof Error ? error.message : String(error),
    })
  }

  /** Every issue in the window answers `issueAt`; only those on mounted rows are painted. */
  private paint(issues: readonly SpellIssue[], mounted: SpellTextRange | null): void {
    this.issues = issues
    const view = this.view
    if (!view) return
    const painted = mounted
      ? issues.filter((issue) => issue.end > mounted.start && issue.start < mounted.end)
      : []
    const key = painted.map((issue) => `${issue.start}:${issue.end}`).join(',')
    if (key === this.paintedKey) return
    this.paintedKey = key
    if (painted.length === 0) view.clearRangeHighlight(this.highlightName)
    else view.setRangeHighlight(this.highlightName, painted, SPELLING_STYLE)
  }

  private issueAt(offset: number): SpellIssue | null {
    return this.issues.find((issue) => issue.start <= offset && offset <= issue.end) ?? null
  }

  private replace(offset: number, word: string): boolean {
    const issue = this.issueAt(offset)
    const edit = this.edit
    if (!issue || !edit) return false
    const text = edit.getTextSnapshot()
    if (!text || foldApostrophes(text.readRange(issue.start, issue.end)) !== issue.word)
      return false

    edit.applyEdits([{ from: issue.start, to: issue.end, text: word }], 'spellcheck.replace')
    return true
  }
}

function mountedRange(snapshot: EditorViewSnapshot): SpellTextRange | null {
  let start = Number.POSITIVE_INFINITY
  let end = -1
  for (const row of snapshot.visibleRows) {
    if (row.source !== 'document') continue
    start = Math.min(start, row.startOffset)
    end = Math.max(end, row.endOffset)
  }
  return end < 0 ? null : { start, end }
}

/** The mounted rows plus one screen above and below them. */
function checkWindow(snapshot: EditorViewSnapshot): SpellTextRange | null {
  let first = Number.POSITIVE_INFINITY
  let last = -1
  for (const row of snapshot.visibleRows) {
    if (row.source !== 'document') continue
    first = Math.min(first, row.bufferRow)
    last = Math.max(last, row.bufferRow)
  }
  if (last < 0) return null

  const text = snapshot.textSnapshot
  const span = last - first + 1
  const startLine = Math.max(0, first - span)
  const endLine = Math.min(text.lineCount - 1, last + span)
  return { start: text.lineStart(startLine), end: text.lineRange(endLine).end }
}

function caretOffsets(snapshot: EditorViewSnapshot): readonly number[] {
  return snapshot.selections
    .filter((selection) => selection.startOffset === selection.endOffset)
    .map((selection) => selection.headOffset)
}

function containsCaret(range: SpellTextRange, carets: readonly number[]): boolean {
  return carets.some((caret) => range.start <= caret && caret <= range.end)
}

/** The words being typed: held back until the caret leaves them. */
function wordsAtCarets(
  words: readonly SpellWord[],
  carets: readonly number[],
): readonly SpellTextRange[] {
  return words.filter((word) => containsCaret(word, carets))
}

function stillHeld(
  held: readonly SpellTextRange[],
  carets: readonly number[],
): readonly SpellTextRange[] {
  return held.filter((range) => containsCaret(range, carets))
}

function isHeld(word: SpellTextRange, held: readonly SpellTextRange[]): boolean {
  return held.some((range) => range.start === word.start && range.end === word.end)
}

function localRanges(
  ranges: readonly SpellTextRange[],
  within: SpellTextRange,
): readonly SpellTextRange[] {
  const local: SpellTextRange[] = []
  for (const range of ranges) {
    if (range.end <= within.start || range.start >= within.end) continue
    local.push({ start: range.start - within.start, end: range.end - within.start })
  }
  return local
}

function shifted(word: SpellWord, by: number): SpellWord {
  return { start: word.start + by, end: word.end + by, word: word.word }
}
