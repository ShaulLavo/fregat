import { createTestLineStartsView } from '@singapore-editor/core/testing'
import { expect, it } from 'vitest'
import {
  anchorAfter,
  anchorBefore,
  applyBatchToPieceTable,
  createDocumentTextSnapshot,
  createPieceTableSnapshot,
  insertIntoPieceTable,
  resolveAnchor,
  type PieceTableSnapshot,
  type SelectionAffinity,
  type TextEdit,
  type TextSnapshot,
} from '@singapore-editor/core/document'
import {
  EditorFindController,
  type EditorFindHost,
  type EditorFindResolvedSelection,
  type EditorFindUiEvent,
  type FindTrackedRanges,
} from '../src/findController'
import { EditorFindWidget } from '../src/findWidget'
import { type FindRange, type FindTextSource } from '../src/search'
import type { EditorFindOptions } from '../src/types'

export type FindRangeTuple = readonly [number, number]

type FindSelectionFixture = {
  readonly anchor: number
  readonly head: number
  readonly affinity?: SelectionAffinity
}

export type FindFixture = {
  readonly text: string
  /** Collapsed caret offset, or an anchor/head pair. */
  readonly selection?: number | FindRangeTuple | FindSelectionFixture
  readonly options?: EditorFindOptions
}

/**
 * Everything a find case can observe from outside: what the editor paints, what
 * it selected, and what the widget says. Asserted as one object so a case that
 * fixes the count but loses the highlight still fails.
 */
type FindObservedState = {
  readonly matches: readonly FindRangeTuple[]
  readonly current: FindRangeTuple | null
  readonly scope: readonly FindRangeTuple[] | null
  readonly selections: readonly FindRangeTuple[]
  readonly selectionDetails: readonly Required<FindSelectionFixture>[]
  readonly count: string
  readonly searchString: string
  readonly toggles: readonly string[]
  readonly text: string
}

export type FindStateExpectation = {
  /** Every painted match, or how many when the fixture is too large to list. */
  readonly matches: readonly FindRangeTuple[] | number
  readonly current: FindRangeTuple | null
  readonly selection: FindRangeTuple
  /** What the widget's result counter reads. */
  readonly count: string
  readonly scope?: readonly FindRangeTuple[] | null
  readonly selectionCount?: number
  readonly searchString?: string
  readonly toggles?: readonly string[]
  readonly text?: string
}

export type FindHarness = {
  openFind(): void
  openFindReplace(): void
  toggleRegex(): void
  clickRegex(): void
  clickScope(): void
  clickReplaceAll(): void
  typeSearch(value: string): void
  typeReplacement(value: string): void
  /** An edit made in the document, which find hears about rather than causes. */
  typeInDocument(offset: number, value: string): void
  /**
   * Another document opened in the same editor, the way a host swaps one in.
   *
   * A fresh buffer, not an edit of the old one: whatever was being tracked
   * against the buffer that just went away is now being tracked against nothing.
   */
  openDocument(text: string): void
  pressEnter(): void
  pressShiftEnter(): void
  pressReplaceEnter(): void
  selectAllMatches(): boolean
  state(): FindObservedState
  /**
   * Every range a search has read, in order.
   *
   * A match set alone cannot tell one scan from three — it reads the same either
   * way — so what was asked of the document is the only thing a case can hold a
   * scan count against.
   */
  documentReads(): readonly FindRangeTuple[]
  dispose(): void
}

/**
 * Runs one find case against a controller, a widget and a document buffer wired
 * together the way the editor wires them, reached only through what a user can
 * press.
 */
export function findTest(
  name: string,
  fixture: FindFixture,
  run: (harness: FindHarness) => void,
): void {
  it(name, () => {
    const harness = createFindHarness(fixture)
    try {
      run(harness)
    } finally {
      harness.dispose()
    }
  })
}

