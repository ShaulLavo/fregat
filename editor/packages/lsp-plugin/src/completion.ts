import type { SelectionAffinity, TextEdit } from '@singapore-editor/core/document'
import type {
  EditorContributionChange,
  EditorEditContributionContext,
  EditorSelectionRange,
} from '@singapore-editor/core/extensions'
import { createEditorCapabilityToken } from '@singapore-editor/core/extensions'
import { lspPositionToOffsetInSnapshot, type LspTextDocumentSnapshot } from '@singapore-editor/lsp'
import type * as lsp from 'vscode-languageserver-protocol'
import {
  parseSnippet,
  snippetInitialSelection,
  type ParsedSnippet,
  type SnippetRange,
} from '@singapore-editor/core/extensions'

import { createAnchoredSurface } from '@singapore-editor/plugin-ui/anchored-surface'
import { rangeAroundOffset, textReadSnapshotOf } from './sourceText'
import { fuzzyMatch, looseFuzzyMatch, type FuzzyMatch } from './fuzzyMatch'

export const LANGUAGE_SERVER_COMPLETION_EDIT_FEATURE_ID = 'editor.lsp-plugin.completion-edit'

export const COMPLETION_REQUEST_DEBOUNCE_MS = 80

export type LanguageServerCompletionEditFeature = {
  applyCompletion(application: LanguageServerCompletionApplication): boolean
}

export const LANGUAGE_SERVER_COMPLETION_EDIT_FEATURE =
  createEditorCapabilityToken<LanguageServerCompletionEditFeature>(
    LANGUAGE_SERVER_COMPLETION_EDIT_FEATURE_ID,
  )

export type LanguageServerSnippetMirror = {
  readonly start: number
  readonly end: number
  /** Renders this copy from the stop's text; without one the copy holds that text verbatim. */
  readonly transform?: (value: string) => string
}

export type LanguageServerSnippetStop = {
  readonly start: number
  readonly end: number
  readonly mirrors?: readonly LanguageServerSnippetMirror[]
}

export type LanguageServerCompletionApplication = {
  readonly edits: readonly TextEdit[]
  readonly selection: EditorSelectionRange
  /**
   * Tab stops to cycle with Tab, each with the copies of it the snippet writes elsewhere, when the
   * accepted item was a snippet the host has something to track.
   */
  readonly snippetStops?: readonly LanguageServerSnippetStop[]
}

/** `3` is the kind reserved for asking a server again about a list it marked incomplete. */
export type LanguageServerCompletionTrigger = {
  readonly triggerKind: 1 | 2 | 3
  readonly triggerCharacter?: string
}

export type CompletionWidgetShowOptions = {
  readonly anchor: DOMRect
  readonly items: readonly lsp.CompletionItem[]
  readonly selectedIndex?: number
}

export type CompletionWidgetController = {
  show(options: CompletionWidgetShowOptions): void
  /** Moves a list already on screen to a new anchor, without rebuilding its rows. */
  reanchor(anchor: DOMRect): void
  hide(): void
  isVisible(): boolean
  containsTarget(target: EventTarget | null): boolean
  moveSelection(delta: number): void
  selectedItem(): lsp.CompletionItem | null
  dispose(): void
}

export type CompletionWidgetOptions = {
  readonly document: Document
  readonly themeSource: HTMLElement
  readonly classNamespace?: string
  onSelect(index: number): void
}

type CompletionWidgetClassNames = {
  readonly root: string
  readonly item: string
  readonly match: string
}

const COMPLETION_WIDGET_GAP_PX = 4
const COMPLETION_WIDGET_WIDTH_PX = 320
const COMPLETION_WIDGET_MAX_HEIGHT_PX = 280
const COMPLETION_WIDGET_MARGIN_PX = 12
const COMPLETION_WIDGET_CLASS_NAMESPACE = 'lsp-plugin'
const COMPLETION_TRIGGER_CHARACTERS = new Set(['.', '"', "'", '`', '/', '@', '<', '#'])
const COMPLETION_THEME_VARIABLES = [
  '--editor-background',
  '--editor-popup-background',
  '--editor-foreground',
  '--editor-caret-color',
] as const

