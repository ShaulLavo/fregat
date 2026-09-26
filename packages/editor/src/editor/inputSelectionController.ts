import { scheduleFrame, type ScheduledFrame } from './scheduleFrame'
import type {
  DocumentSession,
  DocumentSessionChange,
  DocumentSessionSelectionRange,
} from '../documentSession'
import { previousDeleteBoundary } from '../graphemes'
import {
  normalizeLineEndings,
  offsetToPoint,
  type PieceTableAnchor,
  type PieceTableSnapshot,
  pointToOffset,
  readPieceTableTextRange,
} from '@singapore-editor/textbuffer'

import {
  SelectionGoal,
  lastAddedSelectionIndex,
  resolveSelection,
  selectionOffsetsWithAffinity,
  selectionRangeWithAffinity,
  type ResolvedSelection,
  type SelectionAffinity,
  type SelectionGoal as SelectionGoalValue,
  type SelectionOffsetsWithAffinity,
  type SelectionSet,
} from '../selections'
import { clamp } from '../style-utils'
import type { EditorTokenStore } from '../syntax/tokenStore'
import type { TextEdit } from '../tokens'
import type { EditorTheme } from '../theme'
import type { VirtualizedTextView } from '../virtualization/virtualizedTextView'
import type {
  EditorPasteContext,
  EditorPasteHandler,
  EditorPasteTarget,
  EditorResolvedSelection,
  EditorSelectionRange,
  EditorViewContributionUpdateKind,
} from '../plugins'
import { dataTransferTypes, pasteHandlerMatchesTypes } from './pasteHandlers'
import { readRichTextFont, richTextForCopy, type RichTextCopyFragment } from './richText'
import type { EditorSyntaxInjection, EditorSyntaxLanguageId } from '../syntax/session'
import {
  readClipboardMetadata,
  writeClipboardPayload,
  type ClipboardMetadata,
} from './clipboardMetadata'
import {
  documentSelectionEditForCommand,
  isEditorDocumentSelectionEditCommand,
  type EditorDocumentSelectionEditCommandId,
} from './reindent'
import { widenOverAtomicRanges } from '../atomicRanges'
import { childContainingNode, childNodeIndex, elementBoundaryToTextOffset } from './domBoundary'
import {
  atomicDeleteAction,
  editActionForCommand,
  listItemLineBreak,
  trimTrailingWhitespaceAction,
  type EditorDocumentLine,
  type EditorEditActionCommandId,
  type EditorEditActionOptions,
  type EditorEditActionResult,
} from './editActions'
import { capitalize, indentTimingName, type SessionChangeOptions } from './editorUtils'
import {
  EMPTY_HIDDEN_INPUT_STATE,
  deduceHiddenInputEdit,
  isEmptyDeducedInput,
  isIncompleteDeducedInput,
  keyboardFallbackText,
  pagedHiddenInputContent,
  readHiddenInputState,
  textUpdateEdit,
  type DeducedInputEdit,
  type HiddenInputContent,
  type HiddenInputState,
} from './input'
import type {
  EditorCharacterBoundsUpdateEvent,
  EditorTextUpdateEvent,
} from '../virtualization/editContext'
import {
  NO_MOUSE_SELECTION_AUTO_SCROLL,
  mouseSelectionAutoScrollDelta,
  mouseSelectionEnds,
  mouseTextMove,
  type MouseSelectionAnchor,
  type MouseSelectionAutoScrollDelta,
  type MouseSelectionDrag,
  type MouseSelectionEnds,
  type MouseSelectionGranularity,
  type MouseTextMoveDrag,
} from './mouseSelection'
import type { VirtualizedTextHitPosition } from '../virtualization/virtualizedTextViewTypes'
import {
  createNavigationLineReader,
  navigationTargetForCommand,
  renderedRowCaretOffset,
  verticalMoveGoal,
  type NavigationLine,
} from './navigationTargets'
import {
  findAllExactOccurrences,
  findNextExactOccurrenceFromRange,
  occurrenceQueryForSelection,
  occurrenceSelectTimingName,
  wordRangeAt,
  type OccurrenceQuery,
  type OccurrenceSelectionChange,
} from './occurrences'
import { wordRangeAtOffset, wordSeparatorsForLanguage, type TextOffsetRange } from '../textRanges'
import {
  bufferColumnToVisualColumn,
  visualColumnLength,
  visualColumnToBufferColumn,
} from '../displayTransforms'
import { appendTiming, eventStartMs, mergeChangeTimings, nowMs } from './timing'
import { measureEditorPerformance, traceEditorInput } from './performanceDiagnostics'
import {
  createEditorInputState,
  selectionBeforeEditSource,
  shouldCommitCompositionEnd,
  shouldSyncCustomSelectionFromDom,
  shouldSyncSessionSelectionFromDom,
  transitionEditorInputState,
  type EditorInputState,
  type EditorInputStateTransition,
} from './inputState'
import type { EditorCommandContext, EditorCommandId } from './commands'
import type { EditorSelectionSyncMode, EditorSessionOptions } from './types'
import {
  autoClosingPairForClose,
  autoClosingPairForOpen,
  autoClosingPairsForLanguage,
  shouldAutoClose,
  shouldDeletePair,
  shouldSurroundSelection,
  shouldTypeOverCloser,
  type AutoCloseContext,
} from './autoClose'
import { AutoCloseStore, characterAt, characterBefore } from './autoCloseStore'
import { editorLanguageConfiguration, type EditorAutoClosingPair } from './languageConfiguration'
import {
  LinkedEditingSession,
  linkedEditingChange,
  linkedEditingRangesAround,
  referenceRangeFor,
  type LinkedEditingRange,
} from './linkedEditing'
import {
  SnippetSession,
  type SnippetMirrorRange,
  type SnippetSessionStop,
  type SnippetStopRange,
} from './snippetSession'
import { GhostTextSession, type EditorInlineSuggestCommandId } from './ghostText'
import type { TextReadSnapshot } from '../documentTextSnapshot'
import type { InlineReplacementSpec } from '../inlineMap'

import { lineBreakIndent } from './indentation'
import type { EditorAnnouncer } from './announce'

export type InputSelectionControllerOptions = {
  readonly el: HTMLDivElement
  readonly announcer: EditorAnnouncer
  readonly selectionSyncMode: EditorSelectionSyncMode
  readonly rtlMoveVisually: boolean
  readonly nonCaretOffset: (offset: number) => boolean
  readonly tabSize: number
  /** Whether Tab is the page's key for leaving the editor rather than the editor's for indenting. */
  readonly tabMovesFocus: boolean
  /** Replaces the language's pairs; empty turns auto-close off. */
  readonly autoClosingPairs?: readonly EditorAutoClosingPair[]
  /** What typing an opener over a selection wraps it with; the auto-closing pairs when unset. */
  readonly surroundingPairs?: readonly EditorAutoClosingPair[]
  readonly view: VirtualizedTextView
  getLanguageId(): EditorSyntaxLanguageId | null
  getSyntaxInjections(): readonly EditorSyntaxInjection[]
  getSession(): DocumentSession | null
  getSessionOptions(): EditorSessionOptions
  /** Whoever may read a paste as something other than its text, best-fitting handler first. */
  getPasteHandlers(): readonly EditorPasteHandler[]
  /** The two inputs a copy needs to render the range it took as styled markup. */
  getSyntaxTokens(): EditorTokenStore
  getEditorTheme(): EditorTheme | null
  getTextSnapshot(): TextReadSnapshot
  canEditDocument(): boolean
  beginPointerJump?(): void
  finishPointerJump?(): void
  cancelPointerJump?(): void
  runInOperation<T>(run: () => T): T
  applySessionChange(
    change: DocumentSessionChange,
    totalName?: string,
    totalStart?: number,
    options?: SessionChangeOptions,
  ): void
  notifyChangeWithTiming(change: DocumentSessionChange): void
  notifyViewContributions(
    kind: EditorViewContributionUpdateKind,
    change?: DocumentSessionChange | null,
  ): void
  /**
   * The character the user typed, after the edit it caused has been applied. A contribution that
   * acts on a keystroke has to read it here: the edit cannot stand in for it. Auto-closing turns a
   * typed `(` into a two-character `()`, and typing over the closer it inserted changes no text at
   * all, so the document change neither says what was pressed nor always happens.
   */
  onDidType(text: string): void
  /** True when a contribution took the press for itself; the editor then leaves it alone. */
  claimPress(event: MouseEvent): boolean
}

// A run of occurrence presses owns its search settings, so that widening one to whole words never
// reaches the find widget's own toggles. The selection set it produced identifies it: selection
// sets are replaced wholesale, so anything the user does in between hands back a different one and
// the next press starts a fresh run from whatever is selected then.
type OccurrenceRun = {
  readonly selections: SelectionSet<PieceTableAnchor>
  readonly wholeWord: boolean
}

type OccurrenceQueryWithSources = OccurrenceQuery & {
  readonly source: ResolvedSelection
  readonly sourcesByRange: ReadonlyMap<string, ResolvedSelection>
}

/** What a copy or a cut hands to the clipboard: the text, plus how it was assembled. */
type ClipboardPayload = {
  readonly fragments: readonly RichTextCopyFragment[]
  readonly metadata: ClipboardMetadata
  readonly text: string
}

/**
 * A box selection, held as the two corners it spans rather than as the cursors it produces: the
 * cursors are derived again on every change, which is what lets the rectangle be pushed past the
 * end of a short line and pick that line up again on the way back.
 */
type ColumnSelectionRectangle = {
  // The text the columns were measured against. Any edit leaves them describing characters that
  // have since moved, so identity here is what expires the rectangle.
  readonly snapshot: PieceTableSnapshot
  readonly fromRow: number
  readonly fromColumn: number
  readonly toRow: number
  readonly toColumn: number
}

/** A rectangle the next gesture may still continue, with what the last one already worked out. */
type ColumnSelectionRun = {
  readonly rectangle: ColumnSelectionRectangle
  // The cursors the rectangle put down. Selection sets are replaced wholesale, so anything that
  // moves the caret in between hands back a different one and the abandoned box cannot resume.
  readonly selections: SelectionSet<PieceTableAnchor>
  // How far right the rectangle can go: the widest of the rows it covers, measured on the same
  // walk that placed the cursors, so holding the chord never re-reads those rows.
  readonly widestColumn: number
}

/** Any column past a row's end; `pointToOffset` clamps it back to that row's last character. */
const LINE_END_COLUMN = Number.MAX_SAFE_INTEGER

/**
 * How much text in front of the caret a backwards delete is decided from. Wide enough for the
 * longest joined sequence anyone types, so the boundary search never has to answer from a window it
 * has already run out of.
 */
const DELETE_READ_WINDOW = 64

const COLUMN_SELECTION_COMMANDS = new Set<EditorCommandId>([
  'cursorColumnSelectLeft',
  'cursorColumnSelectRight',
  'cursorColumnSelectUp',
  'cursorColumnSelectDown',
  'cursorColumnSelectPageUp',
  'cursorColumnSelectPageDown',
])

export class InputSelectionController {
  private readonly autoClose = new AutoCloseStore()
  private readonly snippet = new SnippetSession()
  private readonly ghostText = new GhostTextSession()
  private readonly linkedEditing = new LinkedEditingSession()
  private occurrenceRun: OccurrenceRun | null = null
  private mouseSelectionDrag: MouseSelectionDrag | null = null
  private mouseTextMoveDrag: MouseTextMoveDrag | null = null
  private mouseSelectionAnchor: MouseSelectionAnchor | null = null
  private columnSelection: ColumnSelectionRun | null = null
  private mouseSelectionAutoScrollFrame: ScheduledFrame | null = null
  private inputState: EditorInputState = createEditorInputState()
  private nativeInputHandlersInstalled = false
  // What the editor last wrote into the hidden input, which is the other half of every diff: an
  // input event only says the element changed, never what it changed from. Nothing but a write
  // advances it — an event the editor decides not to act on leaves the element holding text it can
  // still be diffed against next time.
  private hiddenInputContent: HiddenInputState = EMPTY_HIDDEN_INPUT_STATE
  /** What a textarea composition replaces in the written window, read when it starts. */
  private compositionRange: { readonly start: number; readonly end: number } | null = null
  /** The window range an EditContext composition replaces, and where its candidate now ends. */
  private editContextComposition: {
    readonly rangeStart: number
    readonly rangeEnd: number
    readonly spanEnd: number
  } | null = null

  constructor(private readonly options: InputSelectionControllerOptions) {}

  private traceInput<TEvent, TResult>(
    name: string,
    run: (event: TEvent) => TResult,
  ): (event: TEvent) => TResult {
    return traceEditorInput(name, (event) => this.options.runInOperation(() => run(event)))
  }

  install(): void {
    const { el } = this.options
    el.addEventListener('mousedown', this.handleMouseDown)
    el.addEventListener('beforeinput', this.handleBeforeInput)
    el.addEventListener('copy', this.handleCopy)
    el.addEventListener('cut', this.handleCut)
    el.addEventListener('dragover', this.handleDragOver)
    el.addEventListener('dragleave', this.handleDragLeave)
    el.addEventListener('drop', this.handleDrop)
    el.addEventListener('paste', this.handlePaste)
    el.addEventListener('keydown', this.holdKeyForComposition, { capture: true })
    el.addEventListener('keydown', this.handleKeyDown)
    el.addEventListener('compositionstart', this.handleCompositionStart)
    el.addEventListener('compositionupdate', this.handleCompositionUpdate)
    el.addEventListener('compositionend', this.handleCompositionEnd)
    el.addEventListener('keyup', this.syncSessionSelectionFromDom)
    el.addEventListener('mouseup', this.syncSessionSelectionFromDom)
    el.ownerDocument.addEventListener('selectionchange', this.syncCustomSelectionFromDom)
  }

  dispose(): void {
    const { el } = this.options
    this.uninstallNativeInputHandlers()
    el.removeEventListener('mousedown', this.handleMouseDown)
    el.removeEventListener('beforeinput', this.handleBeforeInput)
    el.removeEventListener('copy', this.handleCopy)
    el.removeEventListener('cut', this.handleCut)
    el.removeEventListener('dragover', this.handleDragOver)
    el.removeEventListener('dragleave', this.handleDragLeave)
    el.removeEventListener('drop', this.handleDrop)
    el.removeEventListener('paste', this.handlePaste)
    el.removeEventListener('keydown', this.holdKeyForComposition, { capture: true })
    el.removeEventListener('keydown', this.handleKeyDown)
    el.removeEventListener('compositionstart', this.handleCompositionStart)
    el.removeEventListener('compositionupdate', this.handleCompositionUpdate)
    el.removeEventListener('compositionend', this.handleCompositionEnd)
    el.removeEventListener('keyup', this.syncSessionSelectionFromDom)
    el.removeEventListener('mouseup', this.syncSessionSelectionFromDom)
    el.ownerDocument.removeEventListener('selectionchange', this.syncCustomSelectionFromDom)
    this.stopMouseSelectionDrag()
    this.stopMouseTextMoveDrag()
  }

  syncNativeInputHandlers(editable: boolean): void {
    if (editable) {
      this.installNativeInputHandlers()
      return
    }

    this.uninstallNativeInputHandlers()
  }

  applyHistoryCommand(command: 'undo' | 'redo', context: EditorCommandContext): boolean {
    const session = this.session
    if (!session) return false
    if (!this.options.canEditDocument()) return false

    const start = context.event ? eventStartMs(context.event) : nowMs()
    const change = command === 'undo' ? session.undo() : session.redo()
    if (change.kind !== 'none' && change.kind !== 'synchronize') {
      this.markSessionSelectionForNextInput()
    }
    this.applyChange(change, command === 'undo' ? 'input.undo' : 'input.redo', start)
    return true
  }

  /**
   * Typing path for a single plain character, with auto-closing pairs applied.
   *
   * Wrapping takes every selection at once; auto-closing takes a single collapsed caret, and several
   * carets fall through to plain insertion.
   */
  /** Set by {@link applyTypedText}, delivered by {@link applyChange} once the edit has landed. */
  private pendingTypedText: string | null = null

  private applyTypedText(session: DocumentSession, text: string): DocumentSessionChange {
    this.pendingTypedText = text
    // The keydown fallback turns Enter into '\n', so it arrives here rather than as a
    // beforeinput line break; both routes must indent identically.
    if (text === '\n') return this.applyLineBreak(session, text)

    const mirrored = this.mirrorTypedText(session, text)
    if (mirrored) return mirrored

    const decided = this.autoCloseChange(session, text)
    if (decided) return decided

    const change = session.applyText(text)
    // Plain typing keeps tracked pairs alive; their anchors have already shifted with the edit.
    this.autoClose.advance(change.snapshot)
    return change
  }

  /**
   * The one door an edit knocks on before it is written straight through the session.
   *
   * Everything a mirror is depends on the edit that moves it being the batch that rebuilds it: a
   * stop's copies are anchored on the very text a replacement takes away, and a tag pair that hears
   * only half of a rename no longer scans as a pair, so it can never re-link either. An edit written
   * without the batch does not fail — it leaves both untracked for the rest of the session, and
   * every keystroke after it goes unmirrored. So typing, deleting, cutting, pasting, dropping and a
   * suggestion being accepted all come through here rather than each remembering the rule.
   *
   * Null for an edit that is not one of those: several cursors, an edit reaching outside the stop or
   * the name, a language in which nothing is mirrored — all of which then edit as usual.
   */
  private mirroredEdit(
    session: DocumentSession,
    from: number,
    to: number,
    text: string,
  ): DocumentSessionChange | null {
    // One cursor, because a mirror is written somewhere the reader is not looking: with several of
    // them there is no one range whose text the copies are supposed to be reading.
    const source = this.singleSelection(session, session.getSnapshot())
    if (!source) return null

    return (
      this.mirrorSnippetEdit(session, source, from, to, text) ??
      this.mirrorNameEdit(session, source, from, to, text)
    )
  }

