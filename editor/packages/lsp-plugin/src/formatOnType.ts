import type { TextEdit } from '@singapore-editor/core/document'
import {
  type EditorContributionChange,
  editorLanguageConfiguration,
  reindentEditsForRanges,
  type EditorCapabilityToken,
  type EditorLanguageConfiguration,
  type EditorViewContributionContext,
  type EditorViewContributionUpdateKind,
  type EditorViewSnapshot,
} from '@singapore-editor/core/extensions'

import type { LanguageServerCompletionEditFeature } from './completion'

/**
 * Putting the row the caret is on back at the level its own text asks for, on the keystroke that
 * changed which level that is.
 *
 * A closing delimiter is typed at the depth of the block it ends, one level in from where it
 * belongs, and nothing afterwards moves it — every closed block is left a level too deep until
 * somebody reindents the region by hand. The question "where does this row belong" is the one the
 * reindent commands ask of the language's indentation rules, so it is asked of them here too
 * rather than answered again beside them.
 *
 * Two narrow gates keep it from being a formatter that runs on every keystroke: which characters
 * are watched at all, and whether the answer is still about the document by the time it is written.
 * The second is a gate rather than a certainty because the edit is handed over a turn after it is
 * computed — a row cannot be rewritten from inside the announcement of the keystroke that produced
 * it.
 */

export type FormatOnTypeControllerOptions = {
  readonly context: EditorViewContributionContext
  readonly editFeature: EditorCapabilityToken<LanguageServerCompletionEditFeature>
}

/** An edit, and the document it was measured against. */
type PendingFormatOnType = {
  readonly caretOffset: number
  readonly edit: TextEdit
  readonly textVersion: number
}

/**
 * The text one row's level is decided from, and where it sits in the document.
 *
 * A row belongs one level in from the row above it, unless either of them is inside a string or a
 * comment — and which literals are open is only settled by reading from wherever they were opened.
 * Reading from the top of the document scans the whole file on a keystroke and goes on growing with
 * it; reading back a fixed distance costs the same in a file of any size, and the only text the two
 * answer differently for is a literal left open for longer than that distance.
 */
type FormatOnTypeWindow = {
  readonly text: string
  /** Where `text` starts, always at a row start so the rows inside it are the document's rows. */
  readonly start: number
  /** The caret, in the window's own offsets. */
  readonly caretOffset: number
}

const FORMAT_ON_TYPE_WINDOW = 4096

export class FormatOnTypeController {
  private pending: PendingFormatOnType | null = null
  private scheduled = false
  private disposed = false

  public constructor(private readonly options: FormatOnTypeControllerOptions) {}

  public update(
    snapshot: EditorViewSnapshot,
    kind: EditorViewContributionUpdateKind,
    change: EditorContributionChange | null,
  ): void {
    if (kind === 'document' || kind === 'clear') {
      this.pending = null
      return
    }
    if (kind !== 'content') return

    this.carryPendingForward(snapshot, change)
    const caretOffset = formatOnTypeCaret(snapshot, change)
    if (caretOffset === null) return

    const pending = pendingFormatOnType(snapshot, caretOffset)
    if (!pending) return

    this.pending = pending
    this.schedule()
  }

  public dispose(): void {
    this.disposed = true
    this.pending = null
  }

  /**
   * Moves an edit onto the document an announced change has just produced, or drops it.
   *
   * Its range is a pair of offsets into one document. An edit arriving at or before the caret moves
   * them, and replacing what now sits there would take a bite out of text the reader wrote in the
   * meantime. An edit past the caret cannot reach the row's leading whitespace, so the answer still
   * holds — and re-stamping is how it goes on holding for a document that has legitimately moved on.
   */
  private carryPendingForward(
    snapshot: EditorViewSnapshot,
    change: EditorContributionChange | null,
  ): void {
    const pending = this.pending
    if (!pending || !change) return
    if (change.edits.some((edit) => edit.from <= pending.caretOffset)) {
      this.pending = null
      return
    }

    this.pending = { ...pending, textVersion: snapshot.textVersion }
  }

  private schedule(): void {
    if (this.scheduled) return

    this.scheduled = true
    /**
     * @justification Coalesces the re-indents a single keystroke can queue into one pass at the end
     * of the turn, so the edit lands before the frame the character was typed in is painted;
     * `scheduled` is what makes a second call in that turn a no-op rather than a second pass.
     */
    queueMicrotask(() => {
      this.scheduled = false
      this.applyPending()
    })
  }

  private applyPending(): void {
    const pending = this.pending
    this.pending = null
    if (!pending || this.disposed) return

    const snapshot = this.options.context.getSnapshot()
    // A pass opened from inside another one is not announced a second time, so the guard above
    // cannot have seen every edit. Reading the range back would only say that some whitespace still
    // sits at those numbers, which an unannounced edit shifting the buffer leaves true of a row the
    // reader never touched; the version is the one reading that counts every edit either way.
    if (snapshot.textVersion !== pending.textVersion) return

    const feature = this.options.context.getFeature(this.options.editFeature)
    if (!feature) return

    const head =
      pending.caretOffset + pending.edit.text.length - (pending.edit.to - pending.edit.from)
    feature.applyCompletion({ edits: [pending.edit], selection: { anchor: head, head } })
  }
}