export function createCompletionWidgetController(
  options: CompletionWidgetOptions,
): CompletionWidgetController {
  const classNames = completionWidgetClassNames(options.classNamespace)
  const element = createCompletionWidgetElement(options.document, classNames)
  options.document.body.append(element)
  const surface = createAnchoredSurface({
    element,
    anchorClassName: `${classNames.root}-anchor`,
    // Below the word, where the next thing typed continues it; above only when there is no room.
    preferredPlacement: 'bottom',
    alignment: 'start',
    gapPx: COMPLETION_WIDGET_GAP_PX,
    viewportMarginPx: COMPLETION_WIDGET_MARGIN_PX,
    maxHeightPx: COMPLETION_WIDGET_MAX_HEIGHT_PX,
  })

  let items: readonly lsp.CompletionItem[] = []
  let selectedIndex = 0
  let disposed = false

  const render = (): void => {
    element.replaceChildren()
    for (let index = 0; index < items.length; index += 1) {
      element.append(completionRowElement(element.ownerDocument, items[index]!, index, classNames))
    }
    syncSelectedRows(element, selectedIndex, classNames)
  }

  const show = (showOptions: CompletionWidgetShowOptions): void => {
    items = showOptions.items
    selectedIndex = clampIndex(showOptions.selectedIndex ?? 0, items.length)
    syncEditorThemeVariables(element, options.themeSource)
    render()
    element.hidden = items.length === 0
    // Placed once the rows are in and the list is visible: a hidden element measures as nothing,
    // and how tall it is decides whether it fits below the word.
    if (element.hidden) surface.release()
    else surface.place(showOptions.anchor)
  }

  const reanchor = (anchor: DOMRect): void => {
    if (element.hidden) return

    surface.place(anchor)
  }

  const hide = (): void => {
    element.hidden = true
    surface.release()
    element.replaceChildren()
    items = []
    selectedIndex = 0
  }

  const moveSelection = (delta: number): void => {
    if (items.length === 0) return

    selectedIndex = wrapIndex(selectedIndex + delta, items.length)
    syncSelectedRows(element, selectedIndex, classNames)
  }

  const selectedItem = (): lsp.CompletionItem | null => items[selectedIndex] ?? null

  const handlePointerDown = (event: PointerEvent): void => {
    const row = completionRowTarget(event.target, classNames)
    if (!row) return

    event.preventDefault()
    event.stopPropagation()
    selectedIndex = rowIndex(row)
    syncSelectedRows(element, selectedIndex, classNames)
    options.onSelect(selectedIndex)
  }

  element.addEventListener('pointerdown', handlePointerDown)

  const dispose = (): void => {
    if (disposed) return

    disposed = true
    element.removeEventListener('pointerdown', handlePointerDown)
    surface.dispose()
    element.remove()
  }

  return {
    show,
    reanchor,
    hide,
    isVisible: () => !element.hidden,
    containsTarget: (target) => target instanceof Node && element.contains(target),
    moveSelection,
    selectedItem,
    dispose,
  }
}

/**
 * A server's answer, with the one flag on it that outlives the request.
 *
 * `isIncomplete` is the server saying it truncated its answer for the word it was asked about — the
 * large member sets and auto-import lists are always sent this way — so a list that stays on screen
 * while the user keeps typing has to be asked again rather than narrowed.
 */
export type CompletionListResult = {
  readonly items: readonly lsp.CompletionItem[]
  readonly isIncomplete: boolean
}

export function completionListResult(
  result: lsp.CompletionList | readonly lsp.CompletionItem[] | null,
): CompletionListResult {
  if (!result) return { items: [], isIncomplete: false }
  if (isCompletionList(result))
    return { items: result.items ?? [], isIncomplete: result.isIncomplete === true }
  return { items: result, isIncomplete: false }
}