  /** Typed text carried into the ranges holding what the range it lands in holds. */
  private mirrorTypedText(session: DocumentSession, text: string): DocumentSessionChange | null {
    if (text.length === 0) return null

    const target = this.singleSelection(session, session.getSnapshot())
    if (!target) return null

    return this.mirroredEdit(session, target.startOffset, target.endOffset, text)
  }

  /** The same, for a key or a gesture that removes exactly what is selected. */
  private mirrorSelectionDelete(session: DocumentSession): DocumentSessionChange | null {
    const target = this.singleSelection(session, session.getSnapshot())
    if (!target || target.collapsed) return null

    return this.mirroredEdit(session, target.startOffset, target.endOffset, '')
  }

  /**
   * The same again for Backspace, which is the one delete that has to look behind itself: a
   * collapsed caret names no text, and what it takes is the character in front of it.
   */
  private mirrorBackspaceDelete(session: DocumentSession): DocumentSessionChange | null {
    const snapshot = session.getSnapshot()
    const target = this.singleSelection(session, snapshot)
    if (!target) return null
    if (!target.collapsed) return this.mirrorSelectionDelete(session)

    const start = this.deleteStartBefore(snapshot, target.startOffset)
    if (start === null) return null

    return this.mirroredEdit(session, start, target.startOffset, '')
  }

  /** The one selection an edit that rewrites text elsewhere can reason about, resolved. */
  private singleSelection(
    session: DocumentSession,
    snapshot: PieceTableSnapshot,
  ): ResolvedSelection | null {
    const selections = session.getSelections().selections
    if (selections.length !== 1) return null

    const only = selections[0]
    if (!only) return null

    return resolveSelection(snapshot, only)
  }

  /**
   * Where the character a backspace at `offset` eats begins, or null when there is none.
   *
   * Asked of the boundary a delete stops at rather than the one the caret moves over, because this
   * is what the copies are made to match: a mirrored press that took a whole family emoji where the
   * unmirrored one takes a single member would leave the two reading differently after one press.
   * The window is read whole so the search has room to widen — handed only the few code units it
   * expects to need, it reports the truncated head of a cluster as a boundary of its own.
   */
  private deleteStartBefore(snapshot: PieceTableSnapshot, offset: number): number | null {
    if (offset === 0) return null

    const from = Math.max(0, offset - DELETE_READ_WINDOW)
    const text = readPieceTableTextRange(snapshot, from, offset)
    return from + previousDeleteBoundary(text, text.length)
  }

  /**
   * One batch that writes `text` over `[start, end)` and rewrites every copy of the active stop from
   * the text the stop is left holding, or null for an edit that is not the stop being filled in.
   *
   * A stop written twice is one value shown twice, so the copies have to read the same while the
   * word is being typed rather than once the caret leaves: text that is plainly wrong for as long
   * as it takes to type a name is the thing a reader notices. Batched for the reason a rename is:
   * the copies are not something the reader typed, so the keystroke that caused them has to be the
   * one that takes them back.
   */
  private mirrorSnippetEdit(
    session: DocumentSession,
    source: ResolvedSelection,
    start: number,
    end: number,
    text: string,
  ): DocumentSessionChange | null {
    const snapshot = session.getSnapshot()
    const stop = this.snippet.activeStop(snapshot)
    if (!stop || stop.mirrors.length === 0) return null

    // Only an edit the stop wholly contains is the stop's own text changing. One that reaches past
    // either end is the reader editing the document around the snippet, and copying that would put
    // text they never typed into the stop's copies.
    if (start < stop.range.start || end > stop.range.end) return null

    const read = (from: number, to: number) => readPieceTableTextRange(snapshot, from, to)
    const current = rangeText(read, stop.range)
    const value =
      current.slice(0, start - stop.range.start) + text + current.slice(end - stop.range.start)

    const rewrites = stop.mirrors.map((mirror) => {
      const rendered = mirror.transform ? mirror.transform(value) : value
      return { mirror, rendered, rewritten: rendered !== rangeText(read, mirror) }
    })
    // Nothing but the keystroke itself: every copy already reads the way this one will, so the
    // ordinary typing path is both shorter and better at coalescing undo. That holds only while the
    // stop outlives the keystroke, though: the stop is anchored on the characters at either end of
    // it, and an edit that takes one of them out leaves the copies untracked for the rest of the
    // session. Those go through the batch, which rewrites nothing but re-anchors.
    const survives = start === end || (start > stop.range.start && end < stop.range.end)
    if (survives && !rewrites.some((rewrite) => rewrite.rewritten)) return null

    /** What the copies before `offset` add or remove between them; a copy never moves itself. */
    const shift = (offset: number, self: number): number =>
      rewrites.reduce(
        (total, rewrite, index) =>
          index === self || !rewrite.rewritten || rewrite.mirror.end > offset
            ? total
            : total + rewrite.rendered.length - (rewrite.mirror.end - rewrite.mirror.start),
        0,
      )

    const grew = text.length - (end - start)
    const edits: TextEdit[] = [{ from: start, text, to: end }]
    const mirrors: SnippetMirrorRange[] = []
    for (const [index, rewrite] of rewrites.entries()) {
      const { mirror, rendered } = rewrite
      if (rewrite.rewritten) edits.push({ from: mirror.start, text: rendered, to: mirror.end })

      // A copy after the stop moves by what the keystroke itself added or removed; one before it
      // does not, and either moves by whatever the copies before it did.
      const at =
        mirror.start + shift(mirror.start, index) + (mirror.start >= stop.range.end ? grew : 0)
      mirrors.push(
        mirror.transform
          ? { end: at + rendered.length, start: at, transform: mirror.transform }
          : { end: at + rendered.length, start: at },
      )
    }

    const moved = stop.range.start + shift(stop.range.start, -1)
    // A copy ahead of the caret leaves it where it was; one behind moves the whole document under
    // it, and the caret is handed back in the coordinates the batch produces.
    const caret = start + text.length + shift(start, -1)
    const change = session.applyEdits(edits, {
      selections: [selectionOffsetsWithAffinity(source, caret, caret)],
    })
    this.snippet.reanchor(change.snapshot, {
      mirrors,
      range: { end: moved + value.length, start: moved },
    })
    this.linkedEditing.advance(change.snapshot)
    this.autoClose.advance(change.snapshot)
    this.markSessionSelectionForNextInput()
    return change
  }

  private mirrorNameEdit(
    session: DocumentSession,
    source: ResolvedSelection,
    start: number,
    end: number,
    text: string,
  ): DocumentSessionChange | null {
    const wordPattern = editorLanguageConfiguration(this.options.getLanguageId())?.wordPattern
    if (!wordPattern) return null

    const snapshot = session.getSnapshot()
    const read = (from: number, to: number) => readPieceTableTextRange(snapshot, from, to)
    const ranges = this.linkedEditingRanges(snapshot, read, start, end)
    if (!ranges) return null

    const reference = referenceRangeFor(ranges, start, end)
    if (!reference) return null

    const mirrored = linkedEditingChange({
      end,
      ranges,
      read,
      reference,
      start,
      text,
      wordPattern,
    })
    if (!mirrored) {
      this.linkedEditing.clear()
      return null
    }
    // Nothing but the keystroke itself: the other ranges already read the way this one will, so the
    // ordinary typing path is both shorter and better at coalescing undo.
    if (mirrored.edits.length === 1) return null

    const change = session.applyEdits(mirrored.edits, {
      selections: [
        selectionOffsetsWithAffinity(source, mirrored.caretOffset, mirrored.caretOffset),
      ],
    })
    this.linkedEditing.advance(change.snapshot)
    this.autoClose.advance(change.snapshot)
    this.markSessionSelectionForNextInput()
    return change
  }

  /**
   * The ranges a rename is running over: the tracked ones while the edit still falls inside one of
   * them, and otherwise whatever a scan of the text around it turns up.
   */
  private linkedEditingRanges(
    snapshot: PieceTableSnapshot,
    read: (from: number, to: number) => string,
    start: number,
    end: number,
  ): readonly LinkedEditingRange[] | null {
    const tracked = this.linkedEditing.ranges(snapshot)
    if (tracked && referenceRangeFor(tracked, start, end)) return tracked

    this.linkedEditing.clear()
    const scanned = linkedEditingRangesAround(read, snapshot.length, start)
    if (!scanned) return null

    this.linkedEditing.start(snapshot, scanned)
    return scanned
  }

  /**
   * Line break with indentation continued from the current line.
   *
   * Falls back to a plain newline for anything but a single collapsed caret, for the same reason
   * auto-close does: a batch would need one edit per caret.
   */
  private applyLineBreak(session: DocumentSession, text: string): DocumentSessionChange {
    if (text !== '\n') return session.applyText(text)

    const snapshot = session.getSnapshot()
    const source = this.singleSelection(session, snapshot)
    if (!source?.collapsed) return session.applyText(text)

    const caret = source.headOffset

    const point = offsetToPoint(snapshot, caret)
    // A list item's marker is a construct the indentation rules cannot see: they read the whitespace
    // in front of the caret, and the marker is text.
    const listBreak = listItemLineBreak({
      caretOffset: caret,
      caretRow: point.row,
      languageId: this.options.getLanguageId(),
      readLine: (row) => this.documentLine(snapshot, row),
    })
    if (listBreak) {
      return this.applyLineBreakEdits(session, source, listBreak.edits, listBreak.caretOffset)
    }

    const indent = lineBreakIndent({
      languageId: this.options.getLanguageId(),
      lineTextAfterCaret: readPieceTableTextRange(
        snapshot,
        caret,
        pointToOffset(snapshot, { row: point.row, column: LINE_END_COLUMN }),
      ),
      lineTextBeforeCaret: this.lineTextBeforeCaret(snapshot, caret),
      previousLineText: point.row === 0 ? null : this.lineText(snapshot, point.row - 1),
      tabSize: this.options.tabSize,
    })

    return this.applyLineBreakEdits(
      session,
      source,
      [{ from: caret, text: indent.insert + indent.trailing, to: caret }],
      caret + indent.insert.length,
    )
  }

  /** Commits a line break's edits, leaving the caret where the break decided it belongs. */
  private applyLineBreakEdits(
    session: DocumentSession,
    source: ResolvedSelection,
    edits: readonly TextEdit[],
    caretOffset: number,
  ): DocumentSessionChange {
    const change = session.applyEdits(edits, {
      selections: [selectionOffsetsWithAffinity(source, caretOffset, caretOffset)],
    })
    // The pair the caret was inside has been split across lines; its closer is no longer adjacent.
    this.autoClose.clear()
    this.markSessionSelectionForNextInput()
    return change
  }

  /** One row's text with the offset it starts at, or null past the last row. */
  private documentLine(snapshot: PieceTableSnapshot, row: number): EditorDocumentLine | null {
    if (row < 0 || row > offsetToPoint(snapshot, snapshot.length).row) return null

    return {
      start: pointToOffset(snapshot, { row, column: 0 }),
      text: this.lineText(snapshot, row),
    }
  }

  /** Current line's text up to the caret, read without materializing the document. */
  private lineTextBeforeCaret(snapshot: PieceTableSnapshot, caret: number): string {
    const point = offsetToPoint(snapshot, caret)
    if (point.column === 0) return ''

    return readPieceTableTextRange(snapshot, caret - point.column, caret)
  }

  /** One whole row's text, read without materializing the document. */
  private lineText(snapshot: PieceTableSnapshot, row: number): string {
    const start = pointToOffset(snapshot, { row, column: 0 })
    const end = pointToOffset(snapshot, { row, column: LINE_END_COLUMN })

    return start >= end ? '' : readPieceTableTextRange(snapshot, start, end)
  }

  /** The auto-close variant of a keystroke, or null when the keystroke is ordinary. */
  private autoCloseChange(session: DocumentSession, text: string): DocumentSessionChange | null {
    if (text.length !== 1) return null

    const surrounded = this.surroundSelection(session, text)
    if (surrounded) return surrounded

    const snapshot = session.getSnapshot()
    const source = this.singleSelection(session, snapshot)
    if (!source?.collapsed) return null

    const caret = source.headOffset

    const pairs = this.autoClosingPairs()
    const closing = autoClosingPairForClose(pairs, text)
    if (
      closing &&
      shouldTypeOverCloser({
        charAfter: characterAt(snapshot, caret),
        close: closing.close,
        trackedAtCaret: this.autoClose.hasCloserAt(snapshot, caret, closing.close),
      })
    ) {
      return this.typeOverCloser(session, snapshot, caret)
    }

    const opening = autoClosingPairForOpen(pairs, text)
    if (!opening) return null
    if (!shouldAutoClose(opening, this.autoCloseContext(snapshot, caret))) return null

    // One edit, not two: the renderer only takes its incremental path for a single-edit change.
    const change = session.applyEdits(
      [{ from: caret, text: opening.open + opening.close, to: caret }],
      {
        selections: [
          selectionOffsetsWithAffinity(
            source,
            caret + opening.open.length,
            caret + opening.open.length,
          ),
        ],
      },
    )
    this.autoClose.track(change.snapshot, caret + opening.open.length, opening.close)
    this.markSessionSelectionForNextInput()
    return change
  }

  private autoClosingPairs(): readonly EditorAutoClosingPair[] {
    return (
      this.options.autoClosingPairs ?? autoClosingPairsForLanguage(this.options.getLanguageId())
    )
  }

  /** The line the caret stands on, split at the caret, read without materializing the document. */
  private autoCloseContext(snapshot: PieceTableSnapshot, caret: number): AutoCloseContext {
    const point = offsetToPoint(snapshot, caret)
    const lineEnd = pointToOffset(snapshot, { row: point.row, column: LINE_END_COLUMN })

    return {
      languageId: this.options.getLanguageId(),
      textAfter: caret >= lineEnd ? '' : readPieceTableTextRange(snapshot, caret, lineEnd),
      textBefore:
        point.column === 0 ? '' : readPieceTableTextRange(snapshot, caret - point.column, caret),
    }
  }

  /** Steps the caret over a closer this editor inserted, without touching the text. */
  private typeOverCloser(
    session: DocumentSession,
    snapshot: PieceTableSnapshot,
    caret: number,
  ): DocumentSessionChange {
    this.autoClose.forget(snapshot, caret)
    const change = session.setSelection(caret + 1, caret + 1, { affinity: 'before' })
    this.autoClose.advance(change.snapshot)
    this.markSessionSelectionForNextInput()
    return change
  }

  /** Backspace between the halves of a pair this editor inserted removes both, or null. */
  private deleteAutoClosedPair(session: DocumentSession): DocumentSessionChange | null {
    const snapshot = session.getSnapshot()
    const source = this.singleSelection(session, snapshot)
    if (!source?.collapsed) return null

    const caret = source.headOffset

    const charBefore = characterBefore(snapshot, caret)
    const pair =
      charBefore === null ? null : autoClosingPairForOpen(this.autoClosingPairs(), charBefore)
    if (
      !shouldDeletePair({
        charAfter: characterAt(snapshot, caret),
        charBefore,
        pair,
        trackedAtCaret: this.autoClose.hasCloserAt(snapshot, caret, pair?.close ?? ''),
      })
    ) {
      return null
    }

    this.autoClose.forget(snapshot, caret)
    const change = session.applyEdits([{ from: caret - 1, text: '', to: caret + 1 }], {
      selections: [selectionOffsetsWithAffinity(source, caret - 1, caret - 1)],
    })
    this.autoClose.advance(change.snapshot)
    this.markSessionSelectionForNextInput()
    return change
  }

  /**
   * Typing an opener over non-empty selections wraps each of them instead of replacing them.
   *
   * One batch, so several cursors wrapping is one undo step and one change for the view. Either every
   * selection is wrapped or none is: a keystroke that wrapped one cursor and replaced the text under
   * another would destroy text the user cannot see the reason for.
   */
  private surroundSelection(session: DocumentSession, text: string): DocumentSessionChange | null {
    const languageId = this.options.getLanguageId()
    const opening = autoClosingPairForOpen(
      this.options.surroundingPairs ?? this.autoClosingPairs(),
      text,
    )
    if (!opening) return null

    const snapshot = session.getSnapshot()
    const selections = session
      .getSelections()
      .selections.map((selection) => resolveSelection(snapshot, selection))
      .toSorted((left, right) => left.startOffset - right.startOffset)
    if (selections.length === 0) return null

    const wraps = selections.every((selection) => {
      if (selection.collapsed) return false

      return shouldSurroundSelection(opening, {
        languageId,
        selectedText: readPieceTableTextRange(snapshot, selection.startOffset, selection.endOffset),
      })
    })
    if (!wraps) return null

    const change = session.applyEdits(this.surroundEdits(selections, opening), {
      selections: selections.map((selection, index) =>
        surroundedSelection(selection, opening, index),
      ),
    })
    // The closers here are deliberate, not speculative auto-inserts: nothing to type over.
    this.autoClose.clear()
    this.markSessionSelectionForNextInput()
    return change
  }