/**
 * Where the caret sits after a keystroke that can have changed its row's level, or null for one
 * that cannot have.
 *
 * Several carets, or a caret with a selection behind it, describe an edit whose shape this cannot
 * read, so they ask for nothing.
 */
function formatOnTypeCaret(
  snapshot: EditorViewSnapshot,
  change: EditorContributionChange | null,
): number | null {
  if (!change || change.kind !== 'edit') return null
  if (change.edits.length !== 1) return null

  const edit = change.edits[0]
  if (!edit || edit.text.length !== 1) return null

  const configuration = ruledConfiguration(snapshot.languageId)
  if (!configuration) return null
  if (!triggerCharacters(configuration).has(edit.text)) return null

  if (snapshot.selections.length !== 1) return null
  const selection = snapshot.selections[0]
  if (!selection || selection.startOffset !== selection.endOffset) return null

  const caretOffset = selection.headOffset

  return caretOffset === edit.from + edit.text.length ? caretOffset : null
}

/** The rules for a language whose rows have levels at all; without them there is nothing to say. */
function ruledConfiguration(languageId: string | null): EditorLanguageConfiguration | null {
  const configuration = editorLanguageConfiguration(languageId)

  return configuration?.indentationRules ? configuration : null
}

const triggerCharactersByConfiguration = new WeakMap<
  EditorLanguageConfiguration,
  ReadonlySet<string>
>()

/**
 * The characters whose arrival can put a row at a different level than the one it was typed on.
 *
 * A row drops a level by holding the delimiter that closes a block, so the closers the language
 * describes are the whole set — which is also what keeps prose, which describes none, out of this
 * without a list of exemptions. The last character is what finishes a closer, so blocks that end in
 * a word are watched by the keystroke completing the word rather than the one starting it.
 *
 * Every other keystroke stops here, on one lookup, rather than going on to read the row. The set is
 * kept against the record it was read from and not against the language's name, so a host replacing
 * a language's rules gets a set built from the rules it replaced them with; there is no moment at
 * which a stale set can answer.
 */
function triggerCharacters(configuration: EditorLanguageConfiguration): ReadonlySet<string> {
  const cached = triggerCharactersByConfiguration.get(configuration)
  if (cached) return cached

  const characters = new Set<string>()
  for (const pair of configuration.brackets) {
    const last = pair.close.at(-1)
    if (last !== undefined) characters.add(last)
  }

  triggerCharactersByConfiguration.set(configuration, characters)
  return characters
}

/**
 * Whether the closer ending at the caret is the whole of what its row holds.
 *
 * A closer that follows anything else was written to end an expression the row is carrying, not the
 * block the row sits in; moving the row would take that expression somewhere it was not put. Which
 * closer it is has to be decided here rather than from the single character typed, because a
 * multi-character delimiter is only itself once the whole of it is on the row.
 */
function closesItsOwnRow(
  configuration: EditorLanguageConfiguration,
  window: FormatOnTypeWindow,
): boolean {
  const rowStart = window.text.lastIndexOf('\n', window.caretOffset - 1) + 1
  const before = window.text.slice(rowStart, window.caretOffset)

  return configuration.brackets.some(
    (pair) =>
      before.endsWith(pair.close) && isBlank(before.slice(0, before.length - pair.close.length)),
  )
}

function isBlank(text: string): boolean {
  return !/[^\t ]/u.test(text)
}

function pendingFormatOnType(
  snapshot: EditorViewSnapshot,
  caretOffset: number,
): PendingFormatOnType | null {
  const configuration = ruledConfiguration(snapshot.languageId)
  if (!configuration) return null

  const window = formatOnTypeWindow(snapshot, caretOffset)
  if (!window || !closesItsOwnRow(configuration, window)) return null

  const [edit] = reindentEditsForRanges(
    window.text,
    [{ end: window.caretOffset, start: window.caretOffset }],
    { languageId: snapshot.languageId, tabSize: snapshot.tabSize },
  )
  if (!edit) return null

  return {
    caretOffset,
    edit: { from: edit.from + window.start, text: edit.text, to: edit.to + window.start },
    textVersion: snapshot.textVersion,
  }
}

/**
 * Whole rows back to the bound, and the caret's own row through to its end.
 *
 * The row is read to its end rather than to the caret because a language's rules are patterns over
 * the whole of it, and a closer with anything behind it on the row is a row that describes something
 * other than the block it sits in. A caret standing further than the bound from a row start has
 * nothing above it this can read, and says so rather than measuring against half a row.
 */
function formatOnTypeWindow(
  snapshot: EditorViewSnapshot,
  caretOffset: number,
): FormatOnTypeWindow | null {
  const source = snapshot.textSnapshot
  const length = source.length
  const read = (start: number, end: number): string => source.readRange(start, end)

  const from = Math.max(0, caretOffset - FORMAT_ON_TYPE_WINDOW)
  const before = read(from, caretOffset)
  const firstBreak = before.indexOf('\n')
  if (from > 0 && firstBreak === -1) return null

  const start = from === 0 ? 0 : from + firstBreak + 1
  const after = read(caretOffset, Math.min(length, caretOffset + FORMAT_ON_TYPE_WINDOW))
  const rowEnd = after.indexOf('\n')

  return {
    text: before.slice(start - from) + (rowEnd === -1 ? after : after.slice(0, rowEnd)),
    start,
    caretOffset: caretOffset - start,
  }
}