export function completionTriggerFromChange(
  change: EditorContributionChange | null,
): LanguageServerCompletionTrigger | null {
  if (!change || change.kind !== 'edit') return null
  if (change.edits.length !== 1) return null

  const edit = change.edits[0]
  if (!edit) return null

  const character = typedCharacter(edit)
  if (!character) return null
  if (COMPLETION_TRIGGER_CHARACTERS.has(character)) {
    return { triggerKind: 2, triggerCharacter: character }
  }
  if (isIdentifierCharacter(character)) return { triggerKind: 1 }
  return null
}

/**
 * The character the user typed, out of an edit that may have written more than it.
 *
 * A delimiter that closes itself arrives as the pair in a single insertion with the caret left
 * between the halves — which is exactly the keystroke a path or a member list is wanted for, so
 * reading only the one-character edits would leave the quote triggers unreachable while the editor
 * completes them. An insertion of one trigger character twice over is the whole of that shape;
 * anything else two characters wide is text arriving from somewhere other than the keyboard.
 */
function typedCharacter(edit: TextEdit): string | null {
  if (edit.text.length === 1) return edit.text
  if (edit.from !== edit.to || edit.text.length !== 2) return null

  const opener = edit.text[0] ?? ''
  if (opener !== edit.text[1]) return null

  return COMPLETION_TRIGGER_CHARACTERS.has(opener) ? opener : null
}

/** The text a request went out with, which is the frame every range on an item is read in. */
export type CompletionApplicationDocument = {
  readonly document: LspTextDocumentSnapshot
  readonly offset: number
}

/**
 * The document an accepted item is applied against.
 *
 * `document` and `offset` are what the request went out with, and the item's ranges are positions
 * in that text. `caretOffset` and `caretAffinity` are where the caret has reached since — rarely the
 * same position, because the widget stays up while the user keeps typing.
 */
export type CompletionApplicationRequest = CompletionApplicationDocument & {
  readonly caretOffset: number
  readonly caretAffinity: SelectionAffinity
}

export function completionApplication(
  request: CompletionApplicationRequest,
  item: lsp.CompletionItem,
): LanguageServerCompletionApplication | null {
  const primary = completionPrimaryEdit(request, item)
  if (!primary) return null

  const additional = additionalCompletionEdits(request, item.additionalTextEdits ?? [])
  const edits = [primary.edit, ...additional]
  const head = completionSelectionHead(primary.edit, additional)
  const snippet = primary.snippet
  if (!snippet) {
    return { edits, selection: { anchor: head, head, affinity: request.caretAffinity } }
  }

  // A snippet's first placeholder is selected so the next keystroke replaces it; without a stop the
  // caret sits after the insertion exactly as a plain completion leaves it.
  const insertionOffset = head - primary.edit.text.length
  const first = snippetInitialSelection(snippet, insertionOffset)
  return {
    edits,
    selection: { anchor: first.start, head: first.end, affinity: request.caretAffinity },
    snippetStops: snippetStopRanges(snippet, insertionOffset),
  }
}

/**
 * Whether an item could be applied at all against the text it was answered for.
 *
 * The ranges an item carries are positions in that text, and one that spans lines or that the caret
 * was never inside describes a document this client did not ask about. Nothing downstream can rescue
 * such an item, so a row for it would be one the reader can press Enter on and get nothing for.
 */
export function completionItemApplies(
  request: CompletionApplicationDocument,
  item: lsp.CompletionItem,
): boolean {
  const textEdit = completionTextEdit(item)
  if (!textEdit) return true

  return completionEditRange(request, textEdit.range) !== null
}

export function completionAnchorRange(
  length: number,
  offset: number,
): { readonly start: number; readonly end: number } {
  if (length === 0) return { start: 0, end: 0 }

  const end = Math.max(1, Math.min(offset, length))
  return { start: end - 1, end }
}