  /**
   * The insertions that wrap each selection, in document order.
   *
   * Two selections that meet at an offset put a closer and an opener in the same place, and two
   * zero-width edits at one offset have no order between them — so they are handed over as the one
   * insertion they are, which is also the only spelling that says which of them comes first.
   */
  private surroundEdits(
    selections: readonly ResolvedSelection[],
    opening: EditorAutoClosingPair,
  ): readonly TextEdit[] {
    const edits: TextEdit[] = []

    for (const selection of selections) {
      for (const insertion of [
        { offset: selection.startOffset, text: opening.open },
        { offset: selection.endOffset, text: opening.close },
      ]) {
        const previous = edits.at(-1)
        if (previous && previous.from === insertion.offset) {
          edits[edits.length - 1] = { ...previous, text: previous.text + insertion.text }
          continue
        }

        edits.push({ from: insertion.offset, text: insertion.text, to: insertion.offset })
      }
    }

    return edits
  }

  /** Begins tab-stop navigation for a snippet that was just inserted. */
  startSnippetSession(stops: readonly SnippetSessionStop[]): void {
    const session = this.session
    if (!session) return

    this.snippet.start(session.getSnapshot(), stops)
  }

  /** Moves to the next or previous snippet stop, or reports that no session owns the key. */
  private moveSnippetStop(session: DocumentSession, direction: 1 | -1): boolean {
    if (!this.snippet.active) return false

    const affinity = this.primaryResolvedSelection()?.affinity ?? 'after'
    const range = this.snippet.move(session.getSnapshot(), direction)
    if (!range) return false

    const change = session.setSelection(range.start, range.end, { affinity })
    this.autoClose.advance(change.snapshot)
    this.markSessionSelectionForNextInput()
    this.applyChange(change, 'input.snippetStop')
    return true
  }

  /**
   * Offers an inline suggestion, drawn as the text the document does not already hold; null takes
   * back whatever is showing.
   *
   * Only a single collapsed caret is offered one. With a selection, or with several carets, there is
   * no one place the suggestion would be typed, so nothing about it could be drawn honestly — and a
   * document nobody may write to is offered none at all, rather than text no key of theirs can take.
   */
  setInlineSuggestion(edit: TextEdit | null): boolean {
    const session = this.session
    const snapshot = session?.getSnapshot()
    const caret = session && snapshot ? this.collapsedCaretOffset(session, snapshot) : null
    if (!session || !snapshot || !edit || caret === null || !this.options.canEditDocument()) {
      this.ghostText.clear()
      return false
    }

    return this.ghostText.show(snapshot, session.getTextSnapshot(), edit, caret)
  }

  /** The runs painting the suggestion that is showing, for the map the view renders from. */
  inlineSuggestionSpecs(): readonly InlineReplacementSpec[] {
    const snapshot = this.session?.getSnapshot()

    return snapshot ? this.ghostText.specs(snapshot, this.inlineSuggestionCaret(snapshot)) : []
  }

  /** Whether the suggestion on screen has to be rebuilt after a change reached the document. */
  syncInlineSuggestion(snapshot: PieceTableSnapshot): boolean {
    return this.ghostText.needsRepaint(snapshot, this.inlineSuggestionCaret(snapshot))
  }

  /** Where a suggestion may stand, which is the same place one may be offered from. */
  private inlineSuggestionCaret(snapshot: PieceTableSnapshot): number | null {
    const session = this.session

    return session ? this.collapsedCaretOffset(session, snapshot) : null
  }

  applyInlineSuggestCommand(
    command: EditorInlineSuggestCommandId,
    context: EditorCommandContext,
  ): boolean {
    const session = this.session
    if (!session) return false
    if (!this.options.canEditDocument()) return false

    return this.acceptInlineSuggestion(
      session,
      context,
      command === 'editor.action.inlineSuggest.commit' ? 'all' : 'word',
    )
  }

  /**
   * Writes what is on offer into the document, whole or a word of it, or reports that nothing is.
   *
   * The sessions around it are carried across the edit rather than ended by it: taking a suggestion
   * is not the reader leaving the snippet they are filling in, nor typing over a closer this editor
   * put down. What is left of the suggestion is offered again from the text the accepted part
   * produced, so the next press reads the document instead of a plan made before the edit.
   */
  private acceptInlineSuggestion(
    session: DocumentSession,
    context: EditorCommandContext,
    scope: 'all' | 'word',
  ): boolean {
    const snapshot = session.getSnapshot()
    const source = this.singleSelection(session, snapshot)
    if (!source?.collapsed) return false

    const shownAt = this.inlineSuggestionCaret(snapshot)
    const accepted =
      scope === 'all'
        ? this.ghostText.accept(snapshot, shownAt)
        : this.ghostText.acceptNextWord(
            snapshot,
            shownAt,
            wordSeparatorsForLanguage(this.options.getLanguageId()),
          )
    if (!accepted) return false

    const start = context.event ? eventStartMs(context.event) : nowMs()
    const selectionChange = this.selectionChangeBeforeEdit()
    const { edit } = accepted
    // The suggestion is reduced to what the document does not already say, so an accept inside a
    // placeholder or a tag name lands as a range edit reaching to the end of it rather than as the
    // whole name — which is still that name changing, and still has to carry its copies with it.
    const mirrored = this.mirroredEdit(session, edit.from, edit.to, edit.text)
    const acceptedCaret = edit.from + edit.text.length
    const change =
      mirrored ??
      session.applyEdits([edit], {
        selections: [selectionOffsetsWithAffinity(source, acceptedCaret, acceptedCaret)],
      })
    if (!mirrored) this.autoClose.advance(change.snapshot)
    // Read back off the batch, which may have moved the whole document under the caret by rewriting
    // a copy that sits above it.
    const caret = this.primarySelectionHeadOffset(change) ?? acceptedCaret
    if (accepted.rest) {
      this.ghostText.show(change.snapshot, change.textSnapshot, accepted.rest, caret)
    }
    this.markSessionSelectionForNextInput()
    this.applyChange(
      mergeChangeTimings(change, selectionChange),
      scope === 'all' ? 'input.inlineSuggestCommit' : 'input.inlineSuggestWord',
      start,
      { revealOffset: caret },
    )
    return true
  }

  /** The single collapsed caret offset, or null when there is a selection or several carets. */
  private collapsedCaretOffset(
    session: DocumentSession,
    snapshot: PieceTableSnapshot,
  ): number | null {
    const selections = session.getSelections().selections
    if (selections.length !== 1) return null

    const only = selections[0]
    if (!only) return null

    const resolved = resolveSelection(snapshot, only)
    if (resolved.startOffset !== resolved.endOffset) return null

    return resolved.headOffset
  }

  applyDeleteCommand(direction: 'backward' | 'forward', context: EditorCommandContext): boolean {
    const session = this.session
    if (!session) return false
    if (!this.options.canEditDocument()) return false

    const start = context.event ? eventStartMs(context.event) : nowMs()
    const selectionChange = this.selectionChangeBeforeEdit()
    const change =
      this.atomicDelete(session, direction) ??
      (direction === 'backward'
        ? (this.deleteAutoClosedPair(session) ??
          this.mirrorBackspaceDelete(session) ??
          session.backspace(this.options.tabSize))
        : (this.mirrorSelectionDelete(session) ?? session.deleteSelection()))
    this.applyChange(
      mergeChangeTimings(change, selectionChange),
      direction === 'backward' ? 'input.backspace' : 'input.delete',
      start,
    )
    return true
  }

  /** A delete that meets an atomic replacement takes all of it, or null to delete as usual. */
  private atomicDelete(
    session: DocumentSession,
    direction: 'backward' | 'forward',
  ): DocumentSessionChange | null {
    const atomic = this.options.view.atomicRanges()
    if (atomic.length === 0) return null

    const snapshot = session.getSnapshot()
    const selections = session
      .getSelections()
      .selections.map((selection) => resolveSelection(snapshot, selection))
    const action = atomicDeleteAction(session.getTextSnapshot(), selections, direction, atomic)
    if (!action) return null
    return session.applyEdits(action.edits, { selections: action.selections })
  }

  applyIndentCommand(direction: 'indent' | 'outdent', context: EditorCommandContext): boolean {
    // Ahead of the suggestion and the snippet below, and of the document being editable at all:
    // once the reader has asked for the key back, nothing the editor happens to be in the middle of
    // may keep it — a state that outranked this is a state they cannot get out of. Refusing the
    // command rather than consuming it is the whole mechanism: an unhandled key is not
    // default-prevented, and the browser moves focus with it exactly as it would anywhere else.
    if (this.options.tabMovesFocus) return false

    const session = this.session
    if (!session) return false
    if (!this.options.canEditDocument()) return false

    // What is drawn at the caret is what Tab takes, ahead of everything else the key means. A
    // suggestion is gone the moment anything else happens, where the stops of a snippet around it are
    // still there to cycle through afterwards — so this order costs the reader nothing and the
    // opposite one costs them the suggestion. Only forwards: shift is how a snippet is walked back,
    // and there is no backwards through text that has not been written yet.
    if (direction === 'indent' && this.acceptInlineSuggestion(session, context, 'all')) return true

    // Tab belongs to an active snippet next: cycling its stops is what the key means while one is
    // being filled in, and indenting there would push the placeholder around instead.
    if (this.moveSnippetStop(session, direction === 'indent' ? 1 : -1)) return true

    const start = context.event ? eventStartMs(context.event) : nowMs()
    const selectionChange = this.selectionChangeBeforeEdit()
    const change =
      direction === 'indent'
        ? this.applyIndentToSession()
        : session.outdentSelection(this.options.tabSize)
    const merged = mergeChangeTimings(change, selectionChange)
    this.applyChange(merged, indentTimingName(direction), start, {
      revealOffset: this.primarySelectionHeadOffset(merged),
    })
    return true
  }

  applyEditActionCommand(
    command: EditorEditActionCommandId | EditorDocumentSelectionEditCommandId,
    context: EditorCommandContext,
  ): boolean {
    const session = this.session
    if (!session) return false
    if (!this.options.canEditDocument()) return false

    const start = context.event ? eventStartMs(context.event) : nowMs()
    const selectionChange = this.selectionChangeBeforeEdit()
    const snapshot = session.getSnapshot()
    const selections = session
      .getSelections()
      .selections.map((selection) => resolveSelection(snapshot, selection))
    const action = editActionForSession(command, session, selections, {
      injections: this.options.getSyntaxInjections(),
      languageId: this.options.getLanguageId(),
      tabSize: this.options.tabSize,
      atomicRanges: this.options.view.atomicRanges(),
    })
    const change = session.applyEdits(action.edits, {
      selections: action.selections,
    })
    this.applyChange(mergeChangeTimings(change, selectionChange), action.timingName, start, {
      revealOffset: action.revealOffset,
    })
    return true
  }

  applySelectAllCommand(context: EditorCommandContext): boolean {
    const session = this.session
    if (!session) return false

    const start = context.event ? eventStartMs(context.event) : nowMs()
    const change = session.setSelection(0, session.getSnapshot().length, { affinity: 'after' })
    this.syncCustomSelectionHighlight(0, session.getSnapshot().length, 'after')
    this.markSessionSelectionForNextInput()
    this.applyChange(change, 'input.selectAll', start, { syncDomSelection: false })
    return true
  }

  applyClearSecondarySelections(context: EditorCommandContext): boolean {
    const session = this.session
    if (!session) return false

    const resolved = this.resolvedSelections()
    if (resolved.length <= 1) return false

    // Dropping the extras leaves the user at the cursor they last reached for — the one the editor
    // scrolled to when it was added. Keeping whichever cursor sorts first instead would throw the
    // caret to the top of the run they just built.
    const kept = resolved[lastAddedSelectionIndex(session.getSelections())] ?? resolved[0]
    if (!kept) return false

    const start = context.event ? eventStartMs(context.event) : nowMs()
    const change = session.setSelections([
      {
        ...selectionOffsetsWithAffinity(kept, kept.anchorOffset, kept.headOffset),
        goal: kept.goal,
      },
    ])
    this.syncSessionSelectionHighlight()
    this.markSessionSelectionForNextInput()
    this.applyChange(change, 'input.clearSecondarySelections', start, {
      revealOffset: kept.headOffset,
      syncDomSelection: false,
    })
    return true
  }

  applyInsertCursorCommand(direction: 'above' | 'below', context: EditorCommandContext): boolean {
    const session = this.session
    if (!session) return false

    const resolved = this.resolvedSelections()
    const rowDelta = direction === 'above' ? -1 : 1
    const inserted = resolved
      .map((selection) => this.cursorSelectionByDisplayRows(selection, rowDelta))
      .filter(
        (selection) =>
          selection.anchor !== selection.sourceHead ||
          selection.affinity !== selection.sourceAffinity,
      )
    const firstInserted = inserted[0]
    if (!firstInserted) return false

    const selections = resolved
      .map((selection) => ({
        anchor: selection.anchorOffset,
        affinity: selection.affinity,
        head: selection.headOffset,
        goal: selection.goal,
      }))
      .concat(
        inserted.map((selection) => ({
          anchor: selection.anchor,
          affinity: selection.affinity,
          head: selection.anchor,
          goal: selection.goal,
        })),
      )
    const start = context.event ? eventStartMs(context.event) : nowMs()
    const change = session.setSelections(selections)
    this.syncSessionSelectionHighlight()
    this.markSessionSelectionForNextInput()
    this.options.view.revealCaret(firstInserted.anchor, firstInserted.affinity)
    this.applyChange(change, `input.insertCursor${capitalize(direction)}`, start, {
      syncDomSelection: false,
    })
    // Counted off the session after the change rather than off the cursors the press asked for, the
    // way the occurrence keys are: a cursor a neighbour already reaches is merged away on the way
    // in, so the request overcounts — and a press whose every cursor was absorbed changed nothing
    // at all, which is a sentence the reader should not hear.
    const before = new Set(resolved.map(selectionKey))
    const settled = this.resolvedSelections()
    const added = settled.filter((selection) => !before.has(selectionKey(selection)))
    const landed = added[0]
    if (!landed) return true

    // Where it landed, not only that it landed: one press puts a cursor on a row that may be off
    // screen, and a count on its own leaves the reader to go looking for it with the arrow keys.
    const point = offsetToPoint(session.getSnapshot(), landed.headOffset)
    this.options.announcer.status(
      added.length === 1
        ? `Cursor added at line ${point.row + 1}, column ${point.column + 1}`
        : `${added.length} cursors added, ${settled.length} in total`,
    )
    return true
  }

  applySelectExactOccurrencesCommand(
    command: 'editor.action.selectHighlights' | 'editor.action.changeAll',
    context: EditorCommandContext,
  ): boolean {
    const session = this.session
    if (!session) return false

    const snapshot = session.getTextSnapshot()
    const query = this.occurrenceQueryForCurrentSelection(snapshot)
    if (!query) return false

    const ranges = findAllExactOccurrences(snapshot, query.query)
    if (ranges.length === 0) return false

    const selections = ranges.map((range) => occurrenceSelectionForRange(query, range))
    const primary = occurrenceSelectionForRange(query, query.range)
    const start = context.event ? eventStartMs(context.event) : nowMs()
    const change = session.setSelections(selections)
    this.syncSessionSelectionHighlight()
    this.markSessionSelectionForNextInput()
    this.applyChange(change, occurrenceSelectTimingName(command), start, {
      revealAffinity: survivingPrimarySelectionAffinity(change, primary, primary.head),
      revealOffset: primary.head,
      syncDomSelection: false,
    })
    this.announceOccurrenceSelection(ranges.length)
    return true
  }

  applyMoveSelectionToNextOccurrenceCommand(context: EditorCommandContext): boolean {
    const session = this.session
    if (!session) return false

    const snapshot = session.getTextSnapshot()
    const selectionSet = session.getSelections()
    const resolved = this.resolvedSelections()
    const preferredIndex = lastAddedSelectionIndex(selectionSet)
    const sourceIndex = resolved[preferredIndex] ? preferredIndex : resolved.length - 1
    const source = resolved[sourceIndex]
    if (!source) return false

    const query = occurrenceQueryForSelection(snapshot, source)
    if (!query) return false

    const keptSelections = resolved.filter((_selection, index) => index !== sourceIndex)
    const selected = keptSelections.map((selection) => ({
      start: selection.startOffset,
      end: selection.endOffset,
    }))
    const next = findNextExactOccurrenceFromRange(snapshot, query.query, selected, query.range)
    if (!next) return false
    if (next.start === query.range.start && next.end === query.range.end) return false

    const movedSelection = selectionRangeWithAffinity(source, next.start, next.end)
    const selections = [
      ...keptSelections.map((selection) => ({
        ...selectionOffsetsWithAffinity(selection, selection.anchorOffset, selection.headOffset),
        goal: selection.goal,
      })),
      movedSelection,
    ]
    const start = context.event ? eventStartMs(context.event) : nowMs()
    const change = session.setSelections(selections)
    this.syncSessionSelectionHighlight()
    this.markSessionSelectionForNextInput()
    this.applyChange(change, 'input.moveSelectionToNextFindMatch', start, {
      revealAffinity: survivingPrimarySelectionAffinity(
        change,
        movedSelection,
        movedSelection.head,
      ),
      revealOffset: movedSelection.head,
      syncDomSelection: false,
    })
    return true
  }