export function assertFindState(harness: FindHarness, expected: FindStateExpectation): void {
  const state = harness.state()
  const observed: Record<string, unknown> = {
    matches: typeof expected.matches === 'number' ? state.matches.length : state.matches,
    current: state.current,
    selection: state.selections[0] ?? null,
    count: state.count,
  }
  if (expected.scope !== undefined) observed.scope = state.scope
  if (expected.selectionCount !== undefined) observed.selectionCount = state.selections.length
  if (expected.searchString !== undefined) observed.searchString = state.searchString
  if (expected.toggles !== undefined) observed.toggles = state.toggles
  if (expected.text !== undefined) observed.text = state.text

  expect(observed).toEqual(expected)
}

/**
 * The same text held one piece per code point: the worst case for a reader that
 * has to assemble a range from the pieces it spans, and the only fixture where
 * whether ranges arrive assembled is observable at all.
 */
export function chunkedTextSnapshot(text: string): TextSnapshot {
  let table = createPieceTableSnapshot('')
  // Filled back to front at offset zero, because an insert landing at the end of
  // the newest piece is folded into it and would leave one piece holding
  // everything.
  for (const character of Array.from(text).toReversed()) {
    table = insertIntoPieceTable(table, 0, character)
  }
  return createDocumentTextSnapshot(table)
}

/** What the editor hands find: range reads plus the line index, no full text. */
export function findTextSource(snapshot: TextSnapshot): FindTextSource {
  return {
    length: snapshot.length,
    readRange: (start, end) => snapshot.readRange(start, end),
    lineStartsView: createTestLineStartsView(snapshot),
  }
}

const HIGHLIGHT_PREFIX = 'find-test'

const FIND_TOGGLE_NAMES: Readonly<Record<string, string>> = {
  'text-a-underline': 'matchCase',
  textbox: 'wholeWord',
  asterisk: 'regex',
  selection: 'inSelection',
  'text-aa': 'preserveCase',
}

// Buttons are addressed by the icon they render, which outlives the labels: a
// toggle rewrites its own label and aria-label every time it is pressed.
const FIND_ICONS = {
  regex: 'asterisk',
  replaceAll: 'arrows-clockwise',
  scope: 'selection',
} as const

type FindTextStore = {
  snapshot(): TextSnapshot
  trackRanges(ranges: readonly FindRange[]): FindTrackedRanges
  applyEdits(edits: readonly TextEdit[]): void
  openDocument(text: string): void
}

// The buffer the editor keeps, edited the way the editor edits it: a replace has
// to survive the same batch application and the same anchor arithmetic here as it
// does in a document.
function createFindTextStore(initial: string): FindTextStore {
  let table = createPieceTableSnapshot(initial)
  let snapshot = createDocumentTextSnapshot(table)
  return {
    snapshot: () => snapshot,
    trackRanges: (ranges) => trackedPieceTableRanges(() => table, ranges),
    applyEdits: (edits) => {
      table = applyBatchToPieceTable(table, edits)
      snapshot = createDocumentTextSnapshot(table)
    },
    // A table of its own, as a newly opened document gets: nothing taken against
    // the old one has anything to answer from here.
    openDocument: (text) => {
      table = createPieceTableSnapshot(text)
      snapshot = createDocumentTextSnapshot(table)
    },
  }
}

// Stands in for the editor's host: each range is held as the pair of anchors
// bounding it and read back from whichever snapshot the buffer has reached, with
// the biases the editor uses — start held, end carried.
function trackedPieceTableRanges(
  buffer: () => PieceTableSnapshot,
  ranges: readonly FindRange[],
): FindTrackedRanges {
  const taken = buffer()
  const anchors = ranges.map((range) => ({
    start: anchorBefore(taken, range.start),
    end: anchorAfter(taken, range.end),
  }))

  return {
    resolve: () => {
      const current = buffer()
      return anchors
        .map((anchor) => ({
          start: resolveAnchor(current, anchor.start).offset,
          end: resolveAnchor(current, anchor.end).offset,
        }))
        .filter((range) => range.end > range.start)
    },
  }
}