export function createCompletionEditFeature(
  context: EditorEditContributionContext,
  timingName: string,
): LanguageServerCompletionEditFeature {
  return {
    applyCompletion(application: LanguageServerCompletionApplication): boolean {
      if (!context.hasDocument()) return false

      context.applyEdits(application.edits, timingName, application.selection)
      // Started after the edit so the ranges refer to the text now in the document. A host without
      // the hook simply leaves the caret on the first placeholder.
      if (application.snippetStops) context.startSnippetSession(application.snippetStops)
      context.focusEditor()
      return true
    },
  }
}

function createCompletionWidgetElement(
  document: Document,
  classNames: CompletionWidgetClassNames,
): HTMLDivElement {
  const element = document.createElement('div')
  element.className = classNames.root
  element.hidden = true
  element.setAttribute('role', 'listbox')
  Object.assign(element.style, {
    zIndex: '1001',
    width: `${COMPLETION_WIDGET_WIDTH_PX}px`,
    maxWidth: `calc(100vw - ${COMPLETION_WIDGET_MARGIN_PX * 2}px)`,
    maxHeight: `${COMPLETION_WIDGET_MAX_HEIGHT_PX}px`,
    overflowX: 'hidden',
    overflowY: 'auto',
    padding: '3px',
    border: '1px solid color-mix(in srgb, var(--editor-foreground, #d4d4d8) 22%, transparent)',
    borderRadius: '6px',
    boxSizing: 'border-box',
    background:
      'var(--editor-popup-background, color-mix(in srgb, var(--editor-background, #18181b) 96%, var(--editor-foreground, #e4e4e7) 4%))',
    color: 'var(--editor-foreground, #e4e4e7)',
    boxShadow: '0 12px 30px color-mix(in srgb, var(--editor-background, #000000) 60%, transparent)',
    font: '12px/1.35 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    userSelect: 'none',
    scrollbarGutter: 'stable',
  })
  return element
}

function completionRowElement(
  document: Document,
  item: lsp.CompletionItem,
  index: number,
  classNames: CompletionWidgetClassNames,
): HTMLDivElement {
  const row = document.createElement('div')
  row.className = classNames.item
  row.dataset.index = String(index)
  row.setAttribute('role', 'option')
  Object.assign(row.style, {
    display: 'grid',
    gridTemplateColumns: '44px minmax(0, 1fr) auto',
    alignItems: 'center',
    gap: '8px',
    minHeight: '24px',
    padding: '2px 7px',
    borderRadius: '4px',
    cursor: 'default',
    whiteSpace: 'nowrap',
  })
  row.append(
    completionKindElement(document, item.kind),
    completionLabelElement(document, item, classNames),
    completionDetailElement(document, item),
  )
  return row
}

function completionKindElement(
  document: Document,
  kind: lsp.CompletionItemKind | undefined,
): HTMLSpanElement {
  const element = document.createElement('span')
  element.textContent = completionKindLabel(kind)
  Object.assign(element.style, {
    minWidth: '0',
    overflow: 'hidden',
    color: 'color-mix(in srgb, var(--editor-foreground, #e4e4e7) 62%, transparent)',
    fontSize: '10px',
    textTransform: 'uppercase',
  })
  return element
}

function completionLabelElement(
  document: Document,
  item: lsp.CompletionItem,
  classNames: CompletionWidgetClassNames,
): HTMLSpanElement {
  const element = document.createElement('span')
  Object.assign(element.style, {
    minWidth: '0',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  })
  appendCompletionLabel(element, item.label, completionLabelMatches.get(item) ?? [], classNames)
  const detail = item.labelDetails?.detail
  if (detail) element.append(detail)
  return element
}

/**
 * The label, with each run of characters the filter matched marked up.
 *
 * A list that reorders itself as the user types owes them the reason it did: with nothing marked, an
 * entry that outranks the one above it looks arbitrary rather than earned.
 */