  applyAddNextOccurrenceCommand(context: EditorCommandContext): boolean {
    const start = context.event ? eventStartMs(context.event) : nowMs()
    const result = this.addNextExactOccurrence()
    if (!result) return false

    this.syncSessionSelectionHighlight()
    this.markSessionSelectionForNextInput()
    this.applyChange(result.change, 'input.addNextOccurrence', start, {
      revealOffset: result.revealOffset,
      syncDomSelection: false,
    })
    // Counted off the session after the change rather than worked out from the press: the first one
    // on a bare caret selects the word and adds nothing, and a press with nothing left to add has
    // already returned, so the count is the only thing that describes all three.
    this.announceOccurrenceSelection(this.resolvedSelections().length)
    return true
  }

  /**
   * What both occurrence keys leave behind, said the same way by each of them, because the number is
   * the part that decides what the next keystroke will do — and typing over four selections when you
   * meant three is not something the reader can see coming.
   *
   * This is also the channel's duplicate case in the flesh: a second press that finds no further
   * occurrence returns before here, but selecting the same word again answers with the same
   * sentence, and a reader who hears nothing reads that as the key having done nothing.
   */
  private announceOccurrenceSelection(count: number): void {
    this.options.announcer.status(
      count === 1 ? '1 occurrence selected' : `${count} occurrences selected`,
    )
  }

  applyNavigationCommand(command: EditorCommandId, context: EditorCommandContext): boolean {
    const session = this.session
    if (!session) return false
    if (COLUMN_SELECTION_COMMANDS.has(command)) {
      return this.applyColumnSelectionCommand(command, context)
    }

    const snapshot = session.getSnapshot()
    const resolvedSelections = session
      .getSelections()
      .selections.map((selection) => resolveSelection(snapshot, selection))
    if (resolvedSelections.length === 0) return false

    const readLine = createNavigationLineReader(snapshot, session.getTextSnapshot())
    const wordSeparators = wordSeparatorsForLanguage(this.options.getLanguageId())
    const navigation = resolvedSelections.map((resolved) => ({
      resolved,
      target: navigationTargetForCommand({
        command,
        resolved,
        readLine,
        documentLength: snapshot.length,
        rtlMoveVisually: this.options.rtlMoveVisually,
        wordSeparators,
        view: this.options.view,
        nonCaretOffset: this.options.nonCaretOffset,
        atomicRanges: this.options.view.atomicRanges(),
      }),
    }))
    const primary = navigation[0]
    if (!primary?.target) return false

    const start = context.event ? eventStartMs(context.event) : nowMs()
    const selections: DocumentSessionSelectionRange[] = []
    for (const { resolved, target } of navigation) {
      if (!target) return false
      selections.push({
        anchor: target.extend ? resolved.anchorOffset : target.offset,
        affinity: target.affinity,
        head: target.offset,
        goal: target.goal ?? SelectionGoal.none(),
      })
    }
    const change = session.setSelections(selections)
    this.markSessionSelectionForNextInput()
    this.options.view.revealCaret(primary.target.offset, primary.target.affinity)
    this.applyChange(change, primary.target.timingName, start)
    return true
  }

  applyFindSelection(
    anchorOffset: number,
    headOffset: number,
    timingName: string,
    options: {
      readonly affinity?: SelectionAffinity
      readonly revealBlock?: SessionChangeOptions['revealBlock']
      readonly revealOffset?: number
    } = {},
  ): void {
    const session = this.session
    if (!session) return

    const start = nowMs()
    // A caret carries no range of its own, so it is the landing that can be pulled onto the header
    // of a collapsed region instead of into the rows it hides. A range is left exactly where it was
    // asked for: the feature that built it addresses its own text through it, and find in particular
    // recognizes the match it is sitting on by the selection it left behind.
    const caret =
      anchorOffset === headOffset ? renderedRowCaretOffset(this.options.view, headOffset) : null
    const affinity = options.affinity ?? 'after'
    const change = session.setSelection(caret ?? anchorOffset, caret ?? headOffset, {
      affinity,
    })
    this.syncSessionSelectionHighlight()
    this.markSessionSelectionForNextInput()
    this.applyChange(change, timingName, start, {
      revealBlock: options.revealBlock,
      revealOffset: options.revealOffset,
      syncDomSelection: false,
    })
  }

  applyFindSelections(
    selections: readonly EditorSelectionRange[],
    timingName: string,
    revealOffset?: number,
    lastAddedIndex?: number,
  ): void {
    const session = this.session
    if (!session) return
    if (selections.length === 0) return

    const start = nowMs()
    const orderedSelections = selectionsWithLastAddedAtEnd(selections, lastAddedIndex)
    const change = session.setSelections(orderedSelections)
    this.syncSessionSelectionHighlight()
    this.markSessionSelectionForNextInput()
    this.applyChange(change, timingName, start, {
      revealAffinity: survivingPrimarySelectionAffinity(change, selections[0], revealOffset),
      revealOffset,
      syncDomSelection: false,
    })
  }

  applyFindEdits(
    edits: readonly TextEdit[],
    timingName: string,
    selection?: EditorSelectionRange,
  ): void {
    this.options.runInOperation(() => {
      const session = this.session
      if (!session) return
      if (!this.options.canEditDocument()) return
      if (edits.length === 0) return

      const start = nowMs()
      const change = session.applyEdits(edits, { selection })
      this.syncSessionSelectionHighlight()
      this.markSessionSelectionForNextInput()
      this.applyChange(change, timingName, start, {
        revealOffset: this.primarySelectionHeadOffset(change),
        syncDomSelection: false,
      })
    })
  }

  resolveViewSelections(): readonly EditorResolvedSelection[] {
    const snapshot = this.session?.getSnapshot()
    const selections = this.session?.getSelections().selections ?? []
    if (!snapshot) return []

    return selections.map((selection) => {
      const resolved = resolveSelection(snapshot, selection)
      return {
        anchorOffset: resolved.anchorOffset,
        headOffset: resolved.headOffset,
        startOffset: resolved.startOffset,
        endOffset: resolved.endOffset,
        affinity: resolved.affinity,
      }
    })
  }

  syncDomSelection(options: { readonly notify?: boolean } = {}): void {
    const session = this.session
    if (!session) return

    const selection = session.getSelections().selections[0]
    if (!selection) return

    const snapshot = session.getSnapshot()
    const resolved = resolveSelection(snapshot, selection)
    const start = clamp(resolved.startOffset, 0, snapshot.length)
    const end = clamp(resolved.endOffset, start, snapshot.length)

    if (this.hasFocusedExternalElement()) {
      this.syncSessionSelectionHighlight()
      this.notifySelection(options.notify ?? true)
      return
    }

    if (this.isInputFocused()) {
      this.syncSessionSelectionHighlight()
      this.notifySelection(options.notify ?? true)
      return
    }

    if (this.options.selectionSyncMode === 'none') {
      this.syncSessionSelectionHighlight()
      this.notifySelection(options.notify ?? true)
      return
    }

    const range = this.options.view.createRange(start, end, { scrollIntoView: false })
    const domSelection = window.getSelection()
    domSelection?.removeAllRanges()
    if (range) domSelection?.addRange(range)
    this.syncSessionSelectionHighlight()
    this.notifySelection(options.notify ?? true)
  }

  private notifySelection(notify: boolean): void {
    if (notify) this.options.notifyViewContributions('selection', null)
  }

  syncSessionSelectionHighlight(): void {
    const session = this.session
    if (!session) return

    const snapshot = session.getSnapshot()
    const selections = session.getSelections().selections.map((selection) => {
      const resolved = resolveSelection(snapshot, selection)
      return {
        anchorOffset: resolved.anchorOffset,
        headOffset: resolved.headOffset,
        affinity: resolved.affinity,
      }
    })
    // Focused textarea writes flush layout; include them before measuring the caret.
    this.refreshHiddenInputContent()
    this.options.view.setSelections(selections)
  }

  /**
   * Puts the document around the caret into the hidden input, and the caret with it.
   *
   * The element a screen reader is actually pointed at is this one, so an empty element is an
   * editor with nothing to read: no line, no position, no idea what was just selected. Writing the
   * window here — on the one call every selection and every change already funnels through — is
   * also what gives the diff its other half, since the text it compares against has to be the text
   * the browser was handed.
   *
   * Never during a composition, whatever moved: the element is where the candidate being assembled
   * lives, and writing a value or a selection into it takes that candidate away from the reader
   * mid-word — or, worse, leaves it and commits it wherever the write moved the caret to.
   */
  private refreshHiddenInputContent(): void {
    const session = this.session
    if (!session) return
    if (this.inputState.compositionActive) return

    const snapshot = session.getSnapshot()
    const selection = session.getSelections().selections[0]
    if (!selection) return

    const content = pagedHiddenInputContent(snapshot, resolveSelection(snapshot, selection))
    this.writeInputWindow(content)
    this.hiddenInputContent = {
      selectionEnd: content.selectionEnd,
      selectionStart: content.selectionStart,
      value: content.value,
    }
    this.transitionInputState({ type: 'hidden-input-written' })
  }

  /**
   * The one way out of here for a change, so that the snippet being filled in is carried onto every
   * document this controller produces.
   *
   * The stops are anchors and travel with the text on their own; what they cannot survive is being
   * left behind on the snapshot they were placed in, which is how they tell an edit made here from
   * one made anywhere else. Saying so at each edit is a rule every path has to remember, and a path
   * that forgets does not fail loudly — the reader simply finds that Tab stopped cycling and started
   * indenting, one keystroke after a Backspace. Undo and redo are the changes that must not be
   * carried: they hand back a document the stops were never placed in.
   */
  private applyChange(
    change: DocumentSessionChange,
    totalName?: string,
    totalStart?: number,
    options?: SessionChangeOptions,
  ): void {
    if (change.kind !== 'undo' && change.kind !== 'redo') {
      this.snippet.advance(change.snapshot, change.edits)
    }

    const revealOptions =
      options === undefined && change.edits.length > 0
        ? { revealOffset: this.primarySelectionHeadOffset(change) }
        : options
    this.options.applySessionChange(
      change,
      totalName,
      totalStart,
      selectionRevealOptions(change, revealOptions),
    )

    // After the edit, so a listener that asks for the document sees the typed character in it.
    const typed = this.pendingTypedText
    this.pendingTypedText = null
    if (typed !== null) this.options.onDidType(typed)
  }

  clearSelectionHighlight(): void {
    this.options.view.clearSelection()
  }

  textOffsetFromPoint(clientX: number, clientY: number): number | null {
    return this.options.view.textOffsetFromPoint(clientX, clientY)
  }

  rangeClientRect(start: number, end: number): DOMRect | null {
    const range = this.options.view.createRange(start, Math.max(start, end), {
      scrollIntoView: false,
    })
    if (!range) return null

    const firstRect = range.getClientRects()[0]
    if (firstRect) return firstRect

    const rect = range.getBoundingClientRect()
    if (rect.width > 0 || rect.height > 0) return rect
    return null
  }

  private get session(): DocumentSession | null {
    return this.options.getSession()
  }

  private transitionInputState(transition: EditorInputStateTransition): void {
    this.inputState = transitionEditorInputState(this.inputState, transition)
  }

  private markSessionSelectionForNextInput(): void {
    this.transitionInputState({ type: 'selection-owned-by-session' })
  }

  private markDomSelectionForNextInput(): void {
    this.transitionInputState({ type: 'selection-owned-by-dom' })
  }

  private markHiddenInputSelectionForNextInput(): void {
    this.transitionInputState({ type: 'selection-owned-by-hidden-input' })
  }

  /** The textarea holds the window as its value; an EditContext holds it as its text model. */
  private writeInputWindow(content: HiddenInputContent): void {
    const { editContext, inputElement: input } = this.options.view
    if (editContext) {
      if (editContext.text !== content.value) {
        editContext.updateText(0, editContext.text.length, content.value)
      }
      // A backward selection is given end first, as EditContext takes one.
      const backward = content.direction === 'backward'
      editContext.updateSelection(
        backward ? content.selectionEnd : content.selectionStart,
        backward ? content.selectionStart : content.selectionEnd,
      )
      writeAccessibleWindow(input, content)
      return
    }
    if (!(input instanceof HTMLTextAreaElement)) return

    if (input.value !== content.value) input.value = content.value
    input.setSelectionRange(content.selectionStart, content.selectionEnd, content.direction)
  }

  private installNativeInputHandlers(): void {
    if (this.nativeInputHandlersInstalled) return

    const editContext = this.options.view.editContext
    if (editContext) {
      this.options.view.inputElement.addEventListener('focus', this.handleEditContextFocus)
      editContext.addEventListener('textupdate', this.handleTextUpdate)
      editContext.addEventListener('compositionstart', this.handleCompositionStart as EventListener)
      editContext.addEventListener('compositionend', this.handleEditContextCompositionEnd)
      editContext.addEventListener('characterboundsupdate', this.handleCharacterBoundsUpdate)
    } else {
      this.options.view.inputElement.addEventListener('input', this.handleHiddenInputChange, {
        capture: true,
      })
    }
    this.nativeInputHandlersInstalled = true
  }

  private uninstallNativeInputHandlers(): void {
    if (!this.nativeInputHandlersInstalled) return

    const editContext = this.options.view.editContext
    if (editContext) {
      this.options.view.inputElement.removeEventListener('focus', this.handleEditContextFocus)
      editContext.removeEventListener('textupdate', this.handleTextUpdate)
      editContext.removeEventListener(
        'compositionstart',
        this.handleCompositionStart as EventListener,
      )
      editContext.removeEventListener('compositionend', this.handleEditContextCompositionEnd)
      editContext.removeEventListener('characterboundsupdate', this.handleCharacterBoundsUpdate)
    } else {
      this.options.view.inputElement.removeEventListener('input', this.handleHiddenInputChange, {
        capture: true,
      })
    }
    this.nativeInputHandlersInstalled = false
  }

  /** The caret only goes into the document selection while the element has focus; this puts it there. */
  private handleEditContextFocus = (): void => {
    writeAccessibleWindow(this.options.view.inputElement, this.hiddenInputContent)
  }

  /**
   * Every edit EditContext makes to the window, with the range it replaced: the edits the textarea
   * route has to diff back out of its value arrive here already named. Typed characters the
   * beforeinput handler takes never reach it, because preventing that event withholds the update.
   */
  private handleTextUpdate = this.traceInput('input.textupdate', (event: Event): void => {
    const update = event as EditorTextUpdateEvent
    this.transitionInputState({ type: 'native-input-observed' })
    const session = this.session
    if (!session) return
    if (!this.options.canEditDocument()) return
    if (this.inputState.compositionActive) {
      this.updateEditContextComposition(update)
      return
    }

    const edit = textUpdateEdit(this.hiddenInputContent, {
      text: update.text,
      rangeStart: update.updateRangeStart,
      rangeEnd: update.updateRangeEnd,
    })
    this.applyDeducedInput(session, edit, eventStartMs(event))
  })

  /**
   * A candidate replaces the range the composition started over, and each later candidate replaces
   * the one before it; tracking the span is what lets the commit name the original range.
   */
  private updateEditContextComposition(update: EditorTextUpdateEvent): void {
    const current = this.editContextComposition ?? {
      rangeStart: update.updateRangeStart,
      rangeEnd: update.updateRangeEnd,
      spanEnd: update.updateRangeEnd,
    }
    const spanEnd =
      current.spanEnd + update.text.length - (update.updateRangeEnd - update.updateRangeStart)
    this.editContextComposition = { ...current, spanEnd }
    const candidate = this.options.view.editContext?.text.slice(current.rangeStart, spanEnd) ?? ''
    this.transitionInputState({ text: candidate, type: 'composition-update' })
    this.options.view.setCompositionPreedit(candidate)
  }

  private handleEditContextCompositionEnd = this.traceInput(
    'input.compositionend',
    (event: Event): void => {
      const composition = this.editContextComposition
      this.editContextComposition = null
      const text = (event as CompositionEvent).data ?? ''
      this.options.view.setCompositionPreedit('')
      this.transitionInputState({ type: 'composition-end' })
      const session = this.session
      const replaces = composition && composition.rangeEnd > composition.rangeStart
      if (!session || !composition || (text.length === 0 && !replaces)) {
        this.refreshHiddenInputContent()
        return
      }

      this.commitComposition(
        text,
        { start: composition.rangeStart, end: composition.rangeEnd },
        eventStartMs(event),
      )
    },
  )

  /** The IME asks where the candidate is drawn, so its window opens beside it rather than guessing. */
  private handleCharacterBoundsUpdate = (event: Event): void => {
    const editContext = this.options.view.editContext
    if (!editContext) return

    const { rangeStart } = event as EditorCharacterBoundsUpdateEvent
    const caret = this.options.view.inputElement.getBoundingClientRect()
    editContext.updateControlBounds(this.options.el.getBoundingClientRect())
    editContext.updateSelectionBounds(caret)
    const drawn = this.options.view.compositionCharacterRects()
    editContext.updateCharacterBounds(rangeStart, drawn.length > 0 ? drawn : [caret])
  }