// Streamed rather than taken off a materialized copy, so standing in for the
// editor's line index does not hand a case the whole-document string that find
// exists to avoid reading.
function createFindHarness(fixture: FindFixture): FindHarness {
  const store = createFindTextStore(fixture.text)
  const container = document.createElement('div')
  const scrollElement = document.createElement('div')
  container.append(scrollElement)
  document.body.append(container)

  const highlights = new Map<string, readonly FindRange[]>()
  const reads: FindRangeTuple[] = []
  let selections: readonly EditorFindResolvedSelection[] = [
    resolveSelection(fixture.selection ?? 0),
  ]
  let widget: EditorFindWidget | null = null

  const host: EditorFindHost = {
    hasDocument: () => true,
    textSource: () => recordedTextSource(findTextSource(store.snapshot()), reads),
    hasTextSnapshot: (snapshot) => snapshot === store.snapshot(),
    trackRanges: (ranges) => store.trackRanges(ranges),
    // These fixtures are small enough to be wholly on screen, so what an editor
    // would follow only within its viewport is followed here throughout.
    trackPaintedRanges: (ranges) => store.trackRanges(ranges),
    getSelections: () => selections,
    focusEditor: () => {},
    announce: () => {},
    setSelection: (anchor, head, _timingName, options) => {
      selections = [resolveSelection({ anchor, head, affinity: options?.affinity })]
    },
    setSelections: (next) => {
      if (next.length === 0) return
      selections = next.map((range) => resolveSelection(range))
    },
    setRangeHighlight: (name, ranges) => {
      highlights.set(name, ranges)
    },
    clearRangeHighlight: (name) => {
      highlights.delete(name)
    },
  }

  const controller = new EditorFindController(fixture.options)
  const hostRegistration = controller.attachHost(host, HIGHLIGHT_PREFIX)
  const editRegistration = controller.attachEditHost({
    textSnapshot: () => store.snapshot(),
    getSelections: () => selections,
    applyEdits: (edits, _timingName, selection) => {
      store.applyEdits(edits)
      if (selection) selections = [resolveSelection(selection)]
      // The editor announces an edit to its contributions whoever made it, so
      // find hears about its own replaces the same way it hears about typing.
      controller.handleViewUpdate('content', null)
    },
  })

  const ensureWidget = (): EditorFindWidget => {
    widget ??= new EditorFindWidget(container, scrollElement, {
      onSearchInput: (value) => controller.setSearchString(value),
      onReplaceInput: (value) => controller.setReplaceString(value),
      onToggleReplace: () => controller.toggleReplace(),
      onPrevious: () => controller.findPrevious(),
      onNext: () => controller.findNext(),
      onClose: () => controller.close(),
      onToggleCase: () => controller.toggleMatchCase(),
      onToggleWholeWord: () => controller.toggleWholeWord(),
      onToggleRegex: () => controller.toggleRegex(),
      onToggleScope: () => controller.toggleFindInSelection(),
      onTogglePreserveCase: () => controller.togglePreserveCase(),
      onReplaceOne: () => controller.replaceOne(),
      onReplaceAll: () => controller.replaceAll(),
    })
    return widget
  }

  const subscription = controller.subscribe((event: EditorFindUiEvent) => {
    if (event.type === 'show') {
      ensureWidget().show(event.replaceVisible)
      return
    }
    if (event.type === 'hide') {
      widget?.hide()
      return
    }
    if (event.type === 'update') {
      widget?.update(event.state)
      return
    }

    if (event.target === 'find') widget?.focusFindInput()
    else widget?.focusReplaceInput()
  })

  const rangesNamed = (suffix: string): readonly FindRangeTuple[] | null => {
    const ranges = highlights.get(`${HIGHLIGHT_PREFIX}-find-${suffix}`)
    return ranges ? ranges.map((range) => [range.start, range.end] as const) : null
  }

  return {
    openFind: () => void controller.openFind(),
    openFindReplace: () => void controller.openFindReplace(),
    toggleRegex: () => void controller.toggleRegex(),
    clickRegex: () => clickButton(container, FIND_ICONS.regex),
    clickScope: () => clickButton(container, FIND_ICONS.scope),
    clickReplaceAll: () => clickButton(container, FIND_ICONS.replaceAll),
    typeSearch: (value) => typeInto(searchInput(container), value),
    typeReplacement: (value) => typeInto(replaceInput(container), value),
    typeInDocument: (offset, value) => {
      store.applyEdits([{ from: offset, to: offset, text: value }])
      selections = [resolveSelection(offset + value.length)]
      controller.handleViewUpdate('content', null)
    },
    openDocument: (text) => {
      store.openDocument(text)
      selections = [resolveSelection(0)]
      controller.handleViewUpdate('document', null)
    },
    pressEnter: () => pressKey(searchInput(container), 'Enter', false),
    pressShiftEnter: () => pressKey(searchInput(container), 'Enter', true),
    pressReplaceEnter: () => pressKey(replaceInput(container), 'Enter', false),
    selectAllMatches: () => controller.selectAllMatches(),
    state: () => ({
      matches: rangesNamed('match') ?? [],
      current: rangesNamed('current')?.[0] ?? null,
      scope: rangesNamed('scope'),
      selections: selections.map(
        (selection) => [selection.startOffset, selection.endOffset] as const,
      ),
      selectionDetails: selections.map((selection) => ({
        anchor: selection.anchorOffset,
        head: selection.headOffset,
        affinity: selection.affinity,
      })),
      count: textOf(container, '.editor-find-count'),
      searchString: widget ? searchInput(container).value : '',
      toggles: pressedToggles(container),
      text: store.snapshot().materializeFullText(),
    }),
    documentReads: () => reads,
    dispose: () => {
      subscription.dispose()
      widget?.dispose()
      editRegistration.dispose()
      hostRegistration.dispose()
      container.remove()
    },
  }
}