function appendCompletionLabel(
  element: HTMLElement,
  label: string,
  positions: readonly number[],
  classNames: CompletionWidgetClassNames,
): void {
  let plainStart = 0
  let cursor = 0
  while (cursor < positions.length) {
    const start = positions[cursor] ?? 0
    let end = start + 1
    while (positions[cursor + 1] === end) {
      end += 1
      cursor += 1
    }
    cursor += 1

    if (start > plainStart) element.append(label.slice(plainStart, start))
    element.append(
      completionMatchElement(element.ownerDocument, label.slice(start, end), classNames),
    )
    plainStart = end
  }
  if (plainStart < label.length) element.append(label.slice(plainStart))
}

function completionMatchElement(
  document: Document,
  text: string,
  classNames: CompletionWidgetClassNames,
): HTMLSpanElement {
  const element = document.createElement('span')
  element.className = classNames.match
  element.textContent = text
  Object.assign(element.style, {
    // The colour the caret is drawn in is the one the theme already means "you are here" by.
    color:
      'color-mix(in srgb, var(--editor-caret-color, #60a5fa) 80%, var(--editor-foreground, #e4e4e7))',
    fontWeight: '600',
  })
  return element
}

function completionDetailElement(document: Document, item: lsp.CompletionItem): HTMLSpanElement {
  const element = document.createElement('span')
  element.textContent = item.labelDetails?.description ?? item.detail ?? ''
  Object.assign(element.style, {
    minWidth: '0',
    maxWidth: '140px',
    overflow: 'hidden',
    color: 'color-mix(in srgb, var(--editor-foreground, #e4e4e7) 58%, transparent)',
    textOverflow: 'ellipsis',
  })
  return element
}

function syncSelectedRows(
  element: HTMLDivElement,
  selectedIndex: number,
  classNames: CompletionWidgetClassNames,
): void {
  const rows = element.querySelectorAll<HTMLElement>(`.${classNames.item}`)
  for (const row of rows) {
    const selected = rowIndex(row) === selectedIndex
    syncSelectedRow(row, selected)
    if (selected) scrollRowIntoView(element, row)
  }
}

/**
 * Keeps the focused row inside the box.
 *
 * A hundred rows are offered in a box a dozen of them fit in, and the widget never takes the focus,
 * so there is no scrollport the browser is moving on anyone's behalf: walking off the bottom edge —
 * or wrapping to the end with a single ArrowUp — would leave a list with no highlight in it while
 * Enter commits a row that was never on screen.
 */
function scrollRowIntoView(element: HTMLElement, row: HTMLElement): void {
  const top = row.offsetTop
  const bottom = top + row.offsetHeight
  if (top < element.scrollTop) element.scrollTop = top
  else if (bottom > element.scrollTop + element.clientHeight) {
    element.scrollTop = bottom - element.clientHeight
  }
}

function syncSelectedRow(row: HTMLElement, selected: boolean): void {
  row.setAttribute('aria-selected', selected ? 'true' : 'false')
  row.style.background = selected
    ? 'color-mix(in srgb, var(--editor-caret-color, #60a5fa) 26%, transparent)'
    : 'transparent'
}

function syncEditorThemeVariables(element: HTMLElement, source: HTMLElement): void {
  const style = source.ownerDocument.defaultView?.getComputedStyle(source)
  if (!style) return

  for (const variable of COMPLETION_THEME_VARIABLES) {
    const value = style.getPropertyValue(variable)
    if (value) {
      element.style.setProperty(variable, value)
      continue
    }
    element.style.removeProperty(variable)
  }
}

/** The item's own insertion, and the snippet it was expanded from when the item carried one. */
type CompletionInsertion = {
  readonly edit: TextEdit
  readonly snippet: ParsedSnippet | null
}