  /**
   * An edit the browser made to the hidden input itself, read back as an edit to the document.
   *
   * This is where every input event the editor cannot name arrives: an autocorrection, a dead key
   * resolving, a dictated phrase, a soft keyboard rewriting the word around the caret. None of them
   * carries usable data on the event, and all of them leave the answer in the element's value.
   */
  private handleHiddenInputChange = this.traceInput('input.deducedText', (event: Event): void => {
    this.transitionInputState({ type: 'native-input-observed' })
    const session = this.session
    if (!session) return
    if (!this.options.canEditDocument()) return
    // A composition writes each intermediate candidate into the input on its way to the text it
    // finally commits. Diffing those would type every candidate the reader passed through.
    if (this.inputState.compositionActive) return

    const input = this.options.view.inputElement
    if (!(input instanceof HTMLTextAreaElement)) return
    const current = readHiddenInputState(input)
    const deduced = deduceHiddenInputEdit(this.hiddenInputContent, current)
    // Nothing is written back for either of these, so the element keeps whatever the browser put
    // there and the editor keeps the older text to measure the next event against.
    if (isIncompleteDeducedInput(deduced)) return
    if (isEmptyDeducedInput(deduced, this.hiddenInputContent)) return

    this.applyDeducedInput(session, deduced, eventStartMs(event))
  })

  private handleCompositionStart = this.traceInput(
    'input.compositionstart',
    (_event: CompositionEvent): void => {
      this.transitionInputState({ type: 'composition-start' })
      this.editContextComposition = null
      // A textarea selects what the composition is about to replace, which is how a correction
      // reaching back over a word says so: the event itself carries only the new text.
      const input = this.options.view.inputElement
      this.compositionRange =
        input instanceof HTMLTextAreaElement
          ? { start: input.selectionStart, end: input.selectionEnd }
          : null
    },
  )

  private handleCompositionUpdate = this.traceInput(
    'input.compositionupdate',
    (event: CompositionEvent): void => {
      this.transitionInputState({ text: event.data, type: 'composition-update' })
      // Every candidate a reader passes through on the way to the one they want is here and nowhere
      // else: the hidden input holds it, and the document does not hear about any of them.
      this.options.view.setCompositionPreedit(event.data)
    },
  )

  private handleCompositionEnd = this.traceInput(
    'input.compositionend',
    (event: CompositionEvent): void => {
      const text = event.data || this.inputState.compositionText
      const shouldCommit = shouldCommitCompositionEnd(this.inputState, text)
      const range = this.compositionRange
      this.compositionRange = null
      // Taken down for every way a composition can end, including the ones below that return: text
      // already committed through beforeinput is the document's to draw, and text abandoned mid-word
      // was never the document's at all.
      this.options.view.setCompositionPreedit('')
      this.transitionInputState({ type: 'composition-end' })
      if (!shouldCommit) {
        // The document is already right — the text arrived as a beforeinput and was written from
        // there — but the hidden input is not: every refresh between the compositionstart and here
        // returned rather than write over a candidate the reader was still assembling. Nothing else
        // writes that baseline, so leaving it a composition behind makes the next edit the editor
        // cannot name diff against text the browser stopped holding, and type the composition again.
        this.refreshHiddenInputContent()
        return
      }

      this.commitComposition(text, range, eventStartMs(event))
    },
  )

  private handleMouseDown = (event: MouseEvent): void => {
    if (!this.session) return
    if (event.defaultPrevented) return
    if (this.options.claimPress(event)) {
      event.preventDefault()
      return
    }

    this.options.view.focusInput()
    if (event.detail >= 4) {
      this.selectFullDocument(event, 'input.quadClick')
      return
    }

    const position = this.textPositionFromMouseEvent(event)
    if (!position) return
    this.options.beginPointerJump?.()

    // Alt on its own already means "another cursor here", so the rectangle takes the pair.
    if (event.altKey && event.shiftKey) {
      this.startMouseSelectionDrag(event, position, 'column')
      return
    }

    if (event.detail === 3) {
      this.startMouseSelectionDrag(event, position, 'line')
      return
    }

    if (event.detail === 2) {
      this.startMouseSelectionDrag(event, position, 'word')
      return
    }

    if (event.altKey) {
      this.addCursorAtPosition(event, position)
      return
    }

    if (this.startMouseTextMoveDrag(event, position)) return

    this.startMouseSelectionDrag(event, position, 'char')
  }

  private addCursorAtPosition(event: MouseEvent, position: VirtualizedTextHitPosition): void {
    const session = this.session
    if (!session) return
    if (event.button !== 0) return
    if (event.detail !== 1) return

    const start = eventStartMs(event)
    event.preventDefault()
    const change = session.addSelection(position.offset, position.offset, {
      affinity: position.affinity,
    })
    this.syncSessionSelectionHighlight()
    this.markSessionSelectionForNextInput()
    this.applyChange(change, 'input.addCursor', start, {
      syncDomSelection: false,
    })
  }

  /**
   * Arms a drag over the pressed point.
   *
   * Shift keeps the anchor the previous press laid down instead of laying down a new one, which is
   * the whole of extending by click: only the head moves, and a run begun on a word or a line goes
   * on selecting whole words or lines in either direction.
   */
  private startMouseSelectionDrag(
    event: MouseEvent,
    position: VirtualizedTextHitPosition,
    granularity: MouseSelectionGranularity,
  ): void {
    const session = this.session
    if (!session) return
    if (event.button !== 0) return

    const { offset } = position
    const head = this.offsetRangeAt(offset, granularity)
    const anchor = event.shiftKey
      ? this.mouseSelectionExtendAnchor()
      : this.mouseSelectionAnchorAt(position, head, granularity)
    if (!anchor) return

    const start = eventStartMs(event)
    event.preventDefault()
    this.options.view.focusInput()
    this.mouseSelectionAnchor = anchor
    const drag: MouseSelectionDrag = {
      anchor,
      granularity,
      head: position,
      clientX: event.clientX,
      clientY: event.clientY,
    }
    this.mouseSelectionDrag = drag
    this.transitionInputState({ type: 'mouse-selection-start' })
    this.options.el.ownerDocument.addEventListener('mousemove', this.updateMouseSelectionDrag)
    this.options.el.ownerDocument.addEventListener('mouseup', this.finishMouseSelectionDrag)
    if (granularity === 'column') {
      this.startColumnSelection(session, offset, start)
      return
    }

    // A press that only drops the caret somewhere has nothing to show until it moves or lifts, and
    // committing here would spend a selection change on every click.
    if (granularity === 'char' && !event.shiftKey) {
      this.syncCustomSelectionHighlight(offset, offset, position.affinity)
      return
    }

    const ends = this.mouseSelectionEndsForDrag(drag)
    this.applyMouseSelection(
      session,
      ends,
      mouseSelectionTimingName(granularity),
      start,
      this.mouseSelectionAffinity(drag, ends),
    )
  }

  private mouseSelectionAnchorAt(
    position: VirtualizedTextHitPosition,
    range: TextOffsetRange,
    granularity: MouseSelectionGranularity,
  ): MouseSelectionAnchor {
    const bidi =
      granularity === 'char' ? this.options.view.createBidiSelectionAnchor(position) : null
    return { range, bidi }
  }

  private offsetRangeAt(offset: number, granularity: MouseSelectionGranularity): TextOffsetRange {
    if (granularity === 'char' || granularity === 'column') return { start: offset, end: offset }

    const line = this.readLineAt(offset)
    if (!line) return { start: offset, end: offset }
    if (granularity === 'line') return { start: line.start, end: line.start + line.text.length }

    const word = wordRangeAtOffset(line.text, offset - line.start)
    return { start: line.start + word.start, end: line.start + word.end }
  }

  /**
   * What a shift-click pivots on. The range the last press anchored to holds only while the live
   * selection is still anchored there: Select All or a Shift+Arrow run has re-anchored it since and
   * owes that press nothing, so extending falls back to the end the selection is anchored by —
   * never the end the caret happens to sit at.
   */
  private mouseSelectionExtendAnchor(): MouseSelectionAnchor | null {
    const primary = this.primaryResolvedSelection()
    if (!primary) return null

    const remembered = this.mouseSelectionAnchor
    if (
      remembered &&
      (primary.anchorOffset === remembered.range.start ||
        primary.anchorOffset === remembered.range.end)
    ) {
      return remembered
    }

    return {
      range: { start: primary.anchorOffset, end: primary.anchorOffset },
      bidi: null,
    }
  }

  private applyMouseSelection(
    session: DocumentSession,
    ends: MouseSelectionEnds,
    timingName: string,
    start: number,
    affinity: SelectionAffinity,
  ): void {
    const change = session.setSelection(ends.anchorOffset, ends.headOffset, { affinity })
    this.syncCustomSelectionHighlight(ends.anchorOffset, ends.headOffset, affinity)
    this.markSessionSelectionForNextInput()
    this.applyChange(change, timingName, start, { syncDomSelection: false })
  }

  private mouseSelectionAffinity(
    drag: MouseSelectionDrag,
    ends: MouseSelectionEnds,
  ): SelectionAffinity {
    if (drag.granularity === 'char') return drag.head.affinity
    if (ends.headOffset < ends.anchorOffset) return 'after'
    if (ends.headOffset > ends.anchorOffset) return 'before'
    return drag.head.affinity
  }

  private startColumnSelection(session: DocumentSession, offset: number, start: number): void {
    // A press lays down a rectangle of its own rather than continuing the one the keyboard was
    // pushing around: it is anchored where the caret already is and spans out to the pointer.
    this.columnSelection = null
    this.commitColumnSelection(session, offset, start)
  }

  private updateColumnSelection(session: DocumentSession, offset: number): void {
    const rectangle = this.columnSelectionTo(session, offset)
    if (!rectangle) return
    if (!this.setColumnSelection(session, rectangle)) return

    this.options.notifyViewContributions('selection', null)
  }

  private commitColumnSelection(session: DocumentSession, offset: number, start: number): void {
    const rectangle = this.columnSelectionTo(session, offset)
    if (!rectangle) return

    const applied = this.setColumnSelection(session, rectangle)
    if (!applied) return

    // No reveal: the corner the pointer is holding is already the part of the document the user is
    // looking at, and scrolling to it would drag the text out from under the drag.
    this.applyChange(applied.change, 'input.columnSelection', start, {
      syncDomSelection: false,
    })
  }

  private applyColumnSelectionCommand(
    command: EditorCommandId,
    context: EditorCommandContext,
  ): boolean {
    const session = this.session
    if (!session) return false

    const rectangle = this.columnSelectionRectangle(session)
    if (!rectangle) return false

    const applied = this.setColumnSelection(
      session,
      this.movedColumnSelection(session, command, rectangle),
    )
    if (!applied) return false

    const start = context.event ? eventStartMs(context.event) : nowMs()
    this.applyChange(applied.change, 'input.columnSelection', start, {
      revealOffset: applied.revealOffset,
      syncDomSelection: false,
    })
    return true
  }

  /** Only the moving corner ever changes; the anchored one is what the rectangle is measured from. */
  private movedColumnSelection(
    session: DocumentSession,
    command: EditorCommandId,
    rectangle: ColumnSelectionRectangle,
  ): ColumnSelectionRectangle {
    if (command === 'cursorColumnSelectLeft') {
      return { ...rectangle, toColumn: Math.max(0, rectangle.toColumn - 1) }
    }

    if (command === 'cursorColumnSelectRight') {
      // The widest line in the band, so the rectangle can be pushed past the end of the short ones
      // but never off into a column no line in it reaches.
      const limit = this.columnSelectionWidestColumn(session, rectangle)
      return { ...rectangle, toColumn: Math.min(rectangle.toColumn + 1, limit) }
    }

    const rows = columnSelectionRowDelta(command, this.options.view.pageRowDelta())
    const snapshot = session.getSnapshot()
    const lastRow = offsetToPoint(snapshot, snapshot.length).row
    return { ...rectangle, toRow: clamp(rectangle.toRow + rows, 0, lastRow) }
  }

  private setColumnSelection(
    session: DocumentSession,
    rectangle: ColumnSelectionRectangle,
  ): { readonly change: DocumentSessionChange; readonly revealOffset: number } | null {
    const { ranges, widestColumn } = this.columnSelectionRanges(session, rectangle)
    // The anchored row is measured from a real position on itself, so it is always inside the band
    // and always contributes: no gesture can empty this, and the guard is here for the index type.
    const moving = ranges.at(-1)
    if (!moving) return null

    const change = session.setSelections(ranges)
    this.columnSelection = { rectangle, selections: session.getSelections(), widestColumn }
    this.syncSessionSelectionHighlight()
    this.markSessionSelectionForNextInput()
    return { change, revealOffset: moving.head ?? moving.anchor }
  }

  /**
   * One cursor per row the rectangle covers, walked from its anchored corner to its moving one,
   * with the widest of those rows picked up on the way: both readings need every line's text, and
   * the rows can number in the thousands while the chord is held down.
   */
  private columnSelectionRanges(
    session: DocumentSession,
    rectangle: ColumnSelectionRectangle,
  ): {
    readonly ranges: readonly DocumentSessionSelectionRange[]
    readonly widestColumn: number
  } {
    const snapshot = session.getSnapshot()
    const readLine = createNavigationLineReader(snapshot, session.getTextSnapshot())
    const tabSize = this.options.tabSize
    const step = rectangle.toRow < rectangle.fromRow ? -1 : 1
    const rows = Math.abs(rectangle.toRow - rectangle.fromRow) + 1
    const ranges: DocumentSessionSelectionRange[] = []
    let widestColumn = 0

    for (let index = 0; index < rows; index += 1) {
      const row = rectangle.fromRow + step * index
      const line = readLine(pointToOffset(snapshot, { row, column: 0 }))
      widestColumn = Math.max(widestColumn, visualColumnLength(line.text, tabSize))

      const fromColumn = visualColumnToBufferColumn(
        line.text,
        rectangle.fromColumn,
        'nearest',
        tabSize,
      )
      const toColumn = visualColumnToBufferColumn(line.text, rectangle.toColumn, 'nearest', tabSize)
      const covers = columnBandCoversLine(
        rectangle,
        bufferColumnToVisualColumn(line.text, fromColumn, tabSize),
        bufferColumnToVisualColumn(line.text, toColumn, tabSize),
      )
      // A line that stops short of the band contributes no cursor at all. Clamping it to its own
      // end instead would put a caret outside the rectangle, editing text it never covered.
      if (!covers) continue

      ranges.push({
        anchor: line.start + fromColumn,
        affinity: 'after',
        head: line.start + toColumn,
      })
    }

    return { ranges, widestColumn }
  }

  private columnSelectionWidestColumn(
    session: DocumentSession,
    rectangle: ColumnSelectionRectangle,
  ): number {
    // A rectangle that is still the stored one covers the rows the stored width was measured over.
    const run = this.columnSelection
    if (run?.rectangle === rectangle) return run.widestColumn

    return this.columnSelectionRanges(session, rectangle).widestColumn
  }

  private columnSelectionTo(
    session: DocumentSession,
    offset: number,
  ): ColumnSelectionRectangle | null {
    const rectangle = this.columnSelectionRectangle(session)
    if (!rectangle) return null

    const to = this.columnSelectionCorner(session, offset)
    return { ...rectangle, toRow: to.row, toColumn: to.column }
  }

  /** The rectangle the next column gesture continues, or one synthesised from the caret. */
  private columnSelectionRectangle(session: DocumentSession): ColumnSelectionRectangle | null {
    const snapshot = session.getSnapshot()
    const run = this.columnSelection
    if (run?.rectangle.snapshot === snapshot && run.selections === session.getSelections()) {
      return run.rectangle
    }

    this.columnSelection = null
    const primary = this.primaryResolvedSelection()
    if (!primary) return null

    const from = this.columnSelectionCorner(session, primary.anchorOffset)
    const to = this.columnSelectionCorner(session, primary.headOffset)
    return {
      snapshot,
      fromRow: from.row,
      fromColumn: from.column,
      toRow: to.row,
      toColumn: to.column,
    }
  }

  private columnSelectionCorner(
    session: DocumentSession,
    offset: number,
  ): { readonly row: number; readonly column: number } {
    const point = offsetToPoint(session.getSnapshot(), offset)
    const line = this.readLineAt(offset)
    return {
      row: point.row,
      column: bufferColumnToVisualColumn(line?.text ?? '', point.column, this.options.tabSize),
    }
  }

  private updateMouseSelectionDrag = (event: MouseEvent): void => {
    if (!this.mouseSelectionDrag) return
    if (!this.session) return

    event.preventDefault()
    this.mouseSelectionDrag.clientX = event.clientX
    this.mouseSelectionDrag.clientY = event.clientY
    this.updateMouseSelectionFromDragPoint()
    this.updateMouseSelectionAutoScroll()
  }

  private finishMouseSelectionDrag = (event: MouseEvent): void => {
    const drag = this.mouseSelectionDrag
    const session = this.session
    if (!drag || !session) {
      this.stopMouseSelectionDrag()
      return
    }

    // A release can arrive from over the gutter, a scrollbar, or past the last line, where a hit
    // test answers with an offset the pointer never visited.
    const { granularity, head } = drag
    event.preventDefault()
    this.stopMouseSelectionDrag('finish')

    const start = nowMs()
    if (granularity === 'column') {
      this.commitColumnSelection(session, head.offset, start)
      this.options.finishPointerJump?.()
      return
    }

    const ends = this.mouseSelectionEndsForDrag(drag)
    const affinity = this.mouseSelectionAffinity(drag, ends)
    this.rememberMouseSelectionAnchor(drag, ends.anchorOffset)
    const change = session.setSelection(ends.anchorOffset, ends.headOffset, {
      affinity,
    })
    const syncDomSelection = ends.anchorOffset === ends.headOffset
    this.syncCustomSelectionHighlight(ends.anchorOffset, ends.headOffset, affinity)
    this.markSessionSelectionForNextInput()
    this.applyChange(change, 'input.selection', start, { syncDomSelection })
    this.options.finishPointerJump?.()
  }