function recordedTextSource(source: FindTextSource, reads: FindRangeTuple[]): FindTextSource {
  return {
    length: source.length,
    readRange: (start, end) => {
      reads.push([start, end])
      return source.readRange(start, end)
    },
    lineStartsView: source.lineStartsView,
  }
}

function resolveSelection(
  selection: number | FindRangeTuple | FindSelectionFixture,
): EditorFindResolvedSelection {
  if (typeof selection === 'number') return resolvedSelection(selection, selection, 'after')
  if (!('anchor' in selection)) return resolvedSelection(selection[0], selection[1], 'after')
  return resolvedSelection(selection.anchor, selection.head, selection.affinity ?? 'after')
}

function resolvedSelection(
  anchor: number,
  head: number,
  affinity: SelectionAffinity,
): EditorFindResolvedSelection {
  return {
    anchorOffset: anchor,
    headOffset: head,
    startOffset: Math.min(anchor, head),
    endOffset: Math.max(anchor, head),
    collapsed: anchor === head,
    affinity,
  }
}

function typeInto(input: HTMLInputElement, value: string): void {
  // One event per character, because a query is re-run on each of them and the
  // cursor moves in between.
  for (const character of value) {
    input.value += character
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }
}

function pressKey(target: HTMLElement, key: string, shiftKey: boolean): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true }))
}

function clickButton(container: HTMLElement, icon: string): void {
  buttonWithIcon(container, icon).click()
}

function buttonWithIcon(container: HTMLElement, icon: string): HTMLButtonElement {
  for (const button of container.querySelectorAll<HTMLButtonElement>('.editor-find-button')) {
    if (button.querySelector(`[data-icon="${icon}"]`)) return button
  }

  throw new Error(`missing find button: ${icon}`)
}

function pressedToggles(container: HTMLElement): readonly string[] {
  const pressed: string[] = []
  for (const button of container.querySelectorAll<HTMLButtonElement>('.editor-find-button')) {
    if (button.getAttribute('aria-pressed') !== 'true') continue

    const name = Object.entries(FIND_TOGGLE_NAMES).find(([icon]) =>
      button.querySelector(`[data-icon="${icon}"]`),
    )
    if (name) pressed.push(name[1])
  }
  return pressed
}

function searchInput(container: HTMLElement): HTMLInputElement {
  return inputAt(container, '.editor-find-input:not(.editor-find-input-standalone)')
}

function replaceInput(container: HTMLElement): HTMLInputElement {
  return inputAt(container, '.editor-find-input-standalone')
}

function inputAt(container: HTMLElement, selector: string): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>(selector)
  if (!input) throw new Error(`missing find input: ${selector}`)
  return input
}

function textOf(container: HTMLElement, selector: string): string {
  return container.querySelector(selector)?.textContent ?? ''
}