function completionPrimaryEdit(
  request: CompletionApplicationRequest,
  item: lsp.CompletionItem,
): CompletionInsertion | null {
  const textEdit = completionTextEdit(item)
  const range = textEdit
    ? completionEditRange(request, textEdit.range)
    : defaultCompletionReplacementRange(request.document, request.offset)
  if (!range) return null

  const source = textEdit ? textEdit.newText : (item.insertText ?? item.label)
  // Expanded against the document it is landing in, and once: the text that goes in and the offsets
  // the stops are reported at have to come from the same expansion or the caret lands off the
  // placeholder it is meant to select.
  const snippet =
    item.insertTextFormat === 2
      ? parseSnippet(source, {
          insertion: { textSnapshot: textReadSnapshotOf(request.document), offset: range.start },
        })
      : null

  return {
    snippet,
    edit: {
      from: range.start,
      // Whatever was typed since the request sits between the range's end and the caret, so the end
      // travels with the caret while the start — the word the server matched — stays where it is.
      to: Math.max(range.start, range.end + request.caretOffset - request.offset),
      text: snippet?.text ?? source,
    },
  }
}

function completionTextEdit(item: lsp.CompletionItem): lsp.TextEdit | null {
  const textEdit = item.textEdit
  if (!textEdit) return null
  if ('range' in textEdit) return textEdit
  // Of the two ranges an item may carry, `insert` stops at the caret while `replace` covers the
  // whole word it sits in. Insert would leave the tail of the word behind, which is neither what
  // the no-textEdit path below does nor what accepting mid-word is asking for.
  return { range: textEdit.replace, newText: textEdit.newText }
}

/**
 * The item's replacement range in offsets, or null when it describes a document we never asked
 * about: a range spanning lines, or one the caret was not inside, leaves nothing for the typed
 * characters to be measured against.
 */
function completionEditRange(
  request: CompletionApplicationDocument,
  range: lsp.Range,
): { readonly start: number; readonly end: number } | null {
  if (range.start.line !== range.end.line) return null

  const start = lspPositionToOffsetInSnapshot(request.document, range.start)
  const end = lspPositionToOffsetInSnapshot(request.document, range.end)
  if (start > request.offset || end < request.offset) return null

  return { start, end }
}

function additionalCompletionEdits(
  request: CompletionApplicationRequest,
  edits: readonly lsp.TextEdit[],
): readonly TextEdit[] {
  return edits.map((edit) => {
    const from = lspPositionToOffsetInSnapshot(request.document, edit.range.start)
    const to = lspPositionToOffsetInSnapshot(request.document, edit.range.end)
    // An import edit above the caret is unmoved; one below it addresses text the typing has already
    // pushed along.
    const shift = from < request.offset ? 0 : request.caretOffset - request.offset
    return { from: from + shift, to: to + shift, text: edit.newText }
  })
}

function completionSelectionHead(primary: TextEdit, additional: readonly TextEdit[]): number {
  let head = primary.from + primary.text.length
  for (const edit of additional) {
    if (edit.to > primary.from) continue
    head += edit.text.length - (edit.to - edit.from)
  }
  return Math.max(0, head)
}

function defaultCompletionReplacementRange(
  document: LspTextDocumentSnapshot,
  offset: number,
): { readonly start: number; readonly end: number } {
  const clamped = Math.max(0, Math.min(offset, document.textSnapshot.length))
  return rangeAroundOffset(document, clamped, identifierRunAt)
}

function identifierRunAt(text: string, offset: number): { start: number; end: number } {
  let start = offset
  while (start > 0 && isIdentifierCharacter(text[start - 1] ?? '')) start -= 1

  let end = offset
  while (end < text.length && isIdentifierCharacter(text[end] ?? '')) end += 1
  return { start, end }
}