  /**
   * Takes a press that landed inside the selection, so that dragging carries the selected text
   * instead of throwing the selection away and starting a new one.
   *
   * Only the interior counts: a press on either edge is how a selection is grown by dragging, and
   * text that is only one character wide has no interior to grab. Several cursors have no one run to
   * carry, and a read-only document cannot take the text back out again.
   */
  private startMouseTextMoveDrag(event: MouseEvent, position: VirtualizedTextHitPosition): boolean {
    if (event.button !== 0) return false
    if (event.detail !== 1) return false
    if (event.shiftKey) return false
    if (!this.options.canEditDocument()) return false

    const resolved = this.resolvedSelections()
    const primary = resolved.length === 1 ? resolved[0] : undefined
    if (!primary) return false
    const { offset } = position
    if (offset <= primary.startOffset || offset >= primary.endOffset) return false

    event.preventDefault()
    this.options.view.focusInput()
    this.mouseTextMoveDrag = {
      drop: null,
      moved: false,
      press: position,
      source: { start: primary.startOffset, end: primary.endOffset },
      sourceAffinity: primary.affinity,
      sourceReversed: primary.reversed,
    }
    this.transitionInputState({ type: 'mouse-selection-start' })
    this.options.el.ownerDocument.addEventListener('mousemove', this.updateMouseTextMoveDrag)
    this.options.el.ownerDocument.addEventListener('mouseup', this.finishMouseTextMoveDrag)
    return true
  }

  private updateMouseTextMoveDrag = (event: MouseEvent): void => {
    const drag = this.mouseTextMoveDrag
    if (!drag) return

    event.preventDefault()
    const position = this.textPositionFromMouseEvent(event)
    if (!position) return

    drag.moved =
      drag.moved ||
      position.offset !== drag.press.offset ||
      position.affinity !== drag.press.affinity
    drag.drop =
      position.offset > drag.source.start && position.offset < drag.source.end ? null : position
    this.showTextMoveDropCaret(drag)
  }

  private finishMouseTextMoveDrag = this.traceInput(
    'input.finishMouseTextMoveDrag',
    (event: MouseEvent): void => {
      const drag = this.mouseTextMoveDrag
      const session = this.session
      if (!drag || !session) {
        this.stopMouseTextMoveDrag()
        return
      }

      event.preventDefault()
      this.stopMouseTextMoveDrag('finish')
      const start = eventStartMs(event)
      if (!drag.moved) {
        this.collapseSelectionToPosition(session, drag.press, start)
        this.options.finishPointerJump?.()
        return
      }

      this.options.cancelPointerJump?.()

      // The modifier is read here rather than at the press, because it can be taken up or let go at
      // any point while the text is in flight and what it says at the release is the user's answer.
      const move =
        drag.drop === null
          ? null
          : mouseTextMove(
              drag.source,
              readPieceTableTextRange(session.getSnapshot(), drag.source.start, drag.source.end),
              drag.drop.offset,
              event.altKey || event.ctrlKey,
            )
      if (!move) {
        this.syncSessionSelectionHighlight()
        return
      }

      const selection = mouseTextMoveSelection(drag, move.selection)
      const change = session.applyEdits(move.edits, { selections: [selection] })
      this.syncCustomSelectionHighlight(selection.anchor, selection.head, selection.affinity)
      this.markSessionSelectionForNextInput()
      this.applyChange(change, 'input.dragText', start, {
        revealOffset: selection.head,
        syncDomSelection: false,
      })
    },
  )

  private showTextMoveDropCaret(drag: MouseTextMoveDrag): void {
    // With nowhere to drop, the selection comes back: the run is still where it was, and a caret
    // sitting inside it would claim otherwise.
    if (drag.drop === null) {
      this.syncSessionSelectionHighlight()
      return
    }

    this.syncCustomSelectionHighlight(drag.drop.offset, drag.drop.offset, drag.drop.affinity)
  }

  private collapseSelectionToPosition(
    session: DocumentSession,
    position: VirtualizedTextHitPosition,
    start: number,
  ): void {
    const change = session.setSelection(position.offset, position.offset, {
      affinity: position.affinity,
    })
    this.syncCustomSelectionHighlight(position.offset, position.offset, position.affinity)
    this.markSessionSelectionForNextInput()
    this.applyChange(change, 'input.selection', start, { syncDomSelection: true })
  }

  private stopMouseTextMoveDrag(reason: 'cancel' | 'finish' = 'cancel'): void {
    const hadDrag = this.mouseTextMoveDrag !== null
    this.mouseTextMoveDrag = null
    this.options.el.ownerDocument.removeEventListener('mousemove', this.updateMouseTextMoveDrag)
    this.options.el.ownerDocument.removeEventListener('mouseup', this.finishMouseTextMoveDrag)
    if (!hadDrag) return

    if (reason === 'cancel') this.options.cancelPointerJump?.()
    this.transitionInputState({ type: 'mouse-selection-finish' })
  }

  private stopMouseSelectionDrag(reason: 'cancel' | 'finish' = 'cancel'): void {
    const hadDrag = this.mouseSelectionDrag !== null
    this.mouseSelectionDrag = null
    this.stopMouseSelectionAutoScroll()
    this.options.el.ownerDocument.removeEventListener('mousemove', this.updateMouseSelectionDrag)
    this.options.el.ownerDocument.removeEventListener('mouseup', this.finishMouseSelectionDrag)
    if (!hadDrag) return

    if (reason === 'cancel') this.options.cancelPointerJump?.()
    this.transitionInputState({
      type: reason === 'finish' ? 'mouse-selection-finish' : 'mouse-selection-cancel',
    })
  }

  private updateMouseSelectionFromDragPoint(): void {
    const drag = this.mouseSelectionDrag
    const session = this.session
    if (!drag || !session) return

    const position = this.mouseSelectionPositionFromPoint(drag.clientX, drag.clientY, drag.head)
    drag.head = position
    const { offset } = position
    if (drag.granularity === 'column') {
      this.updateColumnSelection(session, offset)
      return
    }

    const ends = this.mouseSelectionEndsForDrag(drag)
    const affinity = this.mouseSelectionAffinity(drag, ends)
    this.syncCustomSelectionHighlight(ends.anchorOffset, ends.headOffset, affinity)
    session.setSelection(ends.anchorOffset, ends.headOffset, { affinity })
    this.options.notifyViewContributions('selection', null)
    if (ends.anchorOffset === ends.headOffset) {
      this.markDomSelectionForNextInput()
      return
    }

    this.markSessionSelectionForNextInput()
  }

  private mouseSelectionEndsForDrag(drag: MouseSelectionDrag): MouseSelectionEnds {
    const head = this.offsetRangeAt(drag.head.offset, drag.granularity)
    const bidi = drag.granularity === 'char' ? drag.anchor.bidi : null
    if (!bidi) return mouseSelectionEnds(drag.anchor.range, head)

    const anchorOffset = this.options.view.resolveBidiSelectionAnchor(bidi, drag.head)
    return mouseSelectionEnds({ start: anchorOffset, end: anchorOffset }, head)
  }

  private rememberMouseSelectionAnchor(drag: MouseSelectionDrag, anchorOffset: number): void {
    if (drag.granularity !== 'char') return
    const bidi = drag.anchor.bidi
    // A committed alternate twin must not fall back to the raw press after geometry changes.
    const reusableBidi = bidi?.rawOffset === anchorOffset ? bidi : null
    this.mouseSelectionAnchor = {
      range: { start: anchorOffset, end: anchorOffset },
      bidi: reusableBidi,
    }
  }

  private mouseSelectionPositionFromPoint(
    clientX: number,
    clientY: number,
    fallback: VirtualizedTextHitPosition,
  ): VirtualizedTextHitPosition {
    const position = this.options.view.textPositionFromPoint(clientX, clientY)
    if (position) return position
    return fallback
  }

  private updateMouseSelectionAutoScroll(): void {
    if (!this.scrollMouseSelection(this.mouseSelectionAutoScrollDelta())) {
      this.stopMouseSelectionAutoScroll()
      return
    }

    this.scheduleMouseSelectionAutoScroll()
  }

  private mouseSelectionAutoScrollDelta(): MouseSelectionAutoScrollDelta {
    const drag = this.mouseSelectionDrag
    if (!drag) return NO_MOUSE_SELECTION_AUTO_SCROLL

    const rect = this.options.el.getBoundingClientRect()
    return mouseSelectionAutoScrollDelta(
      drag.clientX,
      drag.clientY,
      rect,
      this.options.view.textViewportInsets(),
    )
  }

  /** Answers whether the viewport moved, so a drag held against an edge stops the frame loop. */
  private scrollMouseSelection(delta: MouseSelectionAutoScrollDelta): boolean {
    const { el } = this.options
    const maxScrollTop = Math.max(0, el.scrollHeight - el.clientHeight)
    const maxScrollLeft = Math.max(0, el.scrollWidth - el.clientWidth)
    const nextScrollTop = clamp(el.scrollTop + delta.y, 0, maxScrollTop)
    const nextScrollLeft = clamp(el.scrollLeft + delta.x, 0, maxScrollLeft)
    if (nextScrollTop === el.scrollTop && nextScrollLeft === el.scrollLeft) return false

    el.scrollTop = nextScrollTop
    el.scrollLeft = nextScrollLeft
    this.options.view.setScrollMetrics(el.scrollTop, el.clientHeight, undefined, el.scrollLeft)
    this.updateMouseSelectionFromDragPoint()
    return true
  }

  private scheduleMouseSelectionAutoScroll(): void {
    if (this.mouseSelectionAutoScrollFrame !== null) return

    this.mouseSelectionAutoScrollFrame = scheduleFrame(() => {
      this.mouseSelectionAutoScrollFrame = null
      if (!this.mouseSelectionDrag) return
      this.updateMouseSelectionAutoScroll()
    })
  }

  private stopMouseSelectionAutoScroll(): void {
    if (this.mouseSelectionAutoScrollFrame === null) return

    this.mouseSelectionAutoScrollFrame.cancel()
    this.mouseSelectionAutoScrollFrame = null
  }

  private selectFullDocument(event: MouseEvent, timingName: string): void {
    const session = this.session
    if (!session) return

    const start = eventStartMs(event)
    event.preventDefault()
    const change = session.setSelection(0, session.getSnapshot().length, { affinity: 'after' })
    this.syncCustomSelectionHighlight(0, session.getSnapshot().length, 'after')
    this.markSessionSelectionForNextInput()
    this.applyChange(change, timingName, start, { syncDomSelection: false })
  }

  private readLineAt(offset: number): NavigationLine | null {
    const session = this.session
    if (!session) return null

    return createNavigationLineReader(session.getSnapshot(), session.getTextSnapshot())(offset)
  }

  private handleBeforeInput = this.traceInput('input.beforeinput', (event: InputEvent): void => {
    const session = this.session
    if (!session) return
    if (!this.options.canEditDocument()) {
      event.preventDefault()
      return
    }

    const inserted = beforeInputText(event)
    if (inserted === null) return

    const start = eventStartMs(event)
    const selectionChange = measureEditorPerformance('input.selectionChangeBeforeEdit', () =>
      this.selectionChangeBeforeEdit(),
    )
    event.preventDefault()
    this.transitionInputState({ text: inserted, type: 'beforeinput-pending' })
    // Only a plain typed character can auto-close; insertLineBreak also yields a 1-character
    // string, and composition results must never be rewritten.
    const textChange = measureEditorPerformance('session.applyText', () =>
      event.inputType === 'insertText'
        ? this.applyTypedText(session, inserted)
        : this.applyLineBreak(session, inserted),
    )
    this.transitionInputState({ type: 'transaction-committed' })
    this.applyChange(mergeChangeTimings(textChange, selectionChange), 'input.beforeinput', start)
  })

  private handlePaste = this.traceInput('input.paste', (event: ClipboardEvent): void => {
    const session = this.session
    if (!session) return
    if (!this.options.canEditDocument()) {
      event.preventDefault()
      return
    }

    const transfer = event.clipboardData ?? null
    // The session flattens terminators again on its way into the buffer, so
    // this is not what keeps them out of the document. It is what pasteRevealBlock
    // reads: the reveal is decided from the payload rather than from the document
    // it produces, and a Word or PDF paste whose only breaks are U+2028/U+2029
    // would otherwise count as a single line and leave its new rows unrevealed.
    const text = normalizeLineEndings(transfer?.getData('text/plain') ?? '')
    // An image is the case this second condition exists for: no text at all, and until something
    // registers to read the transfer it carries there is genuinely nothing to insert.
    if (text.length === 0 && !this.hasPasteHandlerForTransfer(transfer)) return

    // Looked up under the folded text, because that is the form the payload was written in.
    const metadata = readClipboardMetadata(transfer, text)
    this.transitionInputState({ text, type: 'paste-pending' })
    const start = eventStartMs(event)
    const selectionChange = this.selectionChangeBeforeEdit()
    event.preventDefault()
    // After the selection sync above, so a handler reads the carets the paste is actually landing
    // on rather than the ones the last gesture left in the session.
    const handled = this.handledPasteFragments(transfer, text, metadata !== null, 'paste')
    const pasted = handled?.join('') ?? text
    const textChange = handled
      ? this.applyDistributedPaste(session, handled, this.resolvedSelections())
      : text.length > 0
        ? this.applyPaste(session, text, metadata)
        : null
    this.transitionInputState({ type: 'transaction-committed' })
    // Every handler passed on a payload that had no text of its own, so the gesture inserts
    // nothing; the selection the sync above corrected is still worth announcing.
    const change = textChange ? mergeChangeTimings(textChange, selectionChange) : selectionChange
    if (!change) return

    this.applyChange(change, 'input.paste', start, {
      revealBlock: pasteRevealBlock(pasted),
      revealOffset: this.primarySelectionHeadOffset(change),
    })
  })

  /**
   * Whether anything registered would even look at this transfer.
   *
   * Asked before the paste is committed to, because the alternative to a handler here is doing
   * nothing at all: a transfer with no text is not a paste unless someone can read it.
   */
  private hasPasteHandlerForTransfer(transfer: DataTransfer | null): boolean {
    if (!transfer) return false

    const types = dataTransferTypes(transfer)
    return this.options
      .getPasteHandlers()
      .some((handler) => pasteHandlerMatchesTypes(handler, types))
  }

  /**
   * The text each caret takes according to whoever claimed the paste, or null for the plain path.
   *
   * The first handler to answer takes it: a claim says this payload means something other than its
   * text, and the order the handlers arrive in already says whose reading of it wins. A list that
   * does not have one entry per caret is not describing these carets, which is the same reading a
   * carried payload gets refused for in applyPaste.
   */
  private handledPasteFragments(
    transfer: DataTransfer | null,
    text: string,
    internal: boolean,
    source: EditorPasteContext['source'],
    targets: readonly EditorPasteTarget[] = this.pasteTargets(),
  ): readonly string[] | null {
    if (!transfer) return null

    const handlers = this.options.getPasteHandlers()
    if (handlers.length === 0) return null

    const types = dataTransferTypes(transfer)
    const context: EditorPasteContext = {
      dataTransfer: transfer,
      files: Array.from(transfer.files ?? []),
      internal,
      languageId: this.options.getLanguageId(),
      source,
      targets,
      text,
      types,
    }
    for (const handler of handlers) {
      if (!pasteHandlerMatchesTypes(handler, types)) continue

      const fragments = handler.handlePaste(context)
      if (fragments && fragments.length === targets.length) return fragments
    }

    return null
  }

  private pasteTargets(): readonly EditorPasteTarget[] {
    const session = this.session
    if (!session) return []

    const snapshot = session.getSnapshot()
    return this.resolvedSelections().map((selection) => ({
      end: selection.endOffset,
      start: selection.startOffset,
      text: readPieceTableTextRange(snapshot, selection.startOffset, selection.endOffset),
    }))
  }

  /**
   * Claims a drag while it is over the text.
   *
   * A browser delivers a drop only to an element that has claimed the drag on its way past, and
   * nothing here is natively a drop target — so without this the handler below never runs at all,
   * and the pointer reads as "no drop" the whole way across the editor. A document that cannot be
   * edited leaves the drag unclaimed rather than accepting one it would then have to discard.
   */
  private handleDragOver = (event: DragEvent): void => {
    if (!this.session) return
    if (!this.options.canEditDocument()) return

    event.preventDefault()
    // Text arriving from outside brings no cursor of its own, so the editor lends it one: without a
    // mark on the spot the pointer has picked out, a drop is aimed by guesswork.
    const position = this.textPositionFromMouseEvent(event)
    if (position) {
      this.syncCustomSelectionHighlight(position.offset, position.offset, position.affinity)
    }
    // Never `move`: the text belongs to whatever the drag came from, and telling that source to take
    // it away is a deletion in a document this editor does not own.
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
  }

  /** Gives the caret back to the selection once a drag the editor was aiming for goes elsewhere. */
  private handleDragLeave = (event: DragEvent): void => {
    if (!this.session) return
    // Crossing between the rows inside the editor leaves each of them in turn, and the drag has not
    // gone anywhere.
    if (event.relatedTarget instanceof Node && this.options.el.contains(event.relatedTarget)) return

    this.syncSessionSelectionHighlight()
  }