/** Every tab stop in visit order and in document offsets, or undefined when there are none. */
function snippetStopRanges(
  snippet: ParsedSnippet,
  insertionOffset: number,
): readonly LanguageServerSnippetStop[] | undefined {
  const stops = snippet.stops.flatMap((stop) => {
    // The caret is offered the occurrence it can type into — never a transform's output, which is
    // rendered from another. Every further occurrence goes along as a copy, so a stop the snippet
    // writes twice reads the same in both places while the reader is still typing it.
    const caret = stop.ranges.findIndex((candidate) => !candidate.transform)
    const range = stop.ranges[caret]
    if (!range) return []

    const mirrors = stop.ranges.flatMap((mirror, index) =>
      index === caret ? [] : [shiftedSnippetRange(mirror, insertionOffset)],
    )
    const shifted = shiftedSnippetRange(range, insertionOffset)
    return [mirrors.length > 0 ? { ...shifted, mirrors } : shifted]
  })

  return stops.length > 0 ? stops : undefined
}

function shiftedSnippetRange(
  range: SnippetRange,
  insertionOffset: number,
): LanguageServerSnippetMirror {
  const shifted = { end: insertionOffset + range.end, start: insertionOffset + range.start }
  return range.transform ? { ...shifted, transform: range.transform } : shifted
}

function completionRowTarget(
  target: EventTarget | null,
  classNames: CompletionWidgetClassNames,
): HTMLElement | null {
  if (!(target instanceof Element)) return null
  return target.closest<HTMLElement>(`.${classNames.item}`)
}

function completionWidgetClassNames(
  namespace = COMPLETION_WIDGET_CLASS_NAMESPACE,
): CompletionWidgetClassNames {
  const root = `editor-${namespace}-completion`
  return {
    root,
    item: `${root}-item`,
    match: `${root}-match`,
  }
}

function rowIndex(row: HTMLElement): number {
  const parsed = Number(row.dataset.index)
  return Number.isFinite(parsed) ? parsed : 0
}

function clampIndex(index: number, length: number): number {
  if (length <= 0) return 0
  return Math.min(Math.max(0, index), length - 1)
}

function wrapIndex(index: number, length: number): number {
  if (length <= 0) return 0
  return ((index % length) + length) % length
}

function completionKindLabel(kind: lsp.CompletionItemKind | undefined): string {
  if (kind === 2) return 'meth'
  if (kind === 3) return 'fn'
  if (kind === 5) return 'field'
  if (kind === 6) return 'var'
  if (kind === 7) return 'class'
  if (kind === 8) return 'iface'
  if (kind === 9) return 'mod'
  if (kind === 10) return 'prop'
  if (kind === 13) return 'enum'
  if (kind === 14) return 'key'
  if (kind === 20) return 'member'
  return 'text'
}

function isIdentifierCharacter(value: string): boolean {
  return /^[A-Za-z0-9_$]$/.test(value)
}

function isCompletionList(
  value: lsp.CompletionList | readonly lsp.CompletionItem[],
): value is lsp.CompletionList {
  return !Array.isArray(value)
}

/**
 * Whether an accepted item still needs a `completionItem/resolve` round-trip.
 *
 * Servers routinely send a list whose items carry only a label, deferring documentation and — the
 * one that matters — the import edit until resolve. Applying such an item directly is what silently
 * drops auto-imports.
 */
export function completionNeedsResolve(
  item: lsp.CompletionItem,
  serverCapabilities: lsp.ServerCapabilities | null | undefined,
): boolean {
  if (item.additionalTextEdits !== undefined) return false

  return Boolean(serverCapabilities?.completionProvider?.resolveProvider)
}

/**
 * Word being typed at `offset`, which is what the list should be filtered against. The server's
 * answer is for the moment the request was sent; the user has usually typed more since.
 */
export function completionPrefix(text: string, offset: number): string {
  let start = Math.max(0, Math.min(offset, text.length))
  while (start > 0 && isIdentifierCharacter(text[start - 1] ?? '')) start -= 1

  return text.slice(start, Math.max(0, Math.min(offset, text.length)))
}

/**
 * Where each ranked item's label matched, kept beside the list instead of inside it.
 *
 * The items in a list are the server's own objects, and one of them goes back to the server on a
 * resolve; the runs to mark are this client's reading of them. The widget is handed the items and
 * nothing else, so this is where it reads that from.
 */
const completionLabelMatches = new WeakMap<lsp.CompletionItem, readonly number[]>()

/** What the last filter of a list produced, and the word it was produced from. */
type CompletionRanking = {
  readonly prefix: string
  readonly ranked: readonly lsp.CompletionItem[]
}

/**
 * Each server list's last filter, hung on the list itself.
 *
 * A narrowing is an answer about the one list it was computed from, and that list is held by a
 * single session in a single editor. Here it is out of reach of a second editor filtering its own
 * list, and it is released along with the session holding the list; in a variable of its own it
 * would be neither.
 */
const completionRankings = new WeakMap<readonly lsp.CompletionItem[], CompletionRanking>()

/**
 * Filters and orders a completion list against what has been typed.
 *
 * An item earns its place by where the typed characters landed in it, so a word start, a camel-case
 * hump and the far side of a separator all outrank the same letters found in the middle of a word.
 * Ties fall back to the server's own `sortText`, which is how a server expresses relevance it knows
 * and the client does not.
 */
export function rankCompletionItems(
  items: readonly lsp.CompletionItem[],
  prefix: string,
): readonly lsp.CompletionItem[] {
  if (prefix.length === 0) {
    completionRankings.delete(items)
    // The runs read a word that is no longer being typed, and the whole list is about to go back on
    // screen — including the items an earlier, longer word had already dropped.
    for (const item of items) completionLabelMatches.delete(item)
    return items
  }

  const scored: { item: lsp.CompletionItem; score: number }[] = []
  for (const item of narrowingSource(items, prefix)) {
    const match = fuzzyMatch(prefix, item.filterText ?? item.label)
    if (!match) continue

    completionLabelMatches.set(item, completionLabelPositions(item, prefix, match))
    scored.push({ item, score: match.score })
  }

  const ranked = scored
    .sort(
      (left, right) => right.score - left.score || compareCompletionOrder(left.item, right.item),
    )
    .map((entry) => entry.item)
  completionRankings.set(items, { prefix, ranked })
  return ranked
}

/**
 * The items worth scoring for this word: the ones that survived the shorter word, when this word is
 * that word plus what has been typed since.
 *
 * Typing a character can only narrow, never widen — no item the longer word matches was passed over
 * by the shorter one — so a server's list is scored in full once for the word it answered, and for
 * every keystroke the list stays up after that, only where it is still standing.
 */
function narrowingSource(
  items: readonly lsp.CompletionItem[],
  prefix: string,
): readonly lsp.CompletionItem[] {
  const previous = completionRankings.get(items)
  if (!previous) return items
  if (prefix.length <= previous.prefix.length || !prefix.startsWith(previous.prefix)) return items

  return previous.ranked
}

/**
 * The label positions to mark for an item, given the match its filter text earned.
 *
 * An item may be filtered by one string and displayed as another, and positions in the string that
 * was matched address nothing in the string on screen. Such a label is matched again on its own
 * terms, and loosely: part of what was typed has no reason to appear in it at all, and marking the
 * part that does beats marking nothing. The rank stays the one the filter text earned.
 */
function completionLabelPositions(
  item: lsp.CompletionItem,
  prefix: string,
  match: FuzzyMatch,
): readonly number[] {
  const filterText = item.filterText
  if (filterText === undefined) return match.positions
  if (filterText.toLowerCase() === item.label.toLowerCase()) return match.positions

  return looseFuzzyMatch(prefix, item.label)?.positions ?? []
}

function compareCompletionOrder(left: lsp.CompletionItem, right: lsp.CompletionItem): number {
  const leftKey = left.sortText ?? left.label
  const rightKey = right.sortText ?? right.label
  return leftKey.localeCompare(rightKey)
}