  private handleDrop = this.traceInput('input.handleDrop', (event: DragEvent): void => {
    const session = this.session
    if (!session) return

    event.preventDefault()
    if (!this.options.canEditDocument()) return

    // Normalized for the same reason as the pasted payload above.
    const transfer = event.dataTransfer ?? null
    const text = normalizeLineEndings(dropPlainText(event))
    if (text.length === 0 && !this.hasPasteHandlerForTransfer(transfer)) {
      // The drag was claimed on its way across the text, whatever it turned out to be carrying, and
      // claiming it put a caret under the pointer to aim the drop with. Nothing else takes that
      // caret back down: the drop element is the one element a browser never fires dragleave at,
      // so a drop that inserts nothing would leave the caret standing where the pointer left it
      // while the selection it is drawn instead of is somewhere else entirely.
      this.syncSessionSelectionHighlight()
      return
    }

    const position = this.textPositionFromMouseEvent(event)
    if (!position) {
      this.syncSessionSelectionHighlight()
      return
    }

    const { offset } = position
    // Handlers read a drop as they read a paste, so a dragged file row can land as a mention.
    const handled = this.handledPasteFragments(transfer, text, false, 'drop', [
      { start: offset, end: offset, text: '' },
    ])
    if (!handled && text.length === 0) {
      this.syncSessionSelectionHighlight()
      return
    }

    this.transitionInputState({ text, type: 'drop-pending' })
    const start = eventStartMs(event)
    const selectionChange = session.setSelection(offset, offset, { affinity: position.affinity })
    this.markSessionSelectionForNextInput()
    // After the caret has been put where the text landed, which is the range this insertion runs
    // over: text dropped into a placeholder or a tag name is that name changing like any other.
    const textChange = handled
      ? this.applyDistributedPaste(session, handled, this.resolvedSelections())
      : (this.mirroredEdit(session, offset, offset, text) ?? session.applyText(text))
    const change = mergeChangeTimings(textChange, selectionChange)
    this.transitionInputState({ type: 'transaction-committed' })
    this.applyChange(change, 'input.drop', start, {
      revealBlock: pasteRevealBlock(text),
      revealOffset: this.primarySelectionHeadOffset(change),
    })
  })

  private handleCopy = (event: ClipboardEvent): void => {
    const payload = this.clipboardPayload()
    if (!payload) return
    if (!event.clipboardData) return

    writeClipboardPayload(event.clipboardData, payload.text, payload.metadata)
    this.writeRichTextPayload(event.clipboardData, payload)
    event.preventDefault()
  }

  private writeRichTextPayload(data: DataTransfer, payload: ClipboardPayload): void {
    const html = richTextForCopy({
      font: readRichTextFont(this.options.el),
      fragments: payload.fragments,
      theme: this.options.getEditorTheme(),
      tokens: this.options.getSyntaxTokens(),
    })
    if (html) data.setData('text/html', html)
  }

  /**
   * Cut, which the browser cannot do for us: the element the keystroke lands on holds no document
   * text, so the native gesture has nothing to take away and nothing to remove.
   */
  private handleCut = this.traceInput('input.handleCut', (event: ClipboardEvent): void => {
    const session = this.session
    if (!session) return
    if (!event.clipboardData) return
    if (!this.options.canEditDocument()) return

    const start = eventStartMs(event)
    const selectionChange = this.selectionChangeBeforeEdit()
    const payload = this.clipboardPayload()
    if (!payload) return

    writeClipboardPayload(event.clipboardData, payload.text, payload.metadata)
    event.preventDefault()
    const change = payload.metadata.pasteOnNewLine
      ? this.deleteCaretLines(session)
      : (this.mirrorSelectionDelete(session) ?? session.deleteSelection())
    this.applyChange(mergeChangeTimings(change, selectionChange), 'input.cut', start)
  })

  /** Removal half of a cut that took whole lines, including the line-joining terminators. */
  private deleteCaretLines(session: DocumentSession): DocumentSessionChange {
    const action = editActionForCommand(
      'editor.action.deleteLines',
      session.getTextSnapshot(),
      this.resolvedSelections(),
      { languageId: this.options.getLanguageId(), tabSize: this.options.tabSize },
    )
    return session.applyEdits(action.edits, { selections: action.selections })
  }

  private applyPaste(
    session: DocumentSession,
    text: string,
    metadata: ClipboardMetadata | null,
  ): DocumentSessionChange {
    const resolved = this.resolvedSelections()
    if (metadata?.pasteOnNewLine && resolved.every((selection) => selection.collapsed)) {
      // A payload taken off several carets is both things at once — line-shaped, and one fragment
      // per caret — and read as only the first of them every caret takes the whole of it, which
      // grows the document by the square of the cursor count. The fragments are what the copy was
      // built to hand back, so they are handed back here, each to the line its caret is on.
      const lines = this.caretLines(resolved)
      if (lines.length > 1 && metadata.perSelection.length === lines.length) {
        return this.applyDistributedLinePaste(session, metadata.perSelection, lines)
      }

      return this.applyLinePaste(session, text, resolved)
    }
    // Cursor i takes fragment i only while the counts still line up. Under any other count the
    // fragments no longer describe these cursors, and handing them out anyway would scatter the
    // payload; the whole text at every cursor is then the only honest reading of it.
    if (metadata && resolved.length > 1 && metadata.perSelection.length === resolved.length) {
      return this.applyDistributedPaste(session, metadata.perSelection, resolved)
    }

    // A payload pasted over a placeholder is that placeholder being filled in, by a gesture rather
    // than a keystroke; the copies of it have to be rewritten from the text it leaves behind either
    // way, and an unmirrored paste takes their anchors with it.
    const only = resolved.length === 1 ? resolved[0] : null
    const mirrored = only
      ? this.mirroredEdit(session, only.startOffset, only.endOffset, text)
      : null

    return mirrored ?? applyPasteText(session, text)
  }

  /**
   * A payload copied off carets is a set of lines, so it lands as lines: at the start of the line
   * each caret is on rather than splicing itself into the middle of whatever word the caret is in.
   */
  private applyLinePaste(
    session: DocumentSession,
    text: string,
    resolved: readonly ResolvedSelection[],
  ): DocumentSessionChange {
    const starts = this.caretLines(resolved).map((line) => line.start)
    const edits = starts.map((start) => ({ from: start, text, to: start }))
    const selections = starts.map((start, index) => {
      const caret = start + text.length * (index + 1)
      return { anchor: caret, affinity: 'after' as const, head: caret }
    })
    return applyPasteEdits(session, edits, selections)
  }

  /**
   * The same distribution as below, aimed at line starts rather than at the cursors themselves.
   *
   * Splicing each fragment in where its caret happens to stand would put a whole line into the
   * middle of the word the caret is in — the very thing the line paste above exists to avoid — and
   * the fragments were taken off lines to begin with.
   */
  private applyDistributedLinePaste(
    session: DocumentSession,
    texts: readonly string[],
    lines: readonly NavigationLine[],
  ): DocumentSessionChange {
    const edits: TextEdit[] = []
    const selections: DocumentSessionSelectionRange[] = []
    let shift = 0
    for (const [index, line] of lines.entries()) {
      const fragment = texts[index] ?? ''
      edits.push({ from: line.start, text: fragment, to: line.start })
      const caret = line.start + shift + fragment.length
      selections.push({ anchor: caret, affinity: 'after', head: caret })
      shift += fragment.length
    }

    return applyPasteEdits(session, edits, selections)
  }

  private applyDistributedPaste(
    session: DocumentSession,
    texts: readonly string[],
    resolved: readonly ResolvedSelection[],
  ): DocumentSessionChange {
    const edits: TextEdit[] = []
    const selections: DocumentSessionSelectionRange[] = []
    // Every edit is expressed against the document as it stands now, but the carets left behind are
    // read back off the document the batch produces, so they carry what the earlier ones shifted.
    let shift = 0
    for (const [index, selection] of resolved.entries()) {
      const fragment = texts[index] ?? ''
      edits.push({ from: selection.startOffset, text: fragment, to: selection.endOffset })
      const caret = selection.startOffset + shift + fragment.length
      selections.push(selectionOffsetsWithAffinity(selection, caret, caret))
      shift += fragment.length - (selection.endOffset - selection.startOffset)
    }

    return applyPasteEdits(session, edits, selections)
  }

  /**
   * Holds back a keystroke an input method is in the middle of, before anything bound to keys sees
   * it.
   *
   * While a candidate is being assembled the key is the IME's: Backspace takes a character off the
   * candidate, the arrows walk the candidate list, Enter accepts one. None of that is the document's,
   * and a chord that fires anyway edits text the reader is not even looking at. The chords are
   * registered on this element with the element being composed in underneath it, so the capture
   * phase here is the last point where one decision can still hold the key back from all of them —
   * a check inside each command would be a rule every command ever added has to remember. The
   * default action is deliberately untouched, since the IME's own handling of the key is the whole
   * reason for holding it.
   */
  private holdKeyForComposition = (event: KeyboardEvent): void => {
    if (!event.isComposing && !this.inputState.compositionActive) return

    event.stopPropagation()
  }

  /**
   * A key pressed somewhere that will never produce an input event of its own.
   *
   * The hidden input is left alone here: a key that lands on it reaches the document either as a
   * `beforeinput` the editor can read, or as a change to the element's value that the diff reads
   * back. Both routes describe what happened; `event.key` only describes what was pressed, which is
   * why waiting on one to decide about the other was a race worth deleting rather than tuning.
   */
  private handleKeyDown = this.traceInput('input.keydownFallback', (event: KeyboardEvent): void => {
    const session = this.session
    if (!session) return
    if (!this.options.canEditDocument()) return
    if (event.target === this.options.view.inputElement) return

    const typedText = keyboardFallbackText(event)
    if (typedText === null) return
    if (this.inputState.compositionActive) return

    event.preventDefault()
    this.applyKeyboardText(typedText, eventStartMs(event))
    // The next keystroke belongs on the input, where the browser can describe it properly.
    this.options.view.focusInput()
  })

  private applyKeyboardText(text: string, start: number): void {
    const session = this.session
    if (!session) return
    if (!this.options.canEditDocument()) return

    const selectionChange = measureEditorPerformance('input.selectionChangeBeforeEdit', () =>
      this.selectionChangeBeforeEdit(),
    )
    const textChange = measureEditorPerformance('session.applyText', () =>
      this.applyTypedText(session, text),
    )
    this.transitionInputState({ type: 'transaction-committed' })
    this.applyChange(
      mergeChangeTimings(textChange, selectionChange),
      'input.keydownFallback',
      start,
    )
  }

  /**
   * Writes a deduced edit into the document, around every caret rather than only the one the diff
   * was measured at: the counts say how far either side of a selection the replacement reaches, and
   * a document with several carets is holding several of them.
   */
  private applyDeducedInput(
    session: DocumentSession,
    deduced: DeducedInputEdit,
    start: number,
  ): void {
    this.transitionInputState({ text: deduced.text, type: 'deduced-input-pending' })
    const selectionChange = measureEditorPerformance('input.selectionChangeBeforeEdit', () =>
      this.selectionChangeBeforeEdit(),
    )
    // Plain insertion is left to the typing path, so text that arrived without a readable event
    // still closes a bracket, fills a snippet stop and carries a rename the way typing it would.
    // Anything reaching past the selection is a range edit instead, including the empty text that
    // means the selection itself was taken away.
    const textChange =
      deduced.text.length > 0 &&
      deduced.replacePrevCharCnt === 0 &&
      deduced.replaceNextCharCnt === 0
        ? measureEditorPerformance('session.applyText', () =>
            this.applyTypedText(session, deduced.text),
          )
        : this.replaceAroundSelections(session, deduced)
    this.transitionInputState({ type: 'transaction-committed' })
    this.applyChange(mergeChangeTimings(textChange, selectionChange), 'input.deducedText', start)
  }

  private replaceAroundSelections(
    session: DocumentSession,
    deduced: DeducedInputEdit,
  ): DocumentSessionChange {
    const snapshot = session.getSnapshot()
    const resolved = session
      .getSelections()
      .selections.map((selection) => resolveSelection(snapshot, selection))
      .toSorted((left, right) => left.startOffset - right.startOffset)
    const edits: TextEdit[] = []
    const selections: DocumentSessionSelectionRange[] = []
    // Same accounting as a multi-caret paste: every range is expressed against the document as it
    // stands, and every caret against the one the batch produces.
    let shift = 0
    // A rewritten word reaches further back than the gap between two carets standing inside it, and
    // a batch holding two edits over the same characters is refused outright — which would throw the
    // correction away entirely rather than apply it imperfectly. Each caret takes only what the one
    // in front of it left, so the text is replaced once and every caret still gets the insertion.
    let replacedThrough = 0
    // A soft keyboard deletes by rewriting the text around the caret, and a chip goes whole there too.
    const atomic = deduced.text.length === 0 ? this.options.view.atomicRanges() : []
    for (const selection of resolved) {
      const reached = widenOverAtomicRanges(atomic, {
        start: selection.startOffset - deduced.replacePrevCharCnt,
        end: selection.endOffset + deduced.replaceNextCharCnt,
      })
      const from = clamp(reached.start, replacedThrough, snapshot.length)
      const to = clamp(reached.end, from, snapshot.length)
      edits.push({ from, text: deduced.text, to })
      const caret = from + shift + deduced.text.length
      selections.push(selectionOffsetsWithAffinity(selection, caret, caret))
      shift += deduced.text.length - (to - from)
      replacedThrough = to
    }

    return session.applyEdits(edits, { selections })
  }

  /**
   * A composition commits over the range it started from. Only the written selection is plain
   * composed text; a range behind the caret is a correction, rewritten around every caret, and
   * neither is typed text, so neither closes a bracket.
   */
  private commitComposition(
    text: string,
    range: { readonly start: number; readonly end: number } | null,
    start: number,
  ): void {
    const written = this.hiddenInputContent
    const plain =
      !range || (range.start === written.selectionStart && range.end === written.selectionEnd)
    // Nothing to write, but the input may no longer hold what the document does: an abandoned
    // composition over a selection took that selection out of the EditContext's text.
    if (plain && text.length === 0) {
      this.refreshHiddenInputContent()
      return
    }
    if (plain) {
      this.applyCompositionText(text, start)
      return
    }

    const session = this.session
    if (!session) return
    if (!this.options.canEditDocument()) return

    this.transitionInputState({ text, type: 'composition-pending' })
    const selectionChange = this.selectionChangeBeforeEdit()
    const edit = textUpdateEdit(written, { text, rangeStart: range.start, rangeEnd: range.end })
    const textChange = this.replaceAroundSelections(session, edit)
    this.transitionInputState({ type: 'transaction-committed' })
    this.applyChange(mergeChangeTimings(textChange, selectionChange), 'input.composition', start)
  }

  private applyCompositionText(text: string, start: number): void {
    const session = this.session
    if (!session) return
    if (!this.options.canEditDocument()) return
    if (text.length === 0) return

    this.transitionInputState({ text, type: 'composition-pending' })
    const selectionChange = measureEditorPerformance('input.selectionChangeBeforeEdit', () =>
      this.selectionChangeBeforeEdit(),
    )
    const textChange = measureEditorPerformance('session.applyText', () => session.applyText(text))
    this.transitionInputState({ type: 'transaction-committed' })
    this.applyChange(mergeChangeTimings(textChange, selectionChange), 'input.composition', start)
  }

  private applyIndentToSession(): DocumentSessionChange {
    const session = this.session
    if (!session) throw new Error('missing editor session')
    if (this.shouldInsertLiteralTab()) return session.applyText('\t')
    return session.indentSelection('\t')
  }

  private shouldInsertLiteralTab(): boolean {
    const session = this.session
    if (!session) return false

    const snapshot = session.getSnapshot()
    const selections = session.getSelections().selections
    return selections.every((selection) => resolveSelection(snapshot, selection).collapsed)
  }

  private cursorSelectionByDisplayRows(
    selection: ResolvedSelection,
    rowDelta: -1 | 1,
  ): {
    readonly anchor: number
    readonly affinity: SelectionAffinity
    readonly goal: SelectionGoalValue
    readonly sourceAffinity: SelectionAffinity
    readonly sourceHead: number
  } {
    const goal = verticalMoveGoal(
      selection.goal,
      selection.headOffset,
      selection.affinity,
      this.options.view,
    )
    const target = this.options.view.verticalCaretTarget(
      selection.headOffset,
      selection.affinity,
      rowDelta,
      goal,
    )
    return {
      anchor: target.offset,
      affinity: target.affinity,
      goal,
      sourceAffinity: selection.affinity,
      sourceHead: selection.headOffset,
    }
  }

  private resolvedSelections(): readonly ResolvedSelection[] {
    const session = this.session
    if (!session) return []

    const snapshot = session.getSnapshot()
    return session
      .getSelections()
      .selections.map((selection) => resolveSelection(snapshot, selection))
  }

  /** The cursor a gesture that ends up with one selection continues from. */
  private primaryResolvedSelection(): ResolvedSelection | null {
    const session = this.session
    if (!session) return null

    const resolved = this.resolvedSelections()
    return resolved[lastAddedSelectionIndex(session.getSelections())] ?? resolved[0] ?? null
  }

  private addNextExactOccurrence(): OccurrenceSelectionChange | null {
    const session = this.session
    if (!session) return null

    const selections = session.getSelections()
    const resolved = this.resolvedSelections()
    const source = resolved[lastAddedSelectionIndex(selections)] ?? resolved.at(-1)
    if (!source) return null

    // A run started on a bare caret is a rename in the making, and the word the caret sat in is the
    // whole of what the user meant: without the boundaries, `id` also claims the `id` inside
    // `width` and `hidden`, and the next keystroke overwrites them all.
    const wholeWord =
      this.occurrenceRunFor(selections)?.wholeWord ?? (resolved.length === 1 && source.collapsed)
    const result = this.nextExactOccurrence(session, resolved, source, wholeWord)
    if (!result) return null

    this.occurrenceRun = { selections: session.getSelections(), wholeWord }
    return result
  }

  private occurrenceRunFor(selections: SelectionSet<PieceTableAnchor>): OccurrenceRun | null {
    const run = this.occurrenceRun
    if (!run || run.selections !== selections) return null
    return run
  }

  private nextExactOccurrence(
    session: DocumentSession,
    resolved: readonly ResolvedSelection[],
    source: ResolvedSelection,
    wholeWord: boolean,
  ): OccurrenceSelectionChange | null {
    const snapshot = session.getTextSnapshot()
    if (resolved.length === 1 && source.collapsed) {
      return this.selectCurrentWordForOccurrence(snapshot, source)
    }

    const query = occurrenceQueryForSelection(snapshot, source)
    if (!query) return null

    const selected = resolved.map((selection) => ({
      start: selection.startOffset,
      end: selection.endOffset,
    }))
    const range = findNextExactOccurrenceFromRange(
      snapshot,
      query.query,
      selected,
      query.range,
      wholeWord,
    )
    if (!range) return null

    const selections = [
      ...resolved.map((selection) => ({
        ...selectionOffsetsWithAffinity(selection, selection.anchorOffset, selection.headOffset),
        goal: selection.goal,
      })),
      generatedSelectionForRange(range),
    ]
    return {
      change: session.setSelections(selections),
      revealOffset: range.end,
    }
  }

  private occurrenceQueryForCurrentSelection(
    snapshot: TextReadSnapshot,
  ): OccurrenceQueryWithSources | null {
    const resolved = this.resolvedSelections()
    const source = resolved.find((selection) => !selection.collapsed) ?? resolved[0]
    if (!source) return null

    const query = occurrenceQueryForSelection(snapshot, source)
    if (!query) return null
    const sourcesByRange = new Map(
      resolved.map(
        (selection) =>
          [occurrenceRangeKey(selection.startOffset, selection.endOffset), selection] as const,
      ),
    )
    return { ...query, source, sourcesByRange }
  }

  private selectCurrentWordForOccurrence(
    snapshot: TextReadSnapshot,
    selection: ResolvedSelection,
  ): OccurrenceSelectionChange | null {
    const session = this.session
    if (!session) return null

    const range = wordRangeAt(snapshot, selection.headOffset)
    if (range.start === range.end) return null

    return {
      change: session.setSelections([
        selectionRangeWithAffinity(selection, range.start, range.end),
      ]),
      revealOffset: range.end,
    }
  }

  private clipboardPayload(): ClipboardPayload | null {
    const session = this.session
    if (!session) return null

    const snapshot = session.getSnapshot()
    const resolved = this.resolvedSelections()
    const selected = resolved.filter((selection) => !selection.collapsed)
    if (selected.length > 0) {
      const fragments = selected.map((selection, index) => ({
        startOffset: selection.startOffset,
        text: readPieceTableTextRange(snapshot, selection.startOffset, selection.endOffset),
        separator: index < selected.length - 1 ? '\n' : '',
      }))
      const perSelection = fragments.map((fragment) => fragment.text)
      return {
        fragments,
        metadata: { perSelection, pasteOnNewLine: false },
        text: perSelection.join('\n'),
      }
    }

    const lines = this.caretLines(resolved)
    if (lines.length === 0) return null
    // HTML omits only the final line terminator; plain text and metadata keep it for line paste.
    const fragments = lines.map((line, index) => ({
      startOffset: line.start,
      text: line.text,
      separator: index < lines.length - 1 ? '\n' : '',
    }))
    const perSelection = fragments.map((fragment) => `${fragment.text}\n`)
    return {
      fragments,
      metadata: { perSelection, pasteOnNewLine: true },
      text: perSelection.join(''),
    }
  }

  /** The lines the carets are on, in document order; two carets on one line answer for it once. */
  private caretLines(resolved: readonly ResolvedSelection[]): readonly NavigationLine[] {
    const lines: NavigationLine[] = []
    for (const selection of resolved) {
      const line = this.readLineAt(selection.headOffset)
      if (!line) continue
      if (lines.at(-1)?.start === line.start) continue

      lines.push(line)
    }

    return lines
  }

  private primarySelectionHeadOffset(change: DocumentSessionChange): number | undefined {
    const selection = change.selections.selections[0]
    if (!selection) return undefined

    return resolveSelection(change.snapshot, selection).headOffset
  }

  private syncSessionSelectionFromDom = (_event: Event): void => {
    if (!this.session) return
    if (!shouldSyncSessionSelectionFromDom(this.inputState, this.domSelectionContext())) return

    const start = nowMs()
    const change = this.updateSessionSelectionFromDom()
    if (!change) return

    this.markDomSelectionForNextInput()
    const timedChange = appendTiming(change, 'input.selection', start)
    this.options.getSessionOptions().onChange?.(timedChange)
    this.options.notifyViewContributions('selection', null)
    this.options.notifyChangeWithTiming(timedChange)
  }

  private updateSessionSelectionFromDom(): DocumentSessionChange | null {
    const session = this.session
    if (!session) return null

    const readStart = nowMs()
    const offsets = this.readDomSelectionOffsets()
    if (!offsets) return null

    this.syncCustomSelectionHighlight(offsets.anchorOffset, offsets.headOffset)
    return appendTiming(
      session.setSelection(offsets.anchorOffset, offsets.headOffset),
      'editor.readDomSelection',
      readStart,
    )
  }

  private selectionChangeBeforeEdit(): DocumentSessionChange | null {
    const source = selectionBeforeEditSource(this.inputState, this.domSelectionContext())
    if (source === 'hidden-input') {
      this.markHiddenInputSelectionForNextInput()
      return null
    }
    if (source === 'dom') return this.updateSessionSelectionFromDom()

    this.markDomSelectionForNextInput()
    return null
  }

  private readDomSelectionOffsets(): { anchorOffset: number; headOffset: number } | null {
    const selection = window.getSelection()
    if (!selection?.anchorNode || !selection.focusNode) return null

    const anchorOffset = this.domBoundaryToTextOffset(selection.anchorNode, selection.anchorOffset)
    const headOffset = this.domBoundaryToTextOffset(selection.focusNode, selection.focusOffset)
    if (anchorOffset === null || headOffset === null) return null

    return { anchorOffset, headOffset }
  }

  private syncCustomSelectionFromDom = (): void => {
    if (!this.session) return
    if (!shouldSyncCustomSelectionFromDom(this.inputState, this.domSelectionContext())) return

    const offsets = this.readDomSelectionOffsets()
    if (!offsets) return

    this.syncCustomSelectionHighlight(offsets.anchorOffset, offsets.headOffset)
  }

  private syncCustomSelectionHighlight(
    anchorOffset: number,
    headOffset: number,
    affinity: SelectionAffinity = 'after',
  ): void {
    this.options.view.setSelection(anchorOffset, headOffset, affinity)
    this.transitionInputState({ owner: 'dom', type: 'selection-reconciled' })
    // A drag paints from offsets it worked out for itself and never reaches
    // syncSessionSelectionHighlight, so without this the window would go stale for exactly the
    // selections a reader is most likely to want read back to them.
    this.refreshHiddenInputContent()
  }

  private isInputFocused(): boolean {
    return this.options.el.ownerDocument.activeElement === this.options.view.inputElement
  }

  private domSelectionContext(): { readonly hiddenInputFocused: boolean } {
    return {
      hiddenInputFocused: this.isInputFocused(),
    }
  }

  private hasFocusedExternalElement(): boolean {
    const activeElement = this.options.el.ownerDocument.activeElement
    if (!activeElement) return false
    if (activeElement === this.options.el.ownerDocument.body) return false
    if (activeElement === this.options.el.ownerDocument.documentElement) return false

    return !this.options.el.contains(activeElement)
  }

  private domBoundaryToTextOffset(node: Node, offset: number): number | null {
    const viewOffset = this.options.view.textOffsetFromDomBoundary(node, offset)
    if (viewOffset !== null) return viewOffset

    if (node === this.options.el)
      return elementBoundaryToTextOffset(offset, this.options.getTextSnapshot().length)
    return this.externalBoundaryToTextOffset(node, offset)
  }

  private textPositionFromMouseEvent(event: MouseEvent): VirtualizedTextHitPosition | null {
    return this.options.view.textPositionFromPoint(event.clientX, event.clientY)
  }

  private externalBoundaryToTextOffset(node: Node, offset: number): number | null {
    if (node.contains(this.options.el)) {
      const child = childContainingNode(node, this.options.el)
      const childIndex = child ? childNodeIndex(node, child) : -1
      if (childIndex === -1) return null
      return elementBoundaryToTextOffset(
        offset <= childIndex ? 0 : 1,
        this.options.getTextSnapshot().length,
      )
    }

    const position = node.compareDocumentPosition(this.options.el)
    if ((position & Node.DOCUMENT_POSITION_FOLLOWING) !== 0) return 0
    if ((position & Node.DOCUMENT_POSITION_PRECEDING) !== 0)
      return this.options.getTextSnapshot().length
    return null
  }
}

/**
 * Where the wrapped text ends up, `index` counting the wraps ahead of it in document order.
 *
 * Each of those has already pushed this one along by a whole pair, and its own opener pushes it along
 * by one more. The selection stops short of its own closer, so a second wrap nests inside the first
 * instead of swallowing it, and keeps its direction so shift+arrow goes on from the same end.
 */
function surroundedSelection(
  selection: ResolvedSelection,
  opening: EditorAutoClosingPair,
  index: number,
): EditorSelectionRange {
  const shift = index * (opening.open.length + opening.close.length) + opening.open.length
  const start = selection.startOffset + shift
  const end = selection.endOffset + shift

  return selectionRangeWithAffinity(selection, start, end)
}

function generatedSelectionForRange(range: TextOffsetRange): DocumentSessionSelectionRange {
  return { anchor: range.start, affinity: 'after', head: range.end }
}

function selectionsWithLastAddedAtEnd(
  selections: readonly EditorSelectionRange[],
  lastAddedIndex: number | undefined,
): readonly EditorSelectionRange[] {
  // Session selection ids encode creation order. Replaying the saved last-added range last restores
  // that identity; callers still use the untouched array's first item for primary reveal semantics.
  if (lastAddedIndex === undefined || lastAddedIndex === selections.length - 1) return selections
  if (lastAddedIndex < 0 || lastAddedIndex >= selections.length) return selections

  const lastAdded = selections[lastAddedIndex]
  if (!lastAdded) return selections
  return selections.filter((_selection, index) => index !== lastAddedIndex).concat(lastAdded)
}

function occurrenceSelectionForRange(
  query: OccurrenceQueryWithSources,
  range: TextOffsetRange,
): DocumentSessionSelectionRange {
  const exactSource = query.sourcesByRange.get(occurrenceRangeKey(range.start, range.end))
  if (exactSource) {
    return {
      ...selectionRangeWithAffinity(exactSource, range.start, range.end),
      goal: exactSource.goal,
    }
  }
  if (range.start === query.range.start && range.end === query.range.end) {
    return {
      ...selectionRangeWithAffinity(query.source, range.start, range.end),
      goal: query.source.goal,
    }
  }

  return generatedSelectionForRange(range)
}

function occurrenceRangeKey(start: number, end: number): string {
  return `${start}:${end}`
}

function mouseTextMoveSelection(
  drag: MouseTextMoveDrag,
  range: TextOffsetRange,
): SelectionOffsetsWithAffinity {
  if (drag.sourceReversed) {
    return { anchor: range.end, affinity: drag.sourceAffinity, head: range.start }
  }

  return { anchor: range.start, affinity: drag.sourceAffinity, head: range.end }
}

/** What tells one cursor from another when a set of them is compared across a change. */
function selectionKey(selection: ResolvedSelection): string {
  return `${selection.anchorOffset}:${selection.headOffset}:${selection.affinity}`
}

/** An empty range is asked for often enough here — a stop with no default — to answer for one. */
function rangeText(read: (from: number, to: number) => string, range: SnippetStopRange): string {
  return range.end <= range.start ? '' : read(range.start, range.end)
}

function mouseSelectionTimingName(granularity: MouseSelectionGranularity): string {
  if (granularity === 'line') return 'input.tripleClick'
  if (granularity === 'word') return 'input.doubleClick'
  return 'input.selection'
}

/**
 * Whether any of a line falls inside the rectangle's band of columns, given where the band's two
 * edges land once that line's tabs have been accounted for.
 */
function columnBandCoversLine(
  rectangle: ColumnSelectionRectangle,
  fromColumn: number,
  toColumn: number,
): boolean {
  if (rectangle.fromColumn < rectangle.toColumn) {
    return fromColumn <= rectangle.toColumn && toColumn >= rectangle.fromColumn
  }
  if (rectangle.fromColumn > rectangle.toColumn) {
    return toColumn <= rectangle.fromColumn && fromColumn >= rectangle.toColumn
  }

  // A band with no width is a click, not a drag, and every line it passes through takes a caret.
  return true
}

function columnSelectionRowDelta(command: EditorCommandId, pageRows: number): number {
  if (command === 'cursorColumnSelectUp') return -1
  if (command === 'cursorColumnSelectDown') return 1
  if (command === 'cursorColumnSelectPageUp') return -pageRows
  return pageRows
}

function selectionRevealOptions(
  change: DocumentSessionChange,
  options: SessionChangeOptions | undefined,
): SessionChangeOptions | undefined {
  if (!options) return undefined
  if (options.revealAffinity !== undefined) return options

  const revealOffset = options.revealOffset
  if (revealOffset === undefined) return options

  let affinity: SelectionAffinity | undefined
  for (const selection of change.selections.selections) {
    const resolved = resolveSelection(change.snapshot, selection)
    if (resolved.headOffset !== revealOffset) continue
    if (affinity && affinity !== resolved.affinity) return options
    affinity = resolved.affinity
  }
  if (!affinity) return options
  return { ...options, revealAffinity: affinity }
}

function survivingPrimarySelectionAffinity(
  change: DocumentSessionChange,
  primary: DocumentSessionSelectionRange | undefined,
  revealOffset: number | undefined,
): SelectionAffinity | undefined {
  if (!primary) return undefined

  const head = primary.head ?? primary.anchor
  if (head !== revealOffset) return undefined

  const affinity = primary.affinity ?? 'after'
  for (const selection of change.selections.selections) {
    const resolved = resolveSelection(change.snapshot, selection)
    if (resolved.anchorOffset !== primary.anchor) continue
    if (resolved.headOffset !== head) continue
    if (resolved.affinity === affinity) return affinity
  }
  return undefined
}

function pasteRevealBlock(text: string): SessionChangeOptions['revealBlock'] {
  if (text.includes('\n') || text.includes('\r')) return 'end'
  return 'nearest'
}

function editActionForSession(
  command: EditorEditActionCommandId | EditorDocumentSelectionEditCommandId,
  session: DocumentSession,
  selections: readonly ResolvedSelection[],
  options: EditorEditActionOptions,
): EditorEditActionResult {
  const snapshot = session.getTextSnapshot()
  if (isEditorDocumentSelectionEditCommand(command)) {
    return documentSelectionEditForCommand(command, snapshot, selections, options)
  }
  if (command === 'editor.action.trimTrailingWhitespace')
    return trimTrailingWhitespaceAction(snapshot)

  return editActionForCommand(command, snapshot, selections, options)
}

function applyPasteText(session: DocumentSession, text: string): DocumentSessionChange {
  session.breakTypingRun()
  const change = session.applyText(text)
  session.breakTypingRun()
  return change
}

function applyPasteEdits(
  session: DocumentSession,
  edits: readonly TextEdit[],
  selections: readonly DocumentSessionSelectionRange[],
): DocumentSessionChange {
  session.breakTypingRun()
  const change = session.applyEdits(edits, { selections })
  session.breakTypingRun()
  return change
}

function dropPlainText(event: DragEvent): string {
  const transfer = event.dataTransfer
  if (!transfer) return ''

  const plainText = transfer.getData('text/plain')
  if (plainText.length > 0) return plainText
  return transfer.getData('text')
}

/**
 * An EditContext host has no value for a screen reader, so the window is written into it as text and
 * the caret into the document selection: the two things a textarea shows a reader on its own.
 * Taking the document selection is only right while the element holds focus.
 */
function writeAccessibleWindow(input: HTMLElement, content: HiddenInputState): void {
  if (input.textContent !== content.value) input.textContent = content.value
  if (input.ownerDocument.activeElement !== input) return

  const selection = input.ownerDocument.getSelection()
  const node = input.firstChild
  if (!selection) return
  if (!node) {
    selection.collapse(input, 0)
    return
  }
  const backward = 'direction' in content && content.direction === 'backward'
  const anchor = backward ? content.selectionEnd : content.selectionStart
  const focus = backward ? content.selectionStart : content.selectionEnd
  selection.setBaseAndExtent(node, anchor, node, focus)
}

function beforeInputText(event: InputEvent): string | null {
  // A textarea's Enter is insertLineBreak; an EditContext host's is insertParagraph.
  if (event.inputType === 'insertLineBreak') return '\n'
  if (event.inputType === 'insertParagraph') return '\n'
  if (event.inputType === 'insertText') return event.data ?? ''
  if (event.inputType === 'insertFromComposition') return event.data ?? ''
  return null
}
