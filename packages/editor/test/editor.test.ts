import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { detectPlatform, parseHotkey, rawHotkeyToParsedHotkey } from '@tanstack/hotkeys'
import { createEditorFindPlugin } from '../../find/src/index.ts'
import { createFoldGutterPlugin, createLineGutterPlugin } from '../../gutters/src/index.ts'
import {
  createEditorLoggingPlugin,
  createMergeConflictPlugin,
  defaultEditorKeyBindings,
  Editor,
  type EditorChangeHandler,
  type EditorCommandId,
  type EditorDecorationContributionContext,
  type EditorKeymapOptions,
  type EditorLogEvent,
  type EditorState,
} from '../src/editor'
import { EDITOR_OPTION_DESCRIPTORS } from '../src/editor/optionDescriptors'
import {
  acquireDocumentMutationLease,
  commitPreparedDocumentTransaction,
  createDocumentSession,
  createEditorBufferSession,
  createEditorTextBuffer,
  createEditorViewSession,
  prepareDocumentTransaction,
  releaseDocumentMutationLease,
  reverseDocumentTransaction,
  type DocumentSessionChange,
  type DocumentTextSnapshot,
} from '../src/public/document'
import {
  createEmptySyntaxResult,
  type EditorSyntaxRange,
  type EditorSyntaxResult,
  type EditorSyntaxSession,
  type EditorSyntaxSessionOptions,
  type EditorToken,
  EditorTokenStore,
} from '../src/public/syntax'
import type { EditorTheme } from '../src/public/rendering'
import type {
  EditorHighlighterSession,
  EditorHighlightResult,
  EditorPlugin,
  EditorViewContributionContext,
  EditorViewContributionUpdateKind,
  EditorViewSnapshot,
} from '../src/public/extensions'
import {
  resetEditorInstanceCount,
  setEditorSyntaxSessionFactory,
  setHighlightRegistry,
} from '../src/public/testing'
import { createFoldMap } from '../src/foldMap'
import { SelectionGoal, resolveSelection } from '../src/selections'
import type { VirtualizedTextView } from '../src/virtualization'
import { createVisibleEditor } from './factories/visibleEditor'
import { readAll } from './factories/snapshotText'
import { createStringTextSnapshot } from '../src/documentTextSnapshot'

// Mock HighlightRegistry backed by a Map, used to assert highlight state.
const highlightsMap = new Map<string, Highlight>()
const mockRegistry = {
  set: (name: string, highlight: Highlight) => {
    highlightsMap.set(name, highlight)
  },
  delete: (name: string) => highlightsMap.delete(name),
}

// happy-dom doesn't provide the Highlight constructor, so we polyfill it.
class MockHighlight extends Set<Range> {}

type Deferred<T> = {
  readonly promise: Promise<T>
  resolve(value: T): void
  reject(error: unknown): void
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve
    reject = promiseReject
  })

  return { promise, resolve, reject }
}

function createSyntaxResult(
  tokens = [{ start: 0, end: 5, style: { color: '#ff0000' } }],
  folds: EditorSyntaxResult['folds'] = [],
) {
  return {
    ...createEmptySyntaxResult(),
    folds,
    tokens,
  } satisfies EditorSyntaxResult
}

function createMockSyntaxSession(
  overrides: Partial<EditorSyntaxSession> = {},
): EditorSyntaxSession {
  return {
    refresh: async () => createSyntaxResult(),
    applyChange: async () => createSyntaxResult(),
    getResult: () => createSyntaxResult(),
    getTokens: () => [],
    foldingSupport: 'supported',
    getSnapshotVersion: () => 0,
    dispose: () => undefined,
    ...overrides,
  }
}

function createHighlightResult(
  objectTokens: readonly EditorToken[] = [{ start: 0, end: 5, style: { color: '#00ff00' } }],
  theme?: EditorTheme | null,
): EditorHighlightResult {
  const tokens = EditorTokenStore.fromTokens(objectTokens)
  if (theme === undefined) return { tokens }
  return { tokens, theme }
}

function createMockHighlighterSession(
  overrides: Partial<EditorHighlighterSession> = {},
): EditorHighlighterSession {
  return {
    refresh: async () => createHighlightResult(),
    applyChange: async () => createHighlightResult(),
    dispose: () => undefined,
    ...overrides,
  }
}

function createHighlighterPlugin(
  session: EditorHighlighterSession,
  options: {
    readonly loadTheme?: () => Promise<EditorTheme | null | undefined>
  } = {},
): EditorPlugin {
  return {
    activate: (context) => {
      const provider = {
        createSession: () => session,
      }
      if (!options.loadTheme) return context.registerHighlighter(provider)
      return context.registerHighlighter({
        ...provider,
        loadTheme: options.loadTheme,
      })
    },
  }
}

function createViewContributionPlugin(events: ViewContributionEvent[]): EditorPlugin {
  return {
    activate: (context) =>
      context.registerViewContribution({
        createContribution: () => ({
          update: (snapshot, kind, change) => {
            events.push({
              kind,
              snapshot,
              changeKind: change?.kind ?? null,
              editCount: change?.edits.length ?? 0,
            })
          },
          dispose: () => {
            events.push({
              kind: 'dispose',
              snapshot: null,
              changeKind: null,
              editCount: 0,
            })
          },
        }),
      }),
  }
}

function requireViewContributionContext(
  context: EditorViewContributionContext | null,
): EditorViewContributionContext {
  if (!context) throw new Error('missing view contribution context')
  return context
}

function requireDecorationContributionContext(
  context: EditorDecorationContributionContext | null,
): EditorDecorationContributionContext {
  if (!context) throw new Error('missing decoration contribution context')
  return context
}

function createTestLanguagePlugin(): EditorPlugin {
  return {
    name: 'test-language-placeholder',
    activate: () => undefined,
  }
}

function withTestLanguagePlugins(...plugins: readonly EditorPlugin[]): readonly EditorPlugin[] {
  return [createTestLanguagePlugin(), createEditorFindPlugin(), ...plugins]
}

function withTestGutterPlugins(...plugins: readonly EditorPlugin[]): readonly EditorPlugin[] {
  return withTestLanguagePlugins(createLineGutterPlugin(), createFoldGutterPlugin(), ...plugins)
}

type ViewContributionEvent = {
  readonly kind: EditorViewContributionUpdateKind | 'dispose'
  readonly snapshot: EditorViewSnapshot | null
  readonly changeKind: DocumentSessionChange['kind'] | null
  readonly editCount: number
}

class MockResizeObserver implements ResizeObserver {
  static instances: MockResizeObserver[] = []

  readonly callback: ResizeObserverCallback
  readonly observed = new Set<Element>()

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
    MockResizeObserver.instances.push(this)
  }

  observe(target: Element): void {
    this.observed.add(target)
  }

  unobserve(target: Element): void {
    this.observed.delete(target)
  }

  disconnect(): void {
    this.observed.clear()
  }

  emit(target: Element, size: { readonly height?: number; readonly width?: number }): void {
    const height = size.height ?? 0
    const width = size.width ?? 0
    this.callback([resizeObserverEntry(target, width, height)], this)
  }
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

async function flushTimers(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

async function flushSyntaxDebounce(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 160))
  await flushMicrotasks()
}

/**
 * Runs the syntax debounce until `sample` stops moving, for a test that counts the work the
 * debounce produced.
 *
 * One 160ms window is the debounce and nothing more. It is enough on an idle machine and not
 * enough on a loaded one, where a straggling query lands after the count is taken and is read as
 * an extra query the next phase made. Waiting on the count itself rather than on a longer clock
 * is what makes that impossible instead of unlikely; it throws rather than returning a number
 * nobody should trust if the work never settles.
 */
async function flushSyntaxUntilSettled(sample: () => number): Promise<number> {
  let previous = -1

  for (let attempt = 0; attempt < 40; attempt += 1) {
    await flushSyntaxDebounce()
    const current = sample()
    if (current === previous) return current
    previous = current
  }

  throw new Error(`syntax work never settled: ${sample()} after 40 debounce windows`)
}

function createInsertEvent(data: string): InputEvent {
  return new InputEvent('beforeinput', {
    bubbles: true,
    cancelable: true,
    data,
    inputType: 'insertText',
  })
}

function createLineBreakEvent(): InputEvent {
  return new InputEvent('beforeinput', {
    bubbles: true,
    cancelable: true,
    inputType: 'insertLineBreak',
  })
}

function editorRoot(): HTMLElement {
  return document.querySelector('.editor-virtualized') as HTMLElement
}

function hiddenCharacterKinds(): string[] {
  return [
    ...document.querySelectorAll<HTMLElement>('.editor-virtualized-hidden-character-marker'),
  ].map((marker) => marker.dataset.editorHiddenCharacter!)
}

function resizeObserverEntry(target: Element, width: number, height: number): ResizeObserverEntry {
  return {
    target,
    contentRect: {
      width,
      height,
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: width,
      bottom: height,
      toJSON: () => ({}),
    },
    contentBoxSize: [{ inlineSize: width, blockSize: height }],
    borderBoxSize: [{ inlineSize: width, blockSize: height }],
    devicePixelContentBoxSize: [{ inlineSize: width, blockSize: height }],
  }
}

function rowTextNode(row = 0): Text {
  const element = document.querySelector(`[data-editor-virtual-row="${row}"]`)
  const walker = document.createTreeWalker(element!, NodeFilter.SHOW_TEXT)
  return walker.nextNode() as Text
}

function rowTextNodes(row = 0): Text[] {
  const element = document.querySelector(`[data-editor-virtual-row="${row}"]`)
  const walker = document.createTreeWalker(element!, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node as Text)
  return nodes
}

function installCaretRangeFromPoint(textNode: Text, offset: number): () => void {
  const doc = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null
  }
  const originalCaretRangeFromPoint = doc.caretRangeFromPoint
  Object.defineProperty(document, 'caretRangeFromPoint', {
    configurable: true,
    value: () => {
      const range = document.createRange()
      range.setStart(textNode, offset)
      range.setEnd(textNode, offset)
      return range
    },
  })

  return () => {
    if (originalCaretRangeFromPoint) {
      Object.defineProperty(document, 'caretRangeFromPoint', {
        configurable: true,
        value: originalCaretRangeFromPoint,
      })
      return
    }

    Reflect.deleteProperty(document, 'caretRangeFromPoint')
  }
}

function setCollapsedDomSelection(offset: number): void {
  setNativeDomSelection(offset, offset)
  editorRoot().dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
}

function setNativeDomSelection(anchorOffset: number, headOffset: number): void {
  const range = document.createRange()
  const textNode = rowTextNode()
  range.setStart(textNode, anchorOffset)
  range.setEnd(textNode, headOffset)

  const selection = window.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
}

function editorInput(): HTMLTextAreaElement {
  return document.querySelector('.editor-virtualized-input') as HTMLTextAreaElement
}

function dispatchEditorKey(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    key,
    ...init,
  })
  editorRoot().dispatchEvent(event)
  return event
}

function dispatchInputKey(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    key,
    ...init,
  })
  editorInput().dispatchEvent(event)
  return event
}

/**
 * What a browser leaves behind when it applies an edit to the hidden input the editor did not
 * prevent — the state the editor has to work the edit back out of.
 */
function typeIntoHiddenInput(value: string, caret = value.length): void {
  const input = editorInput()
  input.value = value
  input.setSelectionRange(caret, caret)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

function hiddenInputWindow(): {
  value: string
  selectionStart: number
  selectionEnd: number
} {
  const input = editorInput()
  return {
    selectionEnd: input.selectionEnd,
    selectionStart: input.selectionStart,
    value: input.value,
  }
}

function dispatchInputKeyUp(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keyup', {
    bubbles: true,
    cancelable: true,
    key,
    ...init,
  })
  editorInput().dispatchEvent(event)
  return event
}

function createPasteEvent(text: string): ClipboardEvent {
  const clipboardData = {
    getData: (format: string): string => (format === 'text/plain' ? text : ''),
    setData: () => undefined,
  }
  const event = new Event('paste', {
    bubbles: true,
    cancelable: true,
  }) as ClipboardEvent
  Object.defineProperty(event, 'clipboardData', {
    configurable: true,
    value: clipboardData,
  })
  return event
}

function createDropEvent(text: string, init: MouseEventInit = {}): DragEvent {
  const dataTransfer = {
    getData: (format: string): string => (format === 'text/plain' ? text : ''),
  }
  const event = new MouseEvent('drop', {
    bubbles: true,
    cancelable: true,
    ...init,
  }) as DragEvent
  Object.defineProperty(event, 'dataTransfer', {
    configurable: true,
    value: dataTransfer,
  })
  return event
}

function createDragOverEvent(init: MouseEventInit = {}): DragEvent {
  const event = new MouseEvent('dragover', {
    bubbles: true,
    cancelable: true,
    ...init,
  }) as DragEvent
  Object.defineProperty(event, 'dataTransfer', {
    configurable: true,
    value: { dropEffect: 'none' },
  })
  return event
}

function createDragLeaveEvent(relatedTarget: EventTarget | null): DragEvent {
  return new MouseEvent('dragleave', {
    bubbles: true,
    cancelable: true,
    relatedTarget,
  }) as DragEvent
}

/** Where the editor is drawing the caret, which is how a drop target shows itself. */
function caretTransform(): string {
  return (document.querySelector('.editor-virtualized-caret') as HTMLElement).style.transform
}

function createCompositionEvent(type: string, data = ''): CompositionEvent {
  const event = new Event(type, { bubbles: true }) as CompositionEvent
  Object.defineProperty(event, 'data', { configurable: true, value: data })
  return event
}

function createCopyEvent(): {
  readonly event: ClipboardEvent
  readonly formatCount: () => number
  readonly materializeFullText: () => string
} {
  const values = new Map<string, string>()
  const clipboardData = {
    getData: (format: string): string => values.get(format) ?? '',
    setData: (format: string, value: string): void => {
      values.set(format, value)
    },
  }
  const event = new Event('copy', {
    bubbles: true,
    cancelable: true,
  }) as ClipboardEvent
  Object.defineProperty(event, 'clipboardData', {
    configurable: true,
    value: clipboardData,
  })

  return {
    event,
    formatCount: () => values.size,
    materializeFullText: () => values.get('text/plain') ?? '',
  }
}

function spyOnNativeSelection() {
  const selection = window.getSelection()!
  const addRange = vi.spyOn(selection, 'addRange')
  const removeAllRanges = vi.spyOn(selection, 'removeAllRanges')

  return {
    addRange,
    removeAllRanges,
    restore: () => {
      addRange.mockRestore()
      removeAllRanges.mockRestore()
    },
  }
}

function pressMouse(init: MouseEventInit): MouseEvent {
  const event = new MouseEvent('mousedown', {
    bubbles: true,
    cancelable: true,
    detail: 1,
    ...init,
  })
  editorRoot().dispatchEvent(event)
  return event
}

function moveMouse(init: MouseEventInit): void {
  document.dispatchEvent(new MouseEvent('mousemove', { cancelable: true, ...init }))
}

function releaseMouse(init: MouseEventInit): void {
  document.dispatchEvent(new MouseEvent('mouseup', { cancelable: true, ...init }))
}

function primaryModifier(): KeyboardEventInit {
  return detectPlatform() === 'mac' ? { metaKey: true } : { ctrlKey: true }
}

function wordNavigationModifier(): KeyboardEventInit {
  return detectPlatform() === 'mac' ? { altKey: true } : { ctrlKey: true }
}

/**
 * Presses whichever chord the default keymap ships for a command on the platform under test.
 *
 * Reaching a command any other way would still pass on a platform where nothing is bound to it,
 * which is the failure these commands have to be held to.
 */
function dispatchDefaultKey(command: EditorCommandId): KeyboardEvent {
  const platform = detectPlatform()
  const chord = defaultEditorKeyBindings(platform).find(
    (binding) => binding.command === command,
  )?.chord
  if (!chord) throw new Error(`${command} has no default chord on ${platform}`)
  const events = chord.map((hotkey) => {
    const parsed =
      typeof hotkey === 'string'
        ? parseHotkey(hotkey, platform)
        : rawHotkeyToParsedHotkey(hotkey, platform)
    if (parsed.key === undefined) throw new Error(`${command} has a physical-code chord`)
    return dispatchEditorKey(parsed.key, {
      altKey: parsed.alt,
      ctrlKey: parsed.ctrl,
      metaKey: parsed.meta,
      shiftKey: parsed.shift,
    })
  })
  return events[events.length - 1]!
}

/**
 * Reports every line read taken through a snapshot.
 *
 * A line reader serves repeats of its last line from memory, so one call per row is what a single
 * walk over a band of rows costs, and anything above that is a walk that happened twice.
 */
function countingTextSnapshot(
  textSnapshot: DocumentTextSnapshot,
  onRead: () => void,
): DocumentTextSnapshot {
  return {
    forEachTextChunk: (visit) => textSnapshot.forEachTextChunk(visit),
    length: textSnapshot.length,
    lineCount: textSnapshot.lineCount,
    lineStart: (line) => textSnapshot.lineStart(line),
    lineRange: (line) => textSnapshot.lineRange(line),
    lineAt: (offset) => textSnapshot.lineAt(offset),
    materializeFullText: () => textSnapshot.materializeFullText(),
    readRange: (start, end) => {
      onRead()
      return textSnapshot.readRange(start, end)
    },
    snapshot: textSnapshot.snapshot,
  }
}

function resolvedSelectionRanges(session: ReturnType<typeof createDocumentSession>): readonly {
  readonly anchor: number
  readonly head: number
  readonly start: number
  readonly end: number
}[] {
  return session.getSelections().selections.map((selection) => {
    const resolved = resolveSelection(session.getSnapshot(), selection)
    return {
      anchor: resolved.anchorOffset,
      head: resolved.headOffset,
      start: resolved.startOffset,
      end: resolved.endOffset,
    }
  })
}

function resolvedSelectionMetadata(session: ReturnType<typeof createDocumentSession>) {
  return session.getSelections().selections.map((selection) => {
    const resolved = resolveSelection(session.getSnapshot(), selection)
    return {
      affinity: resolved.affinity,
      anchor: resolved.anchorOffset,
      goal: resolved.goal,
      head: resolved.headOffset,
    }
  })
}

function tokenHighlights(): Highlight[] {
  return [...highlightsMap]
    .filter(([name]) => name.includes('-token-'))
    .map(([, highlight]) => highlight)
}

function tokenHighlightRanges(): AbstractRange[] {
  return tokenHighlights().flatMap((highlight) => [...highlight])
}

function tokenSnapshotFromLastEvent(events: readonly ViewContributionEvent[]) {
  return events.findLast((event) => event.kind === 'tokens')?.snapshot?.tokens.toTokens() ?? []
}

function latestFoldMarkers(events: readonly ViewContributionEvent[]) {
  return events.findLast((event) => event.snapshot)?.snapshot?.foldMarkers ?? []
}

function rangeLength(range: EditorSyntaxRange | undefined): number {
  return range ? range.endIndex - range.startIndex : 0
}

function hasLongSyntaxRange(ranges: readonly EditorSyntaxRange[]): boolean {
  return ranges.some((range) => rangeLength(range) > 200_000)
}

function selectionRanges(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('.editor-virtualized-selection-range')]
}

function rowsContainingText(text: string): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[data-editor-virtual-row]')].filter((row) =>
    row.textContent?.includes(text),
  )
}

function foldToggle(): HTMLButtonElement {
  return document.querySelector(
    '.editor-virtualized-fold-toggle:not([hidden])',
  ) as HTMLButtonElement
}

const COLLAPSED_BLOCK_TEXT = 'if (x) {\n  y();\n  y2();\n}\nz();'
const COLLAPSED_BLOCK_HEADER_END = COLLAPSED_BLOCK_TEXT.indexOf('\n')
const COLLAPSED_BLOCK_HIDDEN_OFFSET = COLLAPSED_BLOCK_TEXT.indexOf('y2();')
const COLLAPSED_BLOCK_NEXT_ROW = COLLAPSED_BLOCK_TEXT.indexOf('z();')

/**
 * Opens a document whose whole `if` block is one collapsed region, so only its header row and the
 * `z();` after it are on screen and every offset in between addresses a row that is drawn nowhere.
 */
async function openCollapsedBlock(editor: Editor): Promise<void> {
  setEditorSyntaxSessionFactory(() =>
    createMockSyntaxSession({
      refresh: async () =>
        createSyntaxResult(
          [],
          [
            {
              startIndex: 0,
              endIndex: COLLAPSED_BLOCK_TEXT.indexOf('\nz();'),
              startLine: 0,
              endLine: 3,
              type: 'statement_block',
              languageId: 'typescript',
            },
          ],
        ),
    }),
  )
  editor.openDocument({
    documentId: 'main.ts',
    languageId: 'typescript',
    text: COLLAPSED_BLOCK_TEXT,
  })
  await flushMicrotasks()
  editor.fold(0)
}

function mockEditorViewport(
  element: HTMLElement,
  width: number,
  height: number,
  scrollHeight = 200,
): void {
  Object.defineProperty(element, 'clientHeight', {
    configurable: true,
    value: height,
  })
  Object.defineProperty(element, 'scrollHeight', {
    configurable: true,
    value: scrollHeight,
  })
  Object.defineProperty(element, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      bottom: height,
      height,
      left: 0,
      right: width,
      top: 0,
      width,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }),
  })
}

function mockEditorHorizontalViewport(
  element: HTMLElement,
  width: number,
  scrollWidth: number,
): void {
  Object.defineProperty(element, 'clientWidth', {
    configurable: true,
    value: width,
  })
  Object.defineProperty(element, 'scrollWidth', {
    configurable: true,
    value: scrollWidth,
  })
}

type ScrollMetricProperty =
  | 'clientHeight'
  | 'clientWidth'
  | 'scrollHeight'
  | 'scrollLeft'
  | 'scrollTop'
  | 'scrollWidth'

function withThrowingScrollMetricReads(element: HTMLElement, callback: () => void): void {
  const descriptors: Record<ScrollMetricProperty, PropertyDescriptor | undefined> = {
    clientHeight: Object.getOwnPropertyDescriptor(element, 'clientHeight'),
    clientWidth: Object.getOwnPropertyDescriptor(element, 'clientWidth'),
    scrollHeight: Object.getOwnPropertyDescriptor(element, 'scrollHeight'),
    scrollLeft: Object.getOwnPropertyDescriptor(element, 'scrollLeft'),
    scrollTop: Object.getOwnPropertyDescriptor(element, 'scrollTop'),
    scrollWidth: Object.getOwnPropertyDescriptor(element, 'scrollWidth'),
  }
  defineThrowingElementProperty(element, 'clientHeight')
  defineThrowingElementProperty(element, 'clientWidth')
  defineThrowingElementProperty(element, 'scrollHeight')
  defineThrowingElementProperty(element, 'scrollLeft')
  defineThrowingElementProperty(element, 'scrollTop')
  defineThrowingElementProperty(element, 'scrollWidth')

  try {
    callback()
  } finally {
    restoreElementProperty(element, 'clientHeight', descriptors.clientHeight)
    restoreElementProperty(element, 'clientWidth', descriptors.clientWidth)
    restoreElementProperty(element, 'scrollHeight', descriptors.scrollHeight)
    restoreElementProperty(element, 'scrollLeft', descriptors.scrollLeft)
    restoreElementProperty(element, 'scrollTop', descriptors.scrollTop)
    restoreElementProperty(element, 'scrollWidth', descriptors.scrollWidth)
  }
}

function defineThrowingElementProperty(element: HTMLElement, property: ScrollMetricProperty): void {
  Object.defineProperty(element, property, {
    configurable: true,
    get: () => {
      throw new Error(`unexpected ${property} read`)
    },
    set: () => undefined,
  })
}

function restoreElementProperty(
  element: HTMLElement,
  property: ScrollMetricProperty,
  descriptor: PropertyDescriptor | undefined,
): void {
  if (!descriptor) {
    Reflect.deleteProperty(element, property)
    return
  }

  Object.defineProperty(element, property, descriptor)
}

function trackScrollTopWrites(element: HTMLElement): {
  readonly values: readonly number[]
  restore(): void
} {
  const descriptor = Object.getOwnPropertyDescriptor(element, 'scrollTop')
  const values: number[] = []
  let scrollTop = element.scrollTop
  Object.defineProperty(element, 'scrollTop', {
    configurable: true,
    get: () => scrollTop,
    set: (value: number) => {
      values.push(value)
      scrollTop = value
    },
  })

  return {
    values,
    restore: () => restoreElementProperty(element, 'scrollTop', descriptor),
  }
}

function recordDocumentChanges(changes: DocumentSessionChange[]): EditorChangeHandler {
  return (_state, change) => {
    if (!change) return
    changes.push(change)
  }
}

function trackBufferSubscriptionDisposal(
  buffer: ReturnType<typeof createEditorTextBuffer>,
  onDispose: () => void,
): void {
  const subscribe = buffer.subscribe.bind(buffer)
  vi.spyOn(buffer, 'subscribe').mockImplementation((listener) =>
    trackedDisposal(subscribe(listener), onDispose),
  )
}

function trackedDisposal(dispose: () => void, onDispose: () => void): () => void {
  return () => {
    onDispose()
    dispose()
  }
}

describe('Editor', () => {
  let container: HTMLElement
  let editor: Editor

  beforeEach(() => {
    highlightsMap.clear()
    // @ts-expect-error — polyfilling Highlight constructor for tests
    globalThis.Highlight = MockHighlight
    setHighlightRegistry(mockRegistry)
    resetEditorInstanceCount()
    container = document.createElement('div')
    document.body.appendChild(container)
    editor = createVisibleEditor(container, {
      plugins: withTestLanguagePlugins(),
    })
  })

  afterEach(() => {
    editor.dispose()
    container.remove()
    setHighlightRegistry(undefined)
    setEditorSyntaxSessionFactory(undefined)
  })

  describe('constructor', () => {
    it('creates anonymous initial text without notifying a change', () => {
      const states: EditorState[] = []
      editor.dispose()

      editor = createVisibleEditor(container, {
        defaultText: 'abc',
        onChange: (state) => states.push(state),
      })

      expect(editor.materializeFullText()).toBe('abc')
      expect(editorRoot().textContent).toBe('abc')
      expect(editor.getState()).toMatchObject({
        documentId: null,
        languageId: null,
        length: 3,
        canUndo: false,
        canRedo: false,
      })
      expect(states).toHaveLength(0)
    })

    it('treats empty defaultText as an editable anonymous buffer', () => {
      editor.dispose()
      editor = createVisibleEditor(container, { defaultText: '' })

      editorRoot().dispatchEvent(
        new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          data: 'x',
          inputType: 'insertText',
        }),
      )

      expect(editor.materializeFullText()).toBe('x')
      expect(editor.getState()).toMatchObject({
        documentId: null,
        length: 1,
        canUndo: true,
      })
    })

    it('forwards hidden character mode to the text view', () => {
      editor.dispose()
      editor = createVisibleEditor(container, {
        defaultText: 'a b\tc',
        hiddenCharacters: 'show',
      })

      expect(hiddenCharacterKinds()).toEqual(['space', 'tab'])
    })

    it('uses the larger default line height', () => {
      expect(editorRoot().style.getPropertyValue('--editor-row-height')).toBe('24px')
    })

    it('types into a plain line without rebuilding it', () => {
      editor.dispose()
      editor = createVisibleEditor(container, { defaultText: 'm'.repeat(120) })
      const mounted = rowTextNode()

      setCollapsedDomSelection(2)
      editorRoot().dispatchEvent(createInsertEvent('X'))

      // A keystroke is meant to cost one in-place write to the node already on screen; split the
      // line across several and the row has to swap its children out on every character instead.
      const nodes = rowTextNodes()
      expect(nodes).toHaveLength(1)
      expect(nodes[0]).toBe(mounted)
      expect(mounted.data).toBe(`mmX${'m'.repeat(118)}`)
    })

    it('forwards configured line height to the text view', () => {
      editor.dispose()
      editor = createVisibleEditor(container, {
        defaultText: 'a\nb',
        lineHeight: 26,
      })

      expect(editorRoot().style.getPropertyValue('--editor-row-height')).toBe('26px')
    })

    it('applies configured theme variables for Tree-sitter capture themes', () => {
      editor.dispose()
      editor = createVisibleEditor(container, {
        plugins: withTestLanguagePlugins(),
        theme: {
          backgroundColor: '#ffffff',
          foregroundColor: '#24292e',
          gutterForegroundColor: '#1b1f234d',
          caretColor: '#044289',
          syntax: { keywordDeclaration: '#d73a49', string: '#032f62' },
        },
      })

      const root = editorRoot()
      expect(root.style.getPropertyValue('--editor-background')).toBe('#ffffff')
      expect(root.style.getPropertyValue('--editor-foreground')).toBe('#24292e')
      expect(root.style.getPropertyValue('--editor-gutter-foreground')).toBe('#1b1f234d')
      expect(root.style.getPropertyValue('--editor-caret-color')).toBe('#044289')
      expect(root.style.getPropertyValue('--editor-syntax-keyword-declaration')).toBe('#d73a49')
      expect(root.style.getPropertyValue('--editor-syntax-string')).toBe('#032f62')
    })
  })

  describe('dispose', () => {
    it('does not recreate syntax sessions after dispose', async () => {
      // Plugin activation resolves async: tree-sitter registers ~seconds after
      // a StrictMode editor was already torn down, and the provider-changed
      // callback then resurrected a session nothing ever disposed.
      const { EditorSyntaxController } = await import('../src/editor/syntaxController')
      const getSession = vi.fn()
      const controller = new EditorSyntaxController({
        getSession,
      } as unknown as ConstructorParameters<typeof EditorSyntaxController>[0])

      controller.dispose()
      controller.reloadSyntaxSession()
      controller.startDocument({
        documentId: 'main.ts',
        languageId: 'typescript',
      } as never)

      expect(getSession).not.toHaveBeenCalled()
      expect(controller.status).toBe('plain')
    })

    it('ignores openDocument after dispose', () => {
      // A document load can resolve after teardown (StrictMode unmounts the
      // editor while its file fetch is in flight). Opening then would start a
      // syntax session nothing ever disposes.
      let sessions = 0
      setEditorSyntaxSessionFactory(() => {
        sessions += 1
        return createMockSyntaxSession()
      })
      editor.dispose()

      editor.openDocument({
        documentId: 'main.ts',
        languageId: 'typescript',
        text: 'const a = 1;',
      })

      expect(sessions).toBe(0)
    })
  })

  describe('setTheme', () => {
    it('updates and clears configured editor theme variables', () => {
      editor.setTheme({
        backgroundColor: '#ffffff',
        foregroundColor: '#24292e',
      })

      expect(editorRoot().style.getPropertyValue('--editor-background')).toBe('#ffffff')
      expect(editorRoot().style.getPropertyValue('--editor-foreground')).toBe('#24292e')

      editor.setTheme(null)

      expect(editorRoot().style.getPropertyValue('--editor-background')).toBe('')
      expect(editorRoot().style.getPropertyValue('--editor-foreground')).toBe('')
    })

    it('hands the highlighter every edit the debounce skipped as one batch', async () => {
      const applied: DocumentSessionChange[] = []
      const highlighter = createMockHighlighterSession({
        applyChange: async (change) => {
          applied.push(change)
          return createHighlightResult()
        },
      })
      editor.dispose()
      editor = createVisibleEditor(container, {
        plugins: withTestLanguagePlugins(createHighlighterPlugin(highlighter)),
      })
      setEditorSyntaxSessionFactory(() => createMockSyntaxSession())

      editor.openDocument({
        documentId: 'main.ts',
        languageId: 'typescript',
        text: 'const a = 1;\nconst b = 2;',
      })
      await flushMicrotasks()
      await flushSyntaxDebounce()

      editor.syncText('const a = 1;!\nconst b = 2;', {
        languageId: 'typescript',
      })
      editor.syncText('const a = 1;!\nconst b = 2;?', {
        languageId: 'typescript',
      })
      await flushSyntaxDebounce()

      // One request for the burst, carrying both edits in the coordinates of the last text the
      // highlighter saw, rather than only the second edit against a document it never received.
      expect(applied).toHaveLength(1)
      expect([...applied[0]!.edits].sort((left, right) => left.from - right.from)).toEqual([
        { from: 12, to: 12, text: '!' },
        { from: 25, to: 25, text: '?' },
      ])
    })

    it('does not reload highlighter sessions when the configured theme is unchanged', async () => {
      const theme = { backgroundColor: '#ffffff', foregroundColor: '#24292e' }
      const refresh = vi.fn(async () => createHighlightResult())
      const dispose = vi.fn()
      const highlighter = createMockHighlighterSession({ dispose, refresh })
      editor.dispose()
      editor = createVisibleEditor(container, {
        plugins: withTestLanguagePlugins(createHighlighterPlugin(highlighter)),
        theme,
      })
      setEditorSyntaxSessionFactory(() => createMockSyntaxSession())

      editor.openDocument({
        documentId: 'main.ts',
        languageId: 'typescript',
        text: 'const a = 1;',
      })
      await flushMicrotasks()
      editor.setTheme(theme)
      await flushMicrotasks()

      expect(refresh).toHaveBeenCalledTimes(1)
      expect(dispose).not.toHaveBeenCalled()
    })

    it('does not reload highlighter sessions when only the configured theme changes', async () => {
      const refresh = vi.fn(async () => createHighlightResult())
      const dispose = vi.fn()
      const highlighter = createMockHighlighterSession({ dispose, refresh })
      editor.dispose()
      editor = createVisibleEditor(container, {
        plugins: withTestLanguagePlugins(createHighlighterPlugin(highlighter)),
        theme: { backgroundColor: '#ffffff' },
      })
      setEditorSyntaxSessionFactory(() => createMockSyntaxSession())

      editor.openDocument({
        documentId: 'main.ts',
        languageId: 'typescript',
        text: 'const a = 1;',
      })
      await flushMicrotasks()
      editor.setTheme({ backgroundColor: '#101010' })
      await flushMicrotasks()

      expect(refresh).toHaveBeenCalledTimes(1)
      expect(dispose).not.toHaveBeenCalled()
      expect(editorRoot().style.getPropertyValue('--editor-background')).toBe('#101010')
    })
  })

  describe('setLineHeight', () => {
    it('updates the text view line height', () => {
      editor.setLineHeight(28)

      expect(editorRoot().style.getPropertyValue('--editor-row-height')).toBe('28px')
    })

    // A host driving rows from props reaches this through the registry the bindings walk, never by
    // name, so a setter left out of that list only works for a caller holding the editor itself.
    it('is in the registry a host binding drives options through', () => {
      const descriptor = EDITOR_OPTION_DESCRIPTORS.find((entry) => entry.name === 'lineHeight')
      if (!descriptor) throw new Error('lineHeight is not in the option registry')

      descriptor.applyTo(editor, descriptor.validate(32))
      expect(editorRoot().style.getPropertyValue('--editor-row-height')).toBe('32px')

      // A row of no height would leave every row of the document on top of the last one, so an
      // impossible number is answered with the height the editor would have used on its own.
      descriptor.applyTo(editor, descriptor.validate(0))
      expect(editorRoot().style.getPropertyValue('--editor-row-height')).toBe('24px')
    })
  })

  describe('font options', () => {
    it('writes the size and face as the variables the stylesheet reads, and clears them', () => {
      editor.setFontSize(15)
      editor.setFontFamily('  Fira Code, monospace ')

      expect(editorRoot().style.getPropertyValue('--editor-font-size')).toBe('15px')
      expect(editorRoot().style.getPropertyValue('--editor-font-family')).toBe(
        'Fira Code, monospace',
      )

      editor.setFontSize(undefined)
      editor.setFontFamily(undefined)

      expect(editorRoot().style.getPropertyValue('--editor-font-size')).toBe('')
      expect(editorRoot().style.getPropertyValue('--editor-font-family')).toBe('')
    })

    it('hands an impossible size back to the stylesheet', () => {
      const descriptor = EDITOR_OPTION_DESCRIPTORS.find((entry) => entry.name === 'fontSize')
      if (!descriptor) throw new Error('fontSize is not in the option registry')

      descriptor.applyTo(editor, descriptor.validate(18))
      expect(editorRoot().style.getPropertyValue('--editor-font-size')).toBe('18px')

      descriptor.applyTo(editor, descriptor.validate(0))
      expect(editorRoot().style.getPropertyValue('--editor-font-size')).toBe('')
    })
  })

  describe('setHiddenCharacters', () => {
    it('updates hidden character rendering for mounted rows', () => {
      editor.setText('a b\tc')

      expect(hiddenCharacterKinds()).toEqual([])

      editor.setHiddenCharacters('show')

      expect(hiddenCharacterKinds()).toEqual(['space', 'tab'])

      editor.setHiddenCharacters('hidden')

      expect(hiddenCharacterKinds()).toEqual([])
      expect(editorRoot().textContent).toBe('a b\tc')
    })
  })

  describe('setSelection', () => {
    it('reveals the selection by default', () => {
      const root = editorRoot()
      const text = Array.from({ length: 80 }, (_value, index) => `line ${index}`).join('\n')
      mockEditorViewport(root, 80, 40, 2_000)
      editor.setText(text)
      editor.setSelection(0)
      root.scrollTop = 0

      editor.setSelection(text.length)

      expect(root.scrollTop).toBeGreaterThan(0)
    })

    it('can update selection without revealing it', () => {
      const root = editorRoot()
      const text = Array.from({ length: 80 }, (_value, index) => `line ${index}`).join('\n')
      mockEditorViewport(root, 80, 40, 2_000)
      editor.setText(text)
      editor.setSelection(0)
      root.scrollTop = 0

      editor.setSelection(text.length, text.length, { reveal: false })

      expect(editor.getState().cursor).toEqual({ row: 79, column: 7 })
      expect(root.scrollTop).toBe(0)
    })
  })

  describe('readonly and static documents', () => {
    it('blocks user and programmatic edits while preserving selection and copy', async () => {
      editor.dispose()
      editor = createVisibleEditor(container, {
        defaultText: 'alpha',
        editability: 'readonly',
      })

      const inputEvent = createInsertEvent('!')
      editorRoot().dispatchEvent(inputEvent)
      editor.edit({ from: 5, to: 5, text: '?' })
      editor.dispatchCommand('deleteBackward')
      editorRoot().dispatchEvent(createPasteEvent(' pasted'))
      dispatchEditorKey('x')
      await flushTimers()

      expect(inputEvent.defaultPrevented).toBe(true)
      expect(editor.materializeFullText()).toBe('alpha')
      expect(editor.getState()).toMatchObject({
        editability: 'readonly',
        documentMode: 'session',
        canUndo: false,
        isDirty: false,
      })

      editor.setSelection(0, 5)
      const copy = createCopyEvent()
      editorRoot().dispatchEvent(copy.event)

      expect(copy.materializeFullText()).toBe('alpha')
    })

    it('renders setSelection with custom geometry without DOM selection sync', () => {
      editor.dispose()
      editor = createVisibleEditor(container, {
        defaultText: 'alpha beta',
        selectionSyncMode: 'none',
      })
      const nativeSelection = spyOnNativeSelection()

      try {
        editor.setSelection(0, 5)

        expect(selectionRanges()).toHaveLength(1)
        expect(nativeSelection.addRange).not.toHaveBeenCalled()
        expect(nativeSelection.removeAllRanges).not.toHaveBeenCalled()
      } finally {
        nativeSelection.restore()
      }
    })

    it('opens and attaches documents with selection sync disabled', () => {
      editor.dispose()
      editor = createVisibleEditor(container, { selectionSyncMode: 'none' })
      const nativeSelection = spyOnNativeSelection()

      try {
        editor.openDocument({
          documentId: 'open.txt',
          text: 'open',
        })
        editor.attachSession(createDocumentSession('attached'))
        editor.setText('reset')

        expect(nativeSelection.addRange).not.toHaveBeenCalled()
        expect(nativeSelection.removeAllRanges).not.toHaveBeenCalled()
      } finally {
        nativeSelection.restore()
      }
    })

    it('copies editor-managed selections without a native DOM selection', () => {
      editor.dispose()
      editor = createVisibleEditor(container, {
        defaultText: 'alpha beta',
        selectionSyncMode: 'none',
      })
      window.getSelection()?.removeAllRanges()

      editor.setSelection(0, 5)

      expect(window.getSelection()?.rangeCount).toBe(0)
      const copy = createCopyEvent()
      editorRoot().dispatchEvent(copy.event)

      expect(copy.materializeFullText()).toBe('alpha')
      expect(copy.event.defaultPrevented).toBe(true)
    })

    it('opens static documents without undo, dirty state, or write behavior', () => {
      editor.openDocument({
        documentId: 'excerpt.ts',
        documentMode: 'static',
        text: 'const value = 1',
      })

      editor.edit({ from: 0, to: 5, text: 'let' })
      editor.dispatchCommand('undo')
      editor.dispatchCommand('indentSelection')

      expect(editor.materializeFullText()).toBe('const value = 1')
      expect(editor.getState()).toMatchObject({
        documentId: 'excerpt.ts',
        documentMode: 'static',
        editability: 'editable',
        canUndo: false,
        canRedo: false,
        isDirty: false,
      })
    })

    it('does not move focus out of external inputs when opening background documents', () => {
      const input = document.createElement('input')
      document.body.append(input)
      input.focus()

      editor.openDocument({
        documentId: 'excerpt.ts',
        documentMode: 'static',
        text: 'const value = 1',
      })

      expect(document.activeElement).toBe(input)

      input.remove()
    })

    it('updates editability after construction', () => {
      editor.setText('abc')
      editor.setEditability('readonly')

      editor.edit({ from: 3, to: 3, text: '!' })

      expect(editor.materializeFullText()).toBe('abc')
      expect(editor.getState().editability).toBe('readonly')

      editor.setEditability('editable')
      editor.edit({ from: 3, to: 3, text: '!' })

      expect(editor.materializeFullText()).toBe('abc!')
    })
  })

  describe('range decorations', () => {
    it('registers and clears semantic range highlights', () => {
      editor.openDocument({ documentId: 'main.ts', text: 'alpha beta gamma' })

      editor.setRangeDecorations([
        {
          start: 6,
          end: 10,
          className: 'search-result-match',
          style: {
            backgroundColor: 'yellow',
            color: 'black',
            textDecoration: 'underline',
          },
        },
      ])

      const entry = [...highlightsMap].find(([name]) => name.includes('search-result-match'))
      const styleText = [...document.head.querySelectorAll('style')]
        .map((style) => style.textContent ?? '')
        .join('\n')

      expect(entry?.[1].size).toBe(1)
      expect(styleText).toContain('background-color: yellow')
      expect(styleText).toContain('color: black')
      expect(styleText).toContain('text-decoration: underline')

      editor.setRangeDecorations([])

      expect([...highlightsMap.keys()].some((name) => name.includes('search-result-match'))).toBe(
        false,
      )
    })

    it('updates semantic range highlights in place', () => {
      editor.openDocument({ documentId: 'main.ts', text: 'alpha beta gamma' })

      editor.setRangeDecorations([
        {
          start: 6,
          end: 10,
          className: 'search-result-match',
          style: { backgroundColor: 'yellow' },
        },
      ])

      const firstEntry = [...highlightsMap].find(([name]) => name.includes('search-result-match'))
      editor.setRangeDecorations([
        {
          start: 6,
          end: 10,
          className: 'search-result-match',
          style: { backgroundColor: 'yellow' },
        },
      ])
      const secondEntry = [...highlightsMap].find(([name]) => name.includes('search-result-match'))

      expect(secondEntry?.[1]).toBe(firstEntry?.[1])

      editor.setRangeDecorations([
        {
          start: 11,
          end: 16,
          className: 'search-result-match',
          style: { backgroundColor: 'yellow' },
        },
      ])
      const thirdEntry = [...highlightsMap].find(([name]) => name.includes('search-result-match'))

      expect(thirdEntry?.[1]).toBe(secondEntry?.[1])
      expect(thirdEntry?.[1].size).toBe(1)

      editor.setRangeDecorations([
        {
          start: 11,
          end: 16,
          className: 'search-result-match',
          style: { backgroundColor: 'orange' },
        },
      ])
      const fourthEntry = [...highlightsMap].find(([name]) => name.includes('search-result-match'))
      const styleText = [...document.head.querySelectorAll('style')]
        .map((style) => style.textContent ?? '')
        .join('\n')

      expect(fourthEntry?.[1]).toBe(thirdEntry?.[1])
      expect(styleText).toContain('background-color: orange')
    })

    it('updates appended semantic range highlights without replacing registry entries', () => {
      editor.openDocument({ documentId: 'main.ts', text: 'alpha beta gamma' })

      editor.setRangeDecorations([
        {
          start: 0,
          end: 5,
          className: 'search-result-match',
          style: { backgroundColor: 'yellow' },
        },
      ])

      const firstEntry = [...highlightsMap].find(([name]) => name.includes('search-result-match'))

      editor.setRangeDecorations([
        {
          start: 0,
          end: 5,
          className: 'search-result-match',
          style: { backgroundColor: 'yellow' },
        },
        {
          start: 6,
          end: 10,
          className: 'search-result-match',
          style: { backgroundColor: 'yellow' },
        },
      ])

      const secondEntry = [...highlightsMap].find(([name]) => name.includes('search-result-match'))

      expect(secondEntry?.[1]).toBe(firstEntry?.[1])
      expect(secondEntry?.[1].size).toBe(2)
    })

    it('batches equivalent semantic range highlights into one registry entry', () => {
      editor.openDocument({ documentId: 'main.ts', text: 'alpha beta gamma' })

      editor.setRangeDecorations([
        {
          start: 0,
          end: 5,
          className: 'search-result-match',
          style: { backgroundColor: 'yellow' },
        },
        {
          start: 6,
          end: 10,
          className: 'search-result-match',
          style: { backgroundColor: 'yellow' },
        },
      ])

      const entries = [...highlightsMap].filter(([name]) => name.includes('search-result-match'))

      expect(entries).toHaveLength(1)
      expect(entries[0]?.[1].size).toBe(2)
    })

    it('defers constructor range highlights until text is available', () => {
      editor.dispose()
      editor = createVisibleEditor(container, {
        rangeDecorations: [
          {
            start: 0,
            end: 5,
            className: 'search-result-match',
            style: { backgroundColor: 'yellow' },
          },
        ],
      })

      expect([...highlightsMap.keys()].some((name) => name.includes('search-result-match'))).toBe(
        false,
      )

      editor.openDocument({ documentId: 'main.ts', text: 'alpha beta gamma' })

      const entry = [...highlightsMap].find(([name]) => name.includes('search-result-match'))
      expect(entry?.[1].size).toBe(1)
    })
  })

  describe('setContent', () => {
    it('sets the text content', () => {
      editor.setContent('hello world')
      expect(editorRoot().textContent).toBe('hello world')
    })

    it('clears highlights when setting content', () => {
      editor.setContent('const x = 1')
      editor.setTokens([{ start: 0, end: 5, style: { color: '#ff0000' } }])
      expect(highlightsMap.size).toBeGreaterThan(0)

      editor.setContent('new content')
      expect(highlightsMap.size).toBe(0)
    })
  })

  describe('merge conflicts', () => {
    it('resolves an adjacent conflict at its opening marker', () => {
      const conflict = '<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> branch\n'
      editor.addPlugin(createMergeConflictPlugin())
      editor.setText(conflict + conflict)
      editor.setSelection(conflict.length)

      expect(editor.dispatchCommand('merge-conflict.accept.incoming')).toBe(true)
      expect(editor.materializeFullText()).toBe(conflict + 'theirs\n')
    })

    it('reports conflict marker regions in the current document', () => {
      editor.setText(['<<<<<<< HEAD', 'ours', '=======', 'theirs', '>>>>>>> branch'].join('\n'))

      const conflicts = editor.getMergeConflicts()

      expect(conflicts).toHaveLength(1)
      expect(conflicts[0]).toMatchObject({
        oursLabel: 'HEAD',
        theirsLabel: 'branch',
      })
    })

    it('resolves a conflict through the normal editor edit path', () => {
      editor.setText(
        ['before', '<<<<<<< HEAD', 'ours', '=======', 'theirs', '>>>>>>> branch'].join('\n'),
      )

      expect(editor.resolveMergeConflict(0, 'theirs')).toBe(true)

      expect(editor.materializeFullText()).toBe('before\ntheirs\n')
      expect(editor.getMergeConflicts()).toEqual([])
      expect(editor.getState().canUndo).toBe(true)
    })

    it('returns false for absent conflicts or absent base sections', () => {
      editor.setText(['<<<<<<< HEAD', 'ours', '=======', 'theirs', '>>>>>>> branch'].join('\n'))

      expect(editor.resolveMergeConflict(2, 'ours')).toBe(false)
      expect(editor.resolveMergeConflict(0, 'base')).toBe(false)
      expect(editor.getMergeConflicts()).toHaveLength(1)
    })

    it('renders a lens line above the conflict that resolves it', () => {
      editor.dispose()
      container.textContent = ''
      const compare = vi.fn()
      editor = createVisibleEditor(container, {
        plugins: withTestLanguagePlugins(createMergeConflictPlugin({ compare })),
      })
      editor.setText(['<<<<<<< HEAD', 'ours', '=======', 'theirs', '>>>>>>> branch'].join('\n'))

      const actions = [
        ...container.querySelectorAll<HTMLButtonElement>('.editor-merge-conflict-lens-action'),
      ]

      expect(actions.map((action) => action.textContent)).toEqual([
        'Accept Current Change',
        'Accept Incoming Change',
        'Accept Both Changes',
        'Compare Changes',
      ])
      expect(container.querySelector('.editor-merge-conflict-current-header')).not.toBeNull()
      expect(container.querySelector('.editor-merge-conflict-incoming-header')).not.toBeNull()

      actions[3]!.click()
      expect(compare).toHaveBeenCalledWith(expect.objectContaining({ index: 0 }))

      actions[1]!.click()

      expect(editor.materializeFullText()).toBe('theirs\n')
      expect(container.querySelector('.editor-merge-conflict-lens')).toBeNull()
      expect(container.querySelector('.editor-merge-conflict-current-header')).toBeNull()
    })

    it('omits the compare lens when no host handles it', () => {
      editor.dispose()
      container.textContent = ''
      editor = createVisibleEditor(container, {
        plugins: withTestLanguagePlugins(createMergeConflictPlugin()),
      })
      editor.setText(['<<<<<<< HEAD', 'ours', '=======', 'theirs', '>>>>>>> branch'].join('\n'))

      const labels = [
        ...container.querySelectorAll<HTMLButtonElement>('.editor-merge-conflict-lens-action'),
      ].map((action) => action.textContent)
      expect(labels).toEqual([
        'Accept Current Change',
        'Accept Incoming Change',
        'Accept Both Changes',
      ])
    })
  })

  describe('setTokens', () => {
    it('creates highlights for tokens', () => {
      editor.setContent('const x = 1')
      editor.setTokens([
        { start: 0, end: 5, style: { color: '#ff0000' } },
        { start: 6, end: 7, style: { color: '#00ff00' } },
      ])

      expect(highlightsMap.size).toBe(2)
    })

    it('groups tokens with the same style', () => {
      editor.setContent('const x = 1')
      editor.setTokens([
        { start: 0, end: 5, style: { color: '#ff0000' } },
        { start: 10, end: 11, style: { color: '#ff0000' } },
      ])

      // Same color → same group → only 1 highlight entry
      expect(highlightsMap.size).toBe(1)
    })

    it('skips tokens with no style', () => {
      editor.setContent('hello')
      editor.setTokens([{ start: 0, end: 5, style: {} }])
      expect(highlightsMap.size).toBe(0)
    })

    it('does nothing for empty text', () => {
      editor.setContent('')
      editor.setTokens([{ start: 0, end: 5, style: { color: '#ff0000' } }])
      expect(highlightsMap.size).toBe(0)
    })
  })

  describe('view contribution plugins', () => {
    it.each(['', 'previous\ndocument'])(
      'keeps line starts aligned after attaching a buffer over %j',
      (initialText) => {
        const events: ViewContributionEvent[] = []
        editor.dispose()
        editor = createVisibleEditor(container, {
          defaultText: initialText,
          plugins: [createViewContributionPlugin(events)],
        })
        const previousVersion = events.at(-1)?.snapshot?.textVersion
        const buffer = createEditorTextBuffer('alpha\nbeta\ngamma')

        editor.attachSession(createEditorBufferSession(buffer), {
          documentId: 'attached.ts',
        })

        const snapshot = events.at(-1)?.snapshot
        expect(snapshot?.textSnapshot?.lineCount).toBe(3)
        expect(snapshot?.lineCount).toBe(3)
        expect(snapshot?.lineStarts).toEqual([0, 6, 11])
        expect(snapshot?.lineStartsView?.toArray()).toEqual([0, 6, 11])
        expect(snapshot?.textVersion).toBeGreaterThan(previousVersion!)
        for (const event of events) {
          if (event.snapshot?.documentId !== 'attached.ts') continue

          expect(event.snapshot.lineStarts).toEqual([0, 6, 11])
        }
      },
    )

    it('increments snapshot textVersion when opening and clearing documents', () => {
      const events: ViewContributionEvent[] = []
      editor.dispose()
      editor = createVisibleEditor(container, {
        defaultText: 'previous\ndocument',
        plugins: [createViewContributionPlugin(events)],
      })
      const previousVersion = events.at(-1)?.snapshot?.textVersion

      editor.openDocument({ documentId: 'replacement.ts', text: 'next\ntext' })
      const opened = events.at(-1)?.snapshot
      expect(opened?.textVersion).toBeGreaterThan(previousVersion!)
      expect(opened?.lineStarts).toEqual([0, 5])

      editor.clear()
      const cleared = events.at(-1)?.snapshot
      expect(cleared?.textVersion).toBeGreaterThan(opened!.textVersion)
      expect(cleared?.lineStarts).toEqual([0])
    })

    it('receives document, token, selection, and content updates', () => {
      const events: ViewContributionEvent[] = []
      editor.dispose()
      editor = createVisibleEditor(container, {
        plugins: [createViewContributionPlugin(events)],
      })

      editor.openDocument({ documentId: 'test.ts', text: 'const a = 1;' })
      editor.setTokens([{ start: 0, end: 5, style: { color: '#ff0000' } }])
      editorRoot().dispatchEvent(createInsertEvent('!'))

      expect(events.some((event) => event.kind === 'document')).toBe(true)
      expect(events.some((event) => event.kind === 'tokens')).toBe(true)
      expect(events.some((event) => event.kind === 'selection')).toBe(true)
      expect(events.some((event) => event.kind === 'content' && event.changeKind === 'edit')).toBe(
        true,
      )
      const last = events.at(-1)?.snapshot
      expect(last && readAll(last.textSnapshot)).toBe('const a = 1;!')
    })

    it('reports a pass that ends on a caret move as the edit it made', () => {
      const events: ViewContributionEvent[] = []
      editor.dispose()
      editor = createVisibleEditor(container, {
        plugins: [createViewContributionPlugin(events)],
      })
      editor.openDocument({ documentId: 'test.ts', text: 'alpha beta' })
      events.length = 0

      editor.runInOperation(() => {
        editor.edit({ from: 0, to: 5, text: 'ALPHA' })
        editor.setSelection(0, 0)
      })

      // One update for the pass, and it has to describe the pass: a listener
      // told the text changed and handed a change carrying no edits cannot act
      // on either half of the message.
      const updates = events.filter((event) => event.changeKind !== null)
      expect(updates).toHaveLength(1)
      expect(updates[0]?.kind).toBe('content')
      expect(updates[0]?.changeKind).toBe('edit')
      expect(updates[0]?.editCount).toBe(1)
      expect(editor.materializeFullText()).toBe('ALPHA beta')
    })

    it('increments snapshot textVersion for text edits', () => {
      const events: ViewContributionEvent[] = []
      editor.dispose()
      editor = createVisibleEditor(container, {
        plugins: [createViewContributionPlugin(events)],
      })

      editor.openDocument({ documentId: 'test.ts', text: 'const a = 1;' })
      const openVersion = events.at(-1)?.snapshot?.textVersion
      editorRoot().dispatchEvent(createInsertEvent('!'))
      const contentEvent = events.findLast(
        (event) => event.kind === 'content' && event.changeKind === 'edit',
      )

      expect(openVersion).toBeTypeOf('number')
      expect(contentEvent?.snapshot?.textVersion).toBeGreaterThan(openVersion!)
    })

    it('uses cached scroll metrics when creating snapshots', () => {
      const events: ViewContributionEvent[] = []
      editor.dispose()
      editor = new Editor(container, {
        plugins: [createViewContributionPlugin(events)],
      })
      const view = Reflect.get(editor, 'view') as VirtualizedTextView
      view.measureInitialViewport()

      withThrowingScrollMetricReads(editorRoot(), () => {
        editor.openDocument({ documentId: 'test.ts', text: 'const a = 1;' })
      })

      expect(events.at(-1)?.snapshot?.viewport.scrollTop).toBe(0)
      expect(events.at(-1)?.snapshot?.viewport.scrollLeft).toBe(0)
      expect(events.at(-1)?.snapshot?.viewport.scrollHeight).toBeGreaterThan(0)
      expect(events.at(-1)?.snapshot?.viewport.scrollWidth).toBeGreaterThan(0)
      expect(events.at(-1)?.snapshot?.viewport.clientHeight).toBe(0)
      expect(events.at(-1)?.snapshot?.viewport.clientWidth).toBe(0)
    })

    it('does not write scrollTop when opening an initial document at the cached origin', () => {
      const scrollTopWrites = trackScrollTopWrites(editorRoot())

      try {
        editor.openDocument({ documentId: 'test.ts', text: 'const a = 1;' })
      } finally {
        scrollTopWrites.restore()
      }

      expect(scrollTopWrites.values).toHaveLength(0)
      expect(editor.getScrollPosition()).toEqual({ top: 0, left: 0 })
    })

    it('resets scroll when opening a new document without an explicit position', () => {
      const events: ViewContributionEvent[] = []
      editor.dispose()
      editor = createVisibleEditor(container, {
        plugins: [createViewContributionPlugin(events)],
      })

      editor.openDocument({
        documentId: 'large.txt',
        text: Array.from({ length: 200 }, (_value, index) => `line ${index}`).join('\n'),
        scrollPosition: { top: 120 },
      })

      editor.openDocument({ documentId: 'small.txt', text: 'short' })

      expect(editorRoot().scrollTop).toBe(0)
      expect(editor.getScrollPosition()).toEqual({ top: 0, left: 0 })
      expect(events.at(-1)?.snapshot?.viewport.scrollTop).toBe(0)
    })

    it('accepts an initial scroll position when opening a document', () => {
      const text = Array.from({ length: 200 }, (_value, index) => `line ${index}`).join('\n')

      editor.openDocument({
        documentId: 'large.txt',
        text,
        scrollPosition: { top: 120 },
      })

      expect(editorRoot().scrollTop).toBe(120)
      expect(editor.getScrollPosition()).toEqual({ top: 120, left: 0 })
    })

    it('renders the restored viewport once, without drawing the outgoing offset first', () => {
      const events: ViewContributionEvent[] = []
      editor.dispose()
      editor = createVisibleEditor(container, {
        plugins: [createViewContributionPlugin(events)],
      })
      const text = Array.from({ length: 400 }, (_value, index) => `line ${index}`).join('\n')

      editor.openDocument({
        documentId: 'first.txt',
        text,
        scrollPosition: { top: 900 },
      })
      events.length = 0
      editor.openDocument({
        documentId: 'second.txt',
        text,
        scrollPosition: { top: 1200 },
      })

      const reported = events
        .map((event) => event.snapshot?.viewport.scrollTop)
        .filter((top): top is number => top !== undefined)

      expect(reported.length).toBeGreaterThan(0)
      expect([...new Set(reported)]).toEqual([1200])
    })

    it('preserves and clamps scroll when replacing text', () => {
      editor.openDocument({
        documentId: 'large.txt',
        text: Array.from({ length: 200 }, (_value, index) => `line ${index}`).join('\n'),
        scrollPosition: { top: 120 },
      })

      editor.setText('short')

      expect(editorRoot().scrollTop).toBeLessThan(120)
      expect(editor.getScrollPosition()).toEqual({
        top: editorRoot().scrollTop,
        left: 0,
      })
    })

    it('uses cached line starts when reserving overlay width', () => {
      let contributionContext: EditorViewContributionContext | null = null
      const plugin: EditorPlugin = {
        activate: (context) =>
          context.registerViewContribution({
            createContribution: (context) => {
              contributionContext = context
              return {
                update: () => undefined,
                dispose: () => undefined,
              }
            },
          }),
      }
      editor.dispose()
      editor = createVisibleEditor(container, { plugins: [plugin] })

      const text = Array.from({ length: 10_000 }, (_, row) => `line ${row}`).join('\n')
      editor.openDocument({ documentId: 'long.txt', text })
      const context = requireViewContributionContext(contributionContext)

      const originalIndexOf = String.prototype.indexOf
      let lineStartScans = 0
      String.prototype.indexOf = function indexOfSpy(
        this: string,
        searchString: string,
        position?: number,
      ): number {
        if (String(this) === text && searchString === '\n') lineStartScans += 1
        return originalIndexOf.call(this, searchString, position)
      }

      try {
        context.reserveOverlayWidth('right', 120)
      } finally {
        String.prototype.indexOf = originalIndexOf
      }

      expect(lineStartScans).toBe(0)
    })

    it('reports overlay reservations back to view contributions per side', () => {
      let contributionContext: EditorViewContributionContext | null = null
      const plugin: EditorPlugin = {
        activate: (context) =>
          context.registerViewContribution({
            createContribution: (context) => {
              contributionContext = context
              return {
                update: () => undefined,
                dispose: () => undefined,
              }
            },
          }),
      }
      editor.dispose()
      editor = createVisibleEditor(container, { plugins: [plugin] })
      const context = requireViewContributionContext(contributionContext)

      expect(context.getReservedOverlayWidth('right')).toBe(0)

      context.reserveOverlayWidth('right', 96)

      expect(context.getReservedOverlayWidth('right')).toBe(96)
      expect(context.getReservedOverlayWidth('left')).toBe(0)
    })

    it('skips layout updates for unchanged overlay reservations', () => {
      const events: EditorViewContributionUpdateKind[] = []
      let contributionContext: EditorViewContributionContext | null = null
      const plugin: EditorPlugin = {
        activate: (context) =>
          context.registerViewContribution({
            createContribution: (context) => {
              contributionContext = context
              return {
                update: (_snapshot, kind) => {
                  events.push(kind)
                },
                dispose: () => undefined,
              }
            },
          }),
      }
      editor.dispose()
      editor = createVisibleEditor(container, { plugins: [plugin] })
      const context = requireViewContributionContext(contributionContext)

      context.reserveOverlayWidth('right', 80)
      context.reserveOverlayWidth('right', 80)

      expect(events.filter((kind) => kind === 'layout')).toHaveLength(1)
    })

    it('coalesces overlay reservations triggered during contribution updates', () => {
      const events: EditorViewContributionUpdateKind[] = []
      let contributionContext: EditorViewContributionContext | null = null
      const plugin: EditorPlugin = {
        activate: (context) =>
          context.registerViewContribution({
            createContribution: (context) => {
              contributionContext = context
              return {
                update: (_snapshot, kind) => {
                  events.push(kind)
                  if (events.length > 8) throw new Error('recursive contribution update')
                  requireViewContributionContext(contributionContext).reserveOverlayWidth(
                    'right',
                    80 + events.length,
                  )
                },
                dispose: () => undefined,
              }
            },
          }),
      }
      editor.dispose()
      editor = new Editor(container, { plugins: [plugin] })
      const view = Reflect.get(editor, 'view') as VirtualizedTextView
      view.measureInitialViewport()
      events.length = 0

      editor.setContent('abc')

      // The tokens land in the same render as the text, so they arrive with its viewport update.
      expect(events).toEqual(['viewport', 'layout', 'content', 'layout'])
    })

    it('reports each new scroll position to onDidScroll, both axes from a contribution', () => {
      let requester: EditorViewContributionContext | null = null
      const plugin: EditorPlugin = {
        activate: (context) =>
          context.registerViewContribution({
            createContribution: (view) => {
              requester = view
              return { update: () => undefined, dispose: () => undefined }
            },
          }),
      }
      editor.dispose()
      editor = createVisibleEditor(container, { plugins: [plugin] })
      editor.setText(Array.from({ length: 400 }, (_value, row) => `${row} `.repeat(80)).join('\n'))
      const positions: { readonly top: number; readonly left: number }[] = []
      const subscription = editor.onDidScroll((position) => positions.push(position))

      requireViewContributionContext(requester).setScrollPosition({ top: 300, left: 40 })
      editor.setScrollPosition({ top: 300, left: 40 })
      editor.setScrollPosition({ top: 120 })
      subscription.dispose()
      editor.setScrollPosition({ top: 0 })

      expect(positions).toEqual([
        { top: 300, left: 40 },
        { top: 120, left: 40 },
      ])
    })

    it('announces a reservation staked during a layout pass to width listeners', () => {
      const layouts: number[] = []
      const heard: number[] = []
      let requester: EditorViewContributionContext | null = null
      const plugin: EditorPlugin = {
        activate: (context) => {
          context.registerViewContribution({
            createContribution: (view) => {
              view.onDidChangeReservedOverlayWidth((side) => {
                heard.push(view.getReservedOverlayWidth(side))
              })
              return {
                update: (_snapshot, kind) => {
                  if (kind === 'layout') layouts.push(view.getReservedOverlayWidth('right'))
                },
                dispose: () => undefined,
              }
            },
          })
          context.registerViewContribution({
            createContribution: (view) => {
              requester = view
              return {
                update: (_snapshot, kind) => {
                  if (kind === 'layout') view.reserveOverlayWidth('right', 64)
                },
                dispose: () => undefined,
              }
            },
          })
        },
      }
      editor.dispose()
      editor = createVisibleEditor(container, { plugins: [plugin] })
      layouts.length = 0

      requireViewContributionContext(requester).requestViewUpdate()

      expect(heard).toEqual([64])
      // The request re-ran only the contribution that asked; the width reached the other as an event.
      expect(layouts).toEqual([])
    })

    it('disposes view contributions with the editor', () => {
      const events: ViewContributionEvent[] = []
      editor.dispose()
      editor = createVisibleEditor(container, {
        plugins: [createViewContributionPlugin(events)],
      })

      editor.dispose()

      expect(events.at(-1)?.kind).toBe('dispose')
    })
  })

  describe('editor injected text row provider plugins', () => {
    it('updates and clears injected rows from provider projections', () => {
      let listener: () => void = () => undefined
      let invalidationDisposed = false
      let label = 'draft'
      const providerContexts: unknown[] = []
      const plugin: EditorPlugin = {
        activate: (context) =>
          context.registerInjectedTextRowProvider({
            getInjectedTextRows: (providerContext) => {
              providerContexts.push({
                documentId: providerContext.documentId,
                lineCount: providerContext.lineCount,
                text: readAll(providerContext.textSnapshot),
              })
              return [
                {
                  id: 'note',
                  anchorBufferRow: 0,
                  placement: 'before',
                  text: label,
                  className: `injected-${label}`,
                },
              ]
            },
            onDidChangeInjectedTextRows: (nextListener) => {
              listener = nextListener
              return {
                dispose: () => {
                  invalidationDisposed = true
                },
              }
            },
          }),
      }

      editor.dispose()
      editor = createVisibleEditor(container, {
        defaultText: 'one\ntwo',
        plugins: [plugin],
      })

      expect(providerContexts.at(-1)).toEqual({
        documentId: null,
        lineCount: 2,
        text: 'one\ntwo',
      })
      expect(rowsContainingText('draft')).toHaveLength(1)

      label = 'updated'
      listener()

      expect(rowsContainingText('draft')).toHaveLength(0)
      expect(rowsContainingText('updated')).toHaveLength(1)

      editor.setPlugins([])

      expect(invalidationDisposed).toBe(true)
      expect(rowsContainingText('updated')).toHaveLength(0)
    })
  })

  describe('editor feature plugins', () => {
    it('registers editor commands and receives document changes', () => {
      let commandCalls = 0
      const changes: (DocumentSessionChange['kind'] | null)[] = []
      const plugin: EditorPlugin = {
        activate: (context) => [
          context.registerCommandContribution({
            createContribution: (commandContext) => {
              const command = commandContext.registerCommand('findNext', () => {
                commandCalls += 1
                return true
              })
              return { dispose: () => command.dispose() }
            },
          }),
          context.registerDecorationContribution({
            createContribution: () => {
              return {
                handleEditorChange: (change) => changes.push(change?.kind ?? null),
                dispose: () => undefined,
              }
            },
          }),
        ],
      }

      editor.dispose()
      editor = createVisibleEditor(container, { plugins: [plugin] })

      expect(editor.dispatchCommand('findNext')).toBe(true)
      editor.setText('abc')

      expect(commandCalls).toBe(1)
      expect(changes).toContain(null)
    })

    // A factory that gives up part-way leaves no contribution behind, and so nothing that could
    // ever hand the command back. The id would stay taken by a handler with no owner, and the next
    // plugin asking for it would be refused for as long as the editor lived.
    it('takes back the command a contribution registered before its factory failed', () => {
      let orphanRan = false
      let replacementRan = false
      const abandoned: EditorPlugin = {
        name: 'abandoned',
        activate: (context) =>
          context.registerCommandContribution({
            createContribution: (commandContext) => {
              commandContext.registerCommand('findNext', () => {
                orphanRan = true
                return true
              })
              throw new Error('missing dependency')
            },
          }),
      }
      const replacement: EditorPlugin = {
        name: 'replacement',
        activate: (context) =>
          context.registerCommandContribution({
            createContribution: (commandContext) => {
              const command = commandContext.registerCommand('findNext', () => {
                replacementRan = true
                return true
              })
              return { dispose: () => command.dispose() }
            },
          }),
      }

      editor.dispose()
      editor = createVisibleEditor(container, {
        plugins: [abandoned, replacement],
      })

      expect(editor.dispatchCommand('findNext')).toBe(true)
      expect(replacementRan).toBe(true)
      expect(orphanRan).toBe(false)
    })

    it('defers rapid text feature notifications while public changes stay immediate', () => {
      vi.useFakeTimers()
      const featureTexts: string[] = []
      const publicTexts: string[] = []
      const plugin: EditorPlugin = {
        activate: (context) =>
          context.registerDecorationContribution({
            createContribution: () => ({
              handleEditorChange: (change) => {
                if (change?.kind === 'edit')
                  featureTexts.push(change.textSnapshot.readRange(0, change.textSnapshot.length))
              },
              dispose: () => undefined,
            }),
          }),
      }

      try {
        editor.dispose()
        editor = createVisibleEditor(container, {
          plugins: [plugin],
          onChange: () => publicTexts.push(editor.materializeFullText()),
        })
        editor.setText('a')
        featureTexts.length = 0
        publicTexts.length = 0

        editorRoot().dispatchEvent(createInsertEvent('!'))

        expect(editor.materializeFullText()).toBe('a!')
        expect(publicTexts).toEqual(['a!'])
        expect(featureTexts).toEqual([])

        vi.advanceTimersByTime(149)
        expect(featureTexts).toEqual([])

        vi.advanceTimersByTime(1)
        expect(featureTexts).toEqual(['a!'])
      } finally {
        vi.useRealTimers()
      }
    })

    it('coalesces rapid text feature notifications to the latest edit', () => {
      vi.useFakeTimers()
      const featureTexts: string[] = []
      const plugin: EditorPlugin = {
        activate: (context) =>
          context.registerDecorationContribution({
            createContribution: () => ({
              handleEditorChange: (change) => {
                if (change?.kind === 'edit')
                  featureTexts.push(change.textSnapshot.readRange(0, change.textSnapshot.length))
              },
              dispose: () => undefined,
            }),
          }),
      }

      try {
        editor.dispose()
        editor = createVisibleEditor(container, { plugins: [plugin] })
        editor.setText('a')
        featureTexts.length = 0

        editorRoot().dispatchEvent(createInsertEvent('!'))
        editorRoot().dispatchEvent(createInsertEvent('?'))

        expect(editor.materializeFullText()).toBe('a!?')
        vi.advanceTimersByTime(150)
        expect(featureTexts).toEqual(['a!?'])
      } finally {
        vi.useRealTimers()
      }
    })

    it('composes source-keyed row decorations without clobbering other sources', () => {
      let featureContext: EditorDecorationContributionContext | null = null
      const plugin: EditorPlugin = {
        activate: (context) =>
          context.registerDecorationContribution({
            createContribution: (context) => {
              featureContext = context
              return { dispose: () => undefined }
            },
          }),
      }

      editor.dispose()
      editor = createVisibleEditor(container, {
        defaultText: 'one\ntwo',
        plugins: [plugin],
      })

      const feature = requireDecorationContributionContext(featureContext)
      feature.setRowDecorations(
        'first',
        new Map([[0, { className: 'first-row', gutterClassName: 'first-gutter' }]]),
      )
      feature.setRowDecorations(
        'second',
        new Map([
          [0, { className: 'second-row', gutterClassName: 'second-gutter' }],
          [1, { className: 'third-row' }],
        ]),
      )

      const firstRow = container.querySelector<HTMLElement>('[data-editor-virtual-row="0"]')
      expect(firstRow?.className).toContain('first-row')
      expect(firstRow?.className).toContain('second-row')

      feature.clearRowDecorations('first')

      expect(firstRow?.className).not.toContain('first-row')
      expect(firstRow?.className).toContain('second-row')
      expect(container.querySelector('[data-editor-virtual-row="1"]')?.className).toContain(
        'third-row',
      )
    })

    it('keeps row decoration conflict order stable when a source updates', () => {
      let featureContext: EditorDecorationContributionContext | null = null
      const plugin: EditorPlugin = {
        activate: (context) =>
          context.registerDecorationContribution({
            createContribution: (context) => {
              featureContext = context
              return { dispose: () => undefined }
            },
          }),
      }

      editor.dispose()
      editor = createVisibleEditor(container, {
        defaultText: 'one',
        plugins: [plugin],
      })

      const feature = requireDecorationContributionContext(featureContext)
      feature.setRowDecorations('first', new Map([[0, { className: 'first-row' }]]))
      feature.setRowDecorations('second', new Map([[0, { className: 'second-row' }]]))
      feature.setRowDecorations('first', new Map([[0, { className: 'updated-row' }]]))

      const className = container.querySelector<HTMLElement>(
        '[data-editor-virtual-row="0"]',
      )?.className
      const updatedIndex = className?.indexOf('updated-row') ?? -1
      const secondIndex = className?.indexOf('second-row') ?? -1

      expect(updatedIndex).toBeGreaterThanOrEqual(0)
      expect(secondIndex).toBeGreaterThanOrEqual(0)
      expect(updatedIndex).toBeLessThan(secondIndex)
    })
  })

  describe('applyEdit', () => {
    it('shifts tokens after the edit region', () => {
      editor.setContent('abcdef')
      editor.setTokens([{ start: 4, end: 6, style: { color: '#ff0000' } }])

      // Insert "XX" at position 0 → delta = +2
      const edit = { from: 0, to: 0, text: 'XX' }
      editor.applyEdit(
        edit,
        [{ start: 6, end: 8, style: { color: '#ff0000' } }],
        after('abcdef', edit),
      )

      expect(editorRoot().textContent).toBe('XXabcdef')
    })

    it('removes tokens overlapping the edit region', () => {
      editor.setContent('abcdef')
      editor.setTokens([{ start: 2, end: 4, style: { color: '#ff0000' } }])
      expect(highlightsMap.size).toBe(1)

      // Replace "cd" at positions 2-4 with "XY"
      const edit = { from: 2, to: 4, text: 'XY' }
      editor.applyEdit(edit, [], after('abcdef', edit)) // No replacement tokens

      // The overlapping token should be removed, group cleaned up
      expect(highlightsMap.size).toBe(0)
    })

    it('preserves tokens before the edit region', () => {
      editor.setContent('abcdef')
      editor.setTokens([
        { start: 0, end: 2, style: { color: '#ff0000' } },
        { start: 4, end: 6, style: { color: '#00ff00' } },
      ])

      // Edit in the middle (positions 2-4)
      const edit = { from: 2, to: 4, text: 'XX' }
      editor.applyEdit(
        edit,
        [{ start: 2, end: 4, style: { color: '#0000ff' } }],
        after('abcdef', edit),
      )

      // Token at 0-2 should be untouched, so its group persists
      expect(highlightsMap.size).toBeGreaterThanOrEqual(1)
    })

    it('adds new tokens for the edit region', () => {
      editor.setContent('abcdef')
      editor.setTokens([])

      const edit = { from: 2, to: 4, text: 'XY' }
      editor.applyEdit(
        edit,
        [{ start: 2, end: 4, style: { color: '#ff0000' } }],
        after('abcdef', edit),
      )

      expect(highlightsMap.size).toBe(1)
    })

    it('updates text content correctly', () => {
      editor.setContent('hello world')
      const edit = { from: 5, to: 5, text: ' beautiful' }
      editor.applyEdit(edit, [], after('hello world', edit))
      expect(editorRoot().textContent).toBe('hello beautiful world')
    })
  })

  describe('attachSession', () => {
    it('routes setContent through an attached buffer as one undoable edit', () => {
      const buffer = createEditorTextBuffer('abc')
      const session = createEditorBufferSession(buffer)
      editor.attachSession(session)

      editor.setContent('replaced')

      expect(buffer.materializeFullText()).toBe('replaced')
      expect(editorRoot().textContent).toBe('replaced')
      session.undo()
      expect(buffer.materializeFullText()).toBe('abc')
    })

    it('routes applyEdit through an attached buffer', () => {
      const buffer = createEditorTextBuffer('abc')
      editor.attachSession(createEditorBufferSession(buffer))

      editor.applyEdit({ from: 0, to: 1, text: 'X' }, [], createStringTextSnapshot('Xbc'))

      expect(buffer.materializeFullText()).toBe('Xbc')
      expect(editorRoot().textContent).toBe('Xbc')
    })

    it('refuses setDocument on an attached buffer', () => {
      const buffer = createEditorTextBuffer('abc')
      editor.attachSession(createEditorBufferSession(buffer))

      expect(() => editor.setDocument({ text: 'replacement', tokens: [] })).toThrow(
        expect.objectContaining({ code: 'EDITOR_SET_DOCUMENT_ON_BUFFER_SESSION' }),
      )
      expect(buffer.materializeFullText()).toBe('abc')
    })

    it('refuses routed edits through a read-only editor', () => {
      editor.dispose()
      editor = createVisibleEditor(container, { editability: 'readonly' })
      const buffer = createEditorTextBuffer('abc')
      editor.attachSession(createEditorBufferSession(buffer))

      const notEditable = expect.objectContaining({ code: 'EDITOR_NOT_EDITABLE' })
      expect(() => editor.setContent('bypass')).toThrow(notEditable)
      expect(() =>
        editor.applyEdit({ from: 0, to: 1, text: 'X' }, [], createStringTextSnapshot('Xbc')),
      ).toThrow(notEditable)
      expect(buffer.materializeFullText()).toBe('abc')
    })

    it('refuses routed edits while another writer leases the buffer', () => {
      const buffer = createEditorTextBuffer('abc')
      editor.attachSession(createEditorBufferSession(buffer))
      const acquired = acquireDocumentMutationLease(
        buffer,
        buffer.getRevision(),
        buffer.getSnapshot(),
        'editor-render-guard',
      )
      if (acquired.status !== 'acquired') throw new RangeError('expected lease')

      const leased = expect.objectContaining({ code: 'EDITOR_BUFFER_LEASED' })
      expect(() => editor.setContent('bypass')).toThrow(leased)
      expect(() =>
        editor.applyEdit({ from: 0, to: 1, text: 'X' }, [], createStringTextSnapshot('Xbc')),
      ).toThrow(leased)

      expect(buffer.materializeFullText()).toBe('abc')
      expect(editorRoot().textContent).toBe('abc')
      releaseDocumentMutationLease(buffer, acquired.lease)
    })

    it('disposes old buffer subscriptions before resetting to an owned document', () => {
      const buffer = createEditorTextBuffer('old')
      const session = createEditorBufferSession(buffer)
      const unsubscribe = vi.fn()
      trackBufferSubscriptionDisposal(buffer, unsubscribe)
      editor.attachSession(session)

      editor.openDocument({ documentId: 'new.ts', text: 'new' })
      session.applyEdits([{ from: 0, to: 3, text: 'stale' }])

      expect(unsubscribe).toHaveBeenCalledOnce()
      expect(editor.materializeFullText()).toBe('new')
      expect(editorRoot().textContent).toBe('new')
    })

    it('observes one external commit and rollback in two mounted views without double-applying a source-view edit', () => {
      editor.dispose()
      const secondContainer = document.createElement('div')
      document.body.appendChild(secondContainer)
      const firstChanges: DocumentSessionChange[] = []
      const secondChanges: DocumentSessionChange[] = []
      editor = createVisibleEditor(container, {
        onChange: recordDocumentChanges(firstChanges),
      })
      const secondEditor = createVisibleEditor(secondContainer, {
        onChange: recordDocumentChanges(secondChanges),
      })
      try {
        const buffer = createEditorTextBuffer('abcd\nsecond')
        const firstSession = createEditorBufferSession(
          buffer,
          createEditorViewSession(buffer, 'first'),
        )
        const secondSession = createEditorBufferSession(
          buffer,
          createEditorViewSession(buffer, 'second'),
        )
        editor.attachSession(firstSession)
        secondEditor.attachSession(secondSession)
        firstSession.setSelection(1)
        secondSession.setSelection(3)
        editor.setScrollPosition({ top: 11, left: 2 })
        secondEditor.setScrollPosition({ top: 22, left: 4 })

        const committed = commitPreparedDocumentTransaction(
          { buffer, sourceView: null },
          prepareDocumentTransaction(buffer, [{ from: 2, to: 2, text: 'X' }], 1, null),
          { history: { kind: 'external-barrier', groupId: 'group' } },
        )
        if (committed.status !== 'committed') throw new RangeError('expected commit')
        expect(editor.materializeFullText()).toBe('abXcd\nsecond')
        expect(secondEditor.materializeFullText()).toBe('abXcd\nsecond')
        expect(firstChanges).toHaveLength(1)
        expect(secondChanges).toHaveLength(1)

        expect(
          reverseDocumentTransaction({ buffer, sourceView: null }, committed.receipt).status,
        ).toBe('reversed')
        expect(editor.materializeFullText()).toBe('abcd\nsecond')
        expect(secondEditor.materializeFullText()).toBe('abcd\nsecond')
        expect(editor.getScrollPosition()).toEqual({ top: 11, left: 2 })
        expect(secondEditor.getScrollPosition()).toEqual({ top: 22, left: 4 })

        editor.edit({ from: 4, to: 4, text: '!' })
        expect(editor.materializeFullText()).toBe('abcd!\nsecond')
        expect(secondEditor.materializeFullText()).toBe('abcd!\nsecond')
        expect(firstChanges).toHaveLength(3)
        expect(secondChanges).toHaveLength(3)
      } finally {
        secondEditor.dispose()
        secondContainer.remove()
      }
    })

    it('attaches document identity, language, scroll, and dirty state', () => {
      const session = createDocumentSession('abc\nnext')

      editor.attachSession(session, {
        documentId: 'note.ts',
        languageId: 'typescript',
        scrollPosition: { top: 12, left: 4 },
      })

      expect(editor.getState()).toMatchObject({
        documentId: 'note.ts',
        languageId: 'typescript',
        isDirty: false,
      })
      expect(editor.getScrollPosition()).toEqual({ top: 12, left: 4 })
    })

    it('focuses the real input surface', () => {
      const session = createDocumentSession('abc')
      editor.attachSession(session)

      editor.focus()

      expect(document.activeElement).toBe(editorInput())
    })

    it('preserves the viewport when focusing the real input surface', () => {
      const root = editorRoot()
      const session = createDocumentSession('abc\n'.repeat(10))
      editor.attachSession(session)
      root.scrollTop = 120
      root.scrollLeft = 16
      vi.spyOn(editorInput(), 'setSelectionRange').mockImplementation(() => {
        root.scrollTop = 0
        root.scrollLeft = 0
      })

      editor.focus()

      expect(root.scrollTop).toBe(120)
      expect(root.scrollLeft).toBe(16)
    })

    it('routes text input through a document session', () => {
      const session = createDocumentSession('abc')
      editor.attachSession(session)

      const event = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        data: '!',
        inputType: 'insertText',
      })
      editorRoot().dispatchEvent(event)

      expect(session.materializeFullText()).toBe('abc!')
      expect(editorRoot().textContent).toBe('abc!')
    })

    it('routes real input-surface events through a document session', () => {
      const session = createDocumentSession('abc')
      editor.attachSession(session)

      editorInput().dispatchEvent(createInsertEvent('!'))

      expect(session.materializeFullText()).toBe('abc!')
      expect(editor.materializeFullText()).toBe('abc!')
    })

    it('lets native beforeinput cancel the focused keydown fallback', () => {
      const changes: DocumentSessionChange[] = []
      editor.dispose()
      editor = createVisibleEditor(container, {
        plugins: withTestLanguagePlugins(),
        onChange: (_state, change) => {
          if (change) changes.push(change)
        },
      })
      const session = createDocumentSession('abc')
      editor.attachSession(session)
      editor.focus()

      const keydown = dispatchInputKey('X')
      editorInput().dispatchEvent(createInsertEvent('X'))
      dispatchInputKeyUp('X')

      const timingNames = changes.flatMap((change) => change.timings.map(({ name }) => name))
      expect(keydown.defaultPrevented).toBe(false)
      expect(session.materializeFullText()).toBe('abcX')
      expect(editor.materializeFullText()).toBe('abcX')
      expect(timingNames).toContain('input.beforeinput')
      expect(timingNames).not.toContain('input.keydownFallback')
    })

    it('gives the screen reader the document around the caret, not an empty box', () => {
      const session = createDocumentSession('alpha\nbeta\ngamma')
      session.setSelection(6, 10)
      editor.attachSession(session)
      editor.focus()

      expect(hiddenInputWindow()).toEqual({
        selectionEnd: 10,
        selectionStart: 6,
        value: 'alpha\nbeta\ngamma',
      })
      expect(editorInput().getAttribute('aria-multiline')).toBe('true')
      expect(editorInput().getAttribute('role')).toBe('textbox')
      expect(editorInput().getAttribute('wrap')).toBe('off')
    })

    it('tells the screen reader which end of a selection the caret sits on', () => {
      const session = createDocumentSession('alpha beta')
      session.setSelection(10, 6)
      editor.attachSession(session)
      editor.focus()

      expect(editorInput().selectionDirection).toBe('backward')
      expect(hiddenInputWindow()).toEqual({
        selectionEnd: 10,
        selectionStart: 6,
        value: 'alpha beta',
      })
    })

    it('moves the hidden input window with the caret', () => {
      const session = createDocumentSession('alpha\nbeta')
      session.setSelection(10)
      editor.attachSession(session)
      editor.focus()

      expect(hiddenInputWindow().selectionStart).toBe(10)

      dispatchEditorKey('ArrowLeft')

      expect(hiddenInputWindow().selectionStart).toBe(9)
    })

    it('carries a page of a large document rather than all of it', () => {
      const text = Array.from(
        { length: 60 },
        (_, index) => `row${String(index).padStart(2, '0')}`,
      ).join('\n')
      const session = createDocumentSession(text)
      session.setSelection(text.indexOf('row25'))
      editor.attachSession(session)
      editor.focus()

      const carried = hiddenInputWindow()

      expect(carried.value.startsWith('row10\n')).toBe(true)
      expect(carried.value).not.toContain('row40')
      expect(carried.value).not.toContain('row09')
    })

    it('keeps the caret in the hidden input when an already focused editor is focused again', () => {
      const session = createDocumentSession('alpha\nbeta')
      session.setSelection(8)
      editor.attachSession(session)
      editor.focus()
      editor.focus()

      expect(hiddenInputWindow()).toEqual({
        selectionEnd: 8,
        selectionStart: 8,
        value: 'alpha\nbeta',
      })
    })

    it('types text the browser put in the hidden input with no beforeinput to read', () => {
      const session = createDocumentSession('abc')
      editor.attachSession(session)
      editor.focus()

      const keydown = dispatchInputKey('X')
      expect(keydown.defaultPrevented).toBe(false)
      expect(session.materializeFullText()).toBe('abc')

      typeIntoHiddenInput('abcX')

      expect(session.materializeFullText()).toBe('abcX')
      expect(editor.materializeFullText()).toBe('abcX')
    })

    it('replaces the word an autocorrection rewrote rather than appending its result', () => {
      const session = createDocumentSession('teh')
      session.setSelection(3)
      editor.attachSession(session)
      editor.focus()

      typeIntoHiddenInput('the')

      expect(session.materializeFullText()).toBe('the')
      expect(editor.materializeFullText()).toBe('the')
    })

    it('resolves a dead key into the accented character it produced', () => {
      const session = createDocumentSession('a\u02c6')
      session.setSelection(2)
      editor.attachSession(session)
      editor.focus()

      typeIntoHiddenInput('a\u00ea')

      expect(session.materializeFullText()).toBe('a\u00ea')
      expect(editor.materializeFullText()).toBe('a\u00ea')
    })

    it('takes away the text a soft keyboard replaced ahead of the caret', () => {
      const session = createDocumentSession('Micosoft')
      session.setSelection(3)
      editor.attachSession(session)
      editor.focus()

      typeIntoHiddenInput('Microsoft')

      expect(session.materializeFullText()).toBe('Microsoft')
      expect(editor.materializeFullText()).toBe('Microsoft')
    })

    it('carries a deduced replacement to every caret, each on the text the last one left', () => {
      const session = createDocumentSession('ab ab')
      session.setSelections([
        { anchor: 2, head: 2 },
        { anchor: 5, head: 5 },
      ])
      editor.attachSession(session)
      editor.focus()

      typeIntoHiddenInput('xyz ab', 3)

      expect(session.materializeFullText()).toBe('xyz xyz')
      expect(resolvedSelectionRanges(session)).toEqual([
        { anchor: 3, head: 3, start: 3, end: 3 },
        { anchor: 7, head: 7, start: 7, end: 7 },
      ])
    })

    // Two carets standing closer together than the word an autocorrection rewrote: replayed as they
    // are, the two replacements describe some of the same characters, and a batch holding those is
    // refused outright — which loses the correction rather than applying it imperfectly. The second
    // caret takes what the first left, so nothing is deleted twice and both still get the text.
    it('applies a deduced replacement reaching back past the caret in front of it', () => {
      const session = createDocumentSession('teh cat')
      session.setSelections([
        { anchor: 3, head: 3 },
        { anchor: 4, head: 4 },
      ])
      editor.attachSession(session)
      editor.focus()

      typeIntoHiddenInput('the cat', 3)

      expect(session.materializeFullText()).toBe('thehecat')
      expect(resolvedSelectionRanges(session)).toEqual([
        { anchor: 3, head: 3, start: 3, end: 3 },
        { anchor: 5, head: 5, start: 5, end: 5 },
      ])
    })

    it('deletes the selection a browser took away with no beforeinput to say so', () => {
      const session = createDocumentSession('alpha beta')
      session.setSelection(6, 10)
      editor.attachSession(session)
      editor.focus()

      typeIntoHiddenInput('alpha ', 6)

      expect(session.materializeFullText()).toBe('alpha ')
      expect(editor.materializeFullText()).toBe('alpha ')
    })

    it('holds half an astral character back until the other half arrives', () => {
      const session = createDocumentSession('abc')
      session.setSelection(3)
      editor.attachSession(session)
      editor.focus()

      typeIntoHiddenInput('abc\ud83d')
      expect(session.materializeFullText()).toBe('abc')

      typeIntoHiddenInput('abc\ud83d\ude00')

      expect(session.materializeFullText()).toBe('abc\ud83d\ude00')
      expect(editor.materializeFullText()).toBe('abc\ud83d\ude00')
    })

    it('reports a deduced edit under its own timing name', () => {
      const changes: DocumentSessionChange[] = []
      editor.dispose()
      editor = createVisibleEditor(container, {
        plugins: withTestLanguagePlugins(),
        onChange: (_state, change) => {
          if (change) changes.push(change)
        },
      })
      const session = createDocumentSession('abc')
      editor.attachSession(session)
      editor.focus()

      typeIntoHiddenInput('abcX')

      const timingNames = changes.flatMap((change) => change.timings.map(({ name }) => name))
      expect(session.materializeFullText()).toBe('abcX')
      expect(timingNames).toContain('input.deducedText')
    })

    it('prevents browser scroll defaults when Space uses keydown fallback', async () => {
      const session = createDocumentSession('abc')
      editor.attachSession(session)

      const event = dispatchEditorKey(' ')
      expect(event.defaultPrevented).toBe(true)
      expect(session.materializeFullText()).toBe('abc ')
      expect(editor.materializeFullText()).toBe('abc ')
      await flushTimers()

      expect(session.materializeFullText()).toBe('abc ')
      expect(editor.materializeFullText()).toBe('abc ')
    })

    it('leaves Space on the focused input to the browser instead of guessing at the key', async () => {
      const session = createDocumentSession('abc')
      editor.attachSession(session)
      editor.focus()

      const event = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: ' ',
      })
      editorInput().dispatchEvent(event)

      expect(event.defaultPrevented).toBe(false)
      expect(session.materializeFullText()).toBe('abc')

      editorInput().dispatchEvent(createInsertEvent(' '))
      await flushTimers()

      expect(session.materializeFullText()).toBe('abc ')
      expect(editor.materializeFullText()).toBe('abc ')
    })

    it('keeps forced Space text when native text follows', async () => {
      const session = createDocumentSession('abc')
      editor.attachSession(session)

      dispatchEditorKey(' ')
      editorInput().dispatchEvent(createInsertEvent('X'))
      await flushTimers()

      expect(document.activeElement).toBe(editorInput())
      expect(session.materializeFullText()).toBe('abc X')
      expect(editor.materializeFullText()).toBe('abc X')
    })

    it('inserts a literal tab at collapsed selections', () => {
      const session = createDocumentSession('abc')
      editor.attachSession(session)

      const event = dispatchEditorKey('Tab')

      expect(event.defaultPrevented).toBe(true)
      expect(session.materializeFullText()).toBe('abc\t')
      expect(editor.materializeFullText()).toBe('abc\t')
    })

    it('indents selected lines with Tab and keeps the edit undoable', () => {
      const session = createDocumentSession('a\nb\nc')
      session.setSelection(0, 3)
      editor.attachSession(session)

      dispatchEditorKey('Tab')

      expect(session.materializeFullText()).toBe('\ta\n\tb\nc')

      dispatchEditorKey('z', primaryModifier())

      expect(session.materializeFullText()).toBe('a\nb\nc')
    })

    it('outdents selected lines with Shift+Tab using the configured tab size', () => {
      editor.dispose()
      editor = createVisibleEditor(container, { tabSize: 2 })
      const session = createDocumentSession('  a\n\tb\nc')
      session.setSelection(0, 6)
      editor.attachSession(session)

      const event = dispatchEditorKey('Tab', { shiftKey: true })

      expect(event.defaultPrevented).toBe(true)
      expect(session.materializeFullText()).toBe('a\nb\nc')
    })

    it('types a line break from a key pressed on a surface with no input events', () => {
      const session = createDocumentSession('abc')
      editor.attachSession(session)

      const event = dispatchEditorKey('Enter')

      expect(event.defaultPrevented).toBe(true)
      expect(session.materializeFullText()).toBe('abc\n')
      expect(editor.materializeFullText()).toBe('abc\n')
    })

    it('does not type from a key that belongs to a composition', async () => {
      const session = createDocumentSession('abc')
      editor.attachSession(session)

      dispatchEditorKey('X', { isComposing: true })
      await flushTimers()

      expect(session.materializeFullText()).toBe('abc')
      expect(editor.materializeFullText()).toBe('abc')
    })

    it('leaves the hidden input alone while a composition is writing into it', async () => {
      const session = createDocumentSession('abc')
      editor.attachSession(session)
      editor.focus()

      editorInput().dispatchEvent(createCompositionEvent('compositionstart'))
      typeIntoHiddenInput('abcn')
      await flushTimers()

      expect(session.materializeFullText()).toBe('abc')

      editorInput().dispatchEvent(createCompositionEvent('compositionend', '\u6587'))

      expect(session.materializeFullText()).toBe('abc\u6587')
      expect(editor.materializeFullText()).toBe('abc\u6587')
    })

    it('commits compositionend data when final beforeinput is missing', () => {
      const changes: DocumentSessionChange[] = []
      editor.dispose()
      editor = createVisibleEditor(container, {
        onChange: (_state, change) => {
          if (change) changes.push(change)
        },
      })
      const session = createDocumentSession('abc')
      editor.attachSession(session)
      editor.focus()

      editorInput().dispatchEvent(createCompositionEvent('compositionstart'))
      editorInput().dispatchEvent(createCompositionEvent('compositionupdate', '文'))
      editorInput().dispatchEvent(createCompositionEvent('compositionend'))

      expect(session.materializeFullText()).toBe('abc文')
      expect(editor.materializeFullText()).toBe('abc文')
      expect(changes.at(-1)?.timings.some(({ name }) => name === 'input.composition')).toBe(true)
    })

    it('does not duplicate composition text after beforeinput commits it', () => {
      const session = createDocumentSession('abc')
      editor.attachSession(session)
      editor.focus()

      editorInput().dispatchEvent(createCompositionEvent('compositionstart'))
      editorInput().dispatchEvent(createInsertEvent('文'))
      editorInput().dispatchEvent(createCompositionEvent('compositionend', '文'))

      expect(session.materializeFullText()).toBe('abc文')
      expect(editor.materializeFullText()).toBe('abc文')
    })

    it('stops deducing from the hidden input once disposed', () => {
      const session = createDocumentSession('abc')
      editor.attachSession(session)
      editor.focus()

      const input = editorInput()
      editor.dispose()
      input.value = 'abcX'
      input.setSelectionRange(4, 4)
      input.dispatchEvent(new Event('input', { bubbles: true }))

      expect(session.materializeFullText()).toBe('abc')
      editor = createVisibleEditor(container, {
        plugins: withTestLanguagePlugins(),
      })
    })

    it('measures input timing from the browser event timestamp', () => {
      const changes: DocumentSessionChange[] = []
      editor.dispose()
      editor = createVisibleEditor(container, {
        onChange: (_state, change) => {
          if (change) changes.push(change)
        },
      })
      editor.attachSession(createDocumentSession('abc'))

      const event = new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        data: '!',
        inputType: 'insertText',
      })
      Object.defineProperty(event, 'timeStamp', {
        configurable: true,
        value: 1,
      })
      editorRoot().dispatchEvent(event)

      const timing = changes.at(-1)?.timings.find(({ name }) => name === 'input.beforeinput')
      expect(timing?.durationMs).toBeGreaterThan(1)
    })

    it('routes undo through a document session', () => {
      const session = createDocumentSession('abc')
      editor.attachSession(session)
      session.applyText('!')

      editorInput().dispatchEvent(
        new KeyboardEvent('keydown', {
          bubbles: true,
          cancelable: true,
          key: 'z',
          ...primaryModifier(),
        }),
      )

      expect(session.materializeFullText()).toBe('abc')
      expect(editorRoot().textContent).toBe('abc')
    })

    it('renders direct source-session revisions and their undo', () => {
      const session = createDocumentSession('abc')
      editor.attachSession(session)
      session.applyEdits([{ from: 0, to: 3, text: 'xyz' }])
      session.applyEdits([{ from: 3, to: 3, text: '!' }])
      expect(editor.getTextSnapshot()).toBe(session.getTextSnapshot())
      expect(editorRoot().textContent).toBe('xyz!')
      expect(session.materializeFullText()).toBe('xyz!')

      editor.dispatchCommand('undo')

      expect(session.materializeFullText()).toBe('xyz')
      expect(editor.getTextSnapshot()).toBe(session.getTextSnapshot())
      expect(editorRoot().textContent).toBe('xyz')
    })

    it('routes delete commands through the keymap layer', () => {
      const session = createDocumentSession('abc')
      editor.attachSession(session)

      dispatchEditorKey('Backspace')

      expect(session.materializeFullText()).toBe('ab')
      expect(editor.materializeFullText()).toBe('ab')
    })

    it('deletes words through explicit editor commands', () => {
      const session = createDocumentSession('alpha beta gamma')
      session.setSelection(11)
      editor.attachSession(session)

      expect(editor.dispatchCommand('deleteWordLeft')).toBe(true)
      expect(session.materializeFullText()).toBe('alpha gamma')
      expect(resolvedSelectionRanges(session)).toEqual([{ anchor: 6, head: 6, start: 6, end: 6 }])

      expect(editor.dispatchCommand('deleteWordRight')).toBe(true)
      expect(session.materializeFullText()).toBe('alpha ')
    })

    it('deletes, copies, and moves touched lines through explicit editor commands', () => {
      const deleteSession = createDocumentSession('a\nb\nc')
      deleteSession.setSelection(3)
      editor.attachSession(deleteSession)

      expect(editor.dispatchCommand('editor.action.deleteLines')).toBe(true)
      expect(deleteSession.materializeFullText()).toBe('a\nc')

      const copyUpSession = createDocumentSession('a\nb\nc')
      copyUpSession.setSelection(3)
      editor.attachSession(copyUpSession)

      expect(editor.dispatchCommand('editor.action.copyLinesUpAction')).toBe(true)
      expect(copyUpSession.materializeFullText()).toBe('a\nb\nb\nc')
      expect(resolvedSelectionRanges(copyUpSession)).toEqual([
        { anchor: 3, head: 3, start: 3, end: 3 },
      ])

      const copyDownSession = createDocumentSession('a\nb\nc')
      copyDownSession.setSelection(3)
      editor.attachSession(copyDownSession)

      expect(editor.dispatchCommand('editor.action.copyLinesDownAction')).toBe(true)
      expect(copyDownSession.materializeFullText()).toBe('a\nb\nb\nc')
      expect(resolvedSelectionRanges(copyDownSession)).toEqual([
        { anchor: 5, head: 5, start: 5, end: 5 },
      ])

      const moveUpSession = createDocumentSession('a\nb\nc')
      moveUpSession.setSelection(5)
      editor.attachSession(moveUpSession)

      expect(editor.dispatchCommand('editor.action.moveLinesUpAction')).toBe(true)
      expect(moveUpSession.materializeFullText()).toBe('a\nc\nb')
      expect(resolvedSelectionRanges(moveUpSession)).toEqual([
        { anchor: 3, head: 3, start: 3, end: 3 },
      ])

      const moveDownSession = createDocumentSession('a\nb\nc')
      moveDownSession.setSelection(3)
      editor.attachSession(moveDownSession)

      expect(editor.dispatchCommand('editor.action.moveLinesDownAction')).toBe(true)
      expect(moveDownSession.materializeFullText()).toBe('a\nc\nb')
      expect(resolvedSelectionRanges(moveDownSession)).toEqual([
        { anchor: 5, head: 5, start: 5, end: 5 },
      ])
    })

    it('inserts lines before and after through explicit editor commands', () => {
      const beforeSession = createDocumentSession('a\nb\nc')
      beforeSession.setSelection(3)
      editor.attachSession(beforeSession)

      expect(editor.dispatchCommand('editor.action.insertLineBefore')).toBe(true)
      expect(beforeSession.materializeFullText()).toBe('a\n\nb\nc')
      expect(resolvedSelectionRanges(beforeSession)).toEqual([
        { anchor: 2, head: 2, start: 2, end: 2 },
      ])

      const afterSession = createDocumentSession('a\nb\nc')
      afterSession.setSelection(3)
      editor.attachSession(afterSession)

      expect(editor.dispatchCommand('editor.action.insertLineAfter')).toBe(true)
      expect(afterSession.materializeFullText()).toBe('a\nb\n\nc')
      expect(resolvedSelectionRanges(afterSession)).toEqual([
        { anchor: 4, head: 4, start: 4, end: 4 },
      ])
    })

    it('toggles line comments through explicit editor commands', () => {
      const text = 'const a = 1;\n  const b = 2;\nconst c = 3;'
      const session = createDocumentSession(text)
      session.setSelection(0, text.indexOf('const c'))
      editor.attachSession(session, { languageId: 'typescript' })

      expect(editor.dispatchCommand('editor.action.commentLine')).toBe(true)
      // Both markers land in the shallowest line's column, so the block reads as one comment.
      expect(session.materializeFullText()).toBe('// const a = 1;\n//   const b = 2;\nconst c = 3;')

      expect(editor.dispatchCommand('editor.action.commentLine')).toBe(true)
      expect(session.materializeFullText()).toBe(text)
    })

    it('toggles block comments through explicit editor commands', () => {
      const text = 'const value = 1;'
      const start = text.indexOf('value')
      const end = start + 'value'.length
      const session = createDocumentSession(text)
      session.setSelection(start, end)
      editor.attachSession(session, { languageId: 'typescript' })

      expect(editor.dispatchCommand('editor.action.blockComment')).toBe(true)
      expect(session.materializeFullText()).toBe('const /* value */ = 1;')
      expect(resolvedSelectionRanges(session)).toEqual([
        { anchor: start + 3, head: end + 3, start: start + 3, end: end + 3 },
      ])

      expect(editor.dispatchCommand('editor.action.blockComment')).toBe(true)
      expect(session.materializeFullText()).toBe(text)
      expect(resolvedSelectionRanges(session)).toEqual([{ anchor: start, head: end, start, end }])
    })

    it('indents and outdents whole lines through explicit editor commands', () => {
      const indentSession = createDocumentSession('abc')
      indentSession.setSelection(1)
      editor.attachSession(indentSession)

      expect(editor.dispatchCommand('editor.action.indentLines')).toBe(true)
      expect(indentSession.materializeFullText()).toBe('\tabc')
      expect(resolvedSelectionRanges(indentSession)).toEqual([
        { anchor: 2, head: 2, start: 2, end: 2 },
      ])

      const outdentSession = createDocumentSession('    abc')
      outdentSession.setSelection(5)
      editor.attachSession(outdentSession)

      expect(editor.dispatchCommand('editor.action.outdentLines')).toBe(true)
      expect(outdentSession.materializeFullText()).toBe('abc')
      expect(resolvedSelectionRanges(outdentSession)).toEqual([
        { anchor: 1, head: 1, start: 1, end: 1 },
      ])
    })

    it('selects the full document with Mod+A', () => {
      const session = createDocumentSession('abc')
      editor.attachSession(session)

      dispatchEditorKey('a', primaryModifier())

      const resolved = resolveSelection(
        session.getSnapshot(),
        session.getSelections().selections[0]!,
      )
      expect(resolved.startOffset).toBe(0)
      expect(resolved.endOffset).toBe(3)
    })

    it('copies selected text as plain text', () => {
      const session = createDocumentSession('alpha beta')
      session.setSelection(6, 10)
      editor.attachSession(session)

      const copy = createCopyEvent()
      editorRoot().dispatchEvent(copy.event)

      expect(copy.materializeFullText()).toBe('beta')
      expect(copy.event.defaultPrevented).toBe(true)
    })

    it('copies multiple selected ranges with newline separators', () => {
      const session = createDocumentSession('alpha beta gamma')
      session.setSelections([
        { anchor: 0, head: 5 },
        { anchor: 11, head: 16 },
      ])
      editor.attachSession(session)

      const copy = createCopyEvent()
      editorRoot().dispatchEvent(copy.event)

      expect(copy.materializeFullText()).toBe('alpha\ngamma')
      expect(copy.event.defaultPrevented).toBe(true)
    })

    it('copies the caret line for collapsed selections', () => {
      const session = createDocumentSession('abc\ndef')
      session.setSelection(5)
      editor.attachSession(session)

      const copy = createCopyEvent()
      editorRoot().dispatchEvent(copy.event)

      expect(copy.materializeFullText()).toBe('def\n')
      expect(copy.event.defaultPrevented).toBe(true)
    })

    it('copies the full document after Mod+A', () => {
      editor.setText('abc')

      dispatchEditorKey('a', primaryModifier())
      const copy = createCopyEvent()
      editorRoot().dispatchEvent(copy.event)

      expect(copy.materializeFullText()).toBe('abc')
      expect(copy.event.defaultPrevented).toBe(true)
    })

    it('opens long documents without revealing the initial end selection', () => {
      const root = editorRoot()
      const text = Array.from({ length: 80 }, (_value, index) => `line ${index}`).join('\n')
      mockEditorViewport(root, 80, 40, 2_000)

      editor.setText(text)

      expect(editor.getState().cursor).toEqual({ row: 79, column: 7 })
      expect(root.scrollTop).toBe(0)
    })

    it('scrolls to the bottom of pasted text', () => {
      const pasted = Array.from({ length: 8 }, (_value, index) => `line ${index}`).join('\n')
      editor.setText('')
      mockEditorViewport(editorRoot(), 80, 40)
      editor.focus()

      editorInput().dispatchEvent(createPasteEvent(pasted))

      expect(editor.materializeFullText()).toBe(pasted)
      expect(editor.getState().cursor).toEqual({ row: 7, column: 6 })
      expect(editorRoot().scrollTop).toBeGreaterThan(0)
    })

    it('pastes plain text at each active cursor as one undoable edit', () => {
      const session = createDocumentSession('abcd')
      session.setSelections([{ anchor: 1 }, { anchor: 3 }])
      editor.attachSession(session)
      editor.focus()

      editorInput().dispatchEvent(createPasteEvent('X'))

      expect(session.materializeFullText()).toBe('aXbcXd')
      expect(resolvedSelectionRanges(session)).toEqual([
        { anchor: 2, head: 2, start: 2, end: 2 },
        { anchor: 5, head: 5, start: 5, end: 5 },
      ])

      editor.dispatchCommand('undo')

      expect(session.materializeFullText()).toBe('abcd')
      expect(resolvedSelectionRanges(session)).toEqual([
        { anchor: 1, head: 1, start: 1, end: 1 },
        { anchor: 3, head: 3, start: 3, end: 3 },
      ])
    })

    it('keeps paste as its own undo unit between typing runs', () => {
      editor.setText('')
      editor.focus()

      editorInput().dispatchEvent(createInsertEvent('a'))
      editorInput().dispatchEvent(createInsertEvent('b'))
      editorInput().dispatchEvent(createPasteEvent('XY'))
      editorInput().dispatchEvent(createInsertEvent('c'))

      expect(editor.materializeFullText()).toBe('abXYc')

      editor.dispatchCommand('undo')
      expect(editor.materializeFullText()).toBe('abXY')

      editor.dispatchCommand('undo')
      expect(editor.materializeFullText()).toBe('ab')

      editor.dispatchCommand('undo')
      expect(editor.materializeFullText()).toBe('')
    })

    it('claims a drag crossing the text so the browser delivers its drop', () => {
      const session = createDocumentSession('abcd')
      editor.attachSession(session)
      mockEditorViewport(editorRoot(), 120, 40)

      const dragOver = createDragOverEvent({ clientX: 20, clientY: 10 })
      editorRoot().dispatchEvent(dragOver)

      expect(dragOver.defaultPrevented).toBe(true)
      expect(dragOver.dataTransfer?.dropEffect).toBe('copy')
    })

    it('leaves a drag over a readonly document unclaimed', () => {
      editor.dispose()
      editor = createVisibleEditor(container, {
        defaultText: 'abcd',
        editability: 'readonly',
      })
      mockEditorViewport(editorRoot(), 120, 40)

      const dragOver = createDragOverEvent({ clientX: 20, clientY: 10 })
      editorRoot().dispatchEvent(dragOver)

      expect(dragOver.defaultPrevented).toBe(false)
    })

    it('inserts dropped plain text at the hit-tested offset', () => {
      const session = createDocumentSession('abcd')
      session.setSelection(0)
      editor.attachSession(session)
      mockEditorViewport(editorRoot(), 120, 40)
      const restoreCaretRangeFromPoint = installCaretRangeFromPoint(rowTextNode(), 2)

      try {
        const drop = createDropEvent('X', { clientX: 20, clientY: 10 })
        editorRoot().dispatchEvent(drop)

        expect(drop.defaultPrevented).toBe(true)
        expect(session.materializeFullText()).toBe('abXcd')
        expect(resolvedSelectionRanges(session)).toEqual([{ anchor: 3, end: 3, head: 3, start: 3 }])

        editor.dispatchCommand('undo')

        expect(session.materializeFullText()).toBe('abcd')
        expect(resolvedSelectionRanges(session)).toEqual([{ anchor: 2, end: 2, head: 2, start: 2 }])
      } finally {
        restoreCaretRangeFromPoint()
      }
    })

    it('drops plain text at the hit-tested offset instead of every active cursor', () => {
      const session = createDocumentSession('abcd')
      session.setSelections([{ anchor: 1 }, { anchor: 3 }])
      editor.attachSession(session)
      mockEditorViewport(editorRoot(), 120, 40)
      const restoreCaretRangeFromPoint = installCaretRangeFromPoint(rowTextNode(), 2)

      try {
        editorRoot().dispatchEvent(createDropEvent('X', { clientX: 20, clientY: 10 }))

        expect(session.materializeFullText()).toBe('abXcd')
        expect(resolvedSelectionRanges(session)).toEqual([{ anchor: 3, end: 3, head: 3, start: 3 }])

        editor.dispatchCommand('undo')

        expect(session.materializeFullText()).toBe('abcd')
        expect(resolvedSelectionRanges(session)).toEqual([{ anchor: 2, end: 2, head: 2, start: 2 }])
      } finally {
        restoreCaretRangeFromPoint()
      }
    })

    it('prevents empty drops without editing', () => {
      const session = createDocumentSession('abcd')
      editor.attachSession(session)

      const drop = createDropEvent('', { clientX: 20, clientY: 10 })
      editorRoot().dispatchEvent(drop)

      expect(drop.defaultPrevented).toBe(true)
      expect(session.materializeFullText()).toBe('abcd')
    })

    it('keeps the caret on its source row when a paste shifts the following line', () => {
      const originalResizeObserver = globalThis.ResizeObserver
      globalThis.ResizeObserver = MockResizeObserver
      MockResizeObserver.instances = []
      editor.dispose()
      editor = createVisibleEditor(container, {
        lineHeight: 20,
        plugins: withTestLanguagePlugins(),
      })

      try {
        const root = editorRoot()
        const observer = MockResizeObserver.instances.find((candidate) =>
          candidate.observed.has(root),
        )!
        const text = Array.from({ length: 6 }, (_value, index) => `line ${index}`).join('\n')
        const offset = text.indexOf('line 2') + 'line 2'.length
        observer.emit(root, { height: 40, width: 80 })
        editor.setText(text)
        editor.setSelection(offset, offset, { reveal: false })
        editor.focus()
        root.scrollTop = 30

        editorInput().dispatchEvent(createPasteEvent('!'))

        expect(editor.getState().cursor).toEqual({ row: 2, column: 7 })
        expect(editor['view'].getLineStartsView().at(3)).toBe(offset + 2)
        expect(root.scrollTop).toBe(30)
      } finally {
        globalThis.ResizeObserver = originalResizeObserver
      }
    })

    it('writes scrollTop once when revealing pasted text at the viewport end', () => {
      const pasted = Array.from({ length: 8 }, (_value, index) => `line ${index}`).join('\n')
      const root = editorRoot()
      editor.setText('')
      mockEditorViewport(root, 80, 40)
      editor.focus()
      const scrollTopWrites = trackScrollTopWrites(root)

      try {
        editorInput().dispatchEvent(createPasteEvent(pasted))
      } finally {
        scrollTopWrites.restore()
      }

      expect(scrollTopWrites.values).toHaveLength(1)
      expect(scrollTopWrites.values[0]).toBeGreaterThan(0)
    })

    it('moves a collapsed caret with arrow keys', () => {
      const session = createDocumentSession('abc')
      editor.attachSession(session)

      dispatchEditorKey('ArrowLeft')

      expect(editor.getState().cursor).toEqual({ row: 0, column: 2 })
      const resolved = resolveSelection(
        session.getSnapshot(),
        session.getSelections().selections[0]!,
      )
      expect(resolved.headOffset).toBe(2)
    })

    it('moves all collapsed cursors with arrow keys', () => {
      const session = createDocumentSession('abc\ndef')
      session.setSelections([{ anchor: 3 }, { anchor: 7 }])
      editor.attachSession(session)
      editor.focus()

      dispatchEditorKey('ArrowLeft')

      expect(resolvedSelectionRanges(session)).toEqual([
        { anchor: 2, head: 2, start: 2, end: 2 },
        { anchor: 6, head: 6, start: 6, end: 6 },
      ])
      expect(container.querySelectorAll('.editor-virtualized-caret:not([hidden])')).toHaveLength(2)
    })

    it('extends selections with shift arrow keys', () => {
      const session = createDocumentSession('abc')
      editor.attachSession(session)

      dispatchEditorKey('ArrowLeft', { shiftKey: true })

      const resolved = resolveSelection(
        session.getSnapshot(),
        session.getSelections().selections[0]!,
      )
      expect(resolved.anchorOffset).toBe(3)
      expect(resolved.headOffset).toBe(2)
      expect(resolved.startOffset).toBe(2)
      expect(resolved.endOffset).toBe(3)
      expect(selectionRanges()).toHaveLength(1)
    })

    it('renders and copies keyboard selections with selection sync disabled', () => {
      editor.dispose()
      editor = createVisibleEditor(container, {
        defaultText: 'abc',
        selectionSyncMode: 'none',
      })
      const nativeSelection = spyOnNativeSelection()

      try {
        dispatchEditorKey('ArrowLeft', { shiftKey: true })

        expect(selectionRanges()).toHaveLength(1)
        expect(nativeSelection.addRange).not.toHaveBeenCalled()

        const copy = createCopyEvent()
        editorRoot().dispatchEvent(copy.event)

        expect(copy.materializeFullText()).toBe('c')
      } finally {
        nativeSelection.restore()
      }
    })

    it('extends all cursors with shift arrow keys', () => {
      const session = createDocumentSession('abcdef')
      session.setSelections([{ anchor: 2 }, { anchor: 5 }])
      editor.attachSession(session)
      editor.focus()

      dispatchEditorKey('ArrowRight', { shiftKey: true })

      expect(resolvedSelectionRanges(session)).toEqual([
        { anchor: 2, head: 3, start: 2, end: 3 },
        { anchor: 5, head: 6, start: 5, end: 6 },
      ])
      expect(container.querySelectorAll('.editor-virtualized-caret:not([hidden])')).toHaveLength(2)
    })

    it('keeps vertical navigation on the preferred visual column', () => {
      const session = createDocumentSession('abcdef\nx\n12345')
      editor.attachSession(session)

      dispatchEditorKey('ArrowUp')
      dispatchEditorKey('ArrowUp')

      expect(editor.getState().cursor).toEqual({ row: 0, column: 5 })
    })

    it('keeps independent visual columns while vertically moving all cursors', () => {
      const session = createDocumentSession('abcde\nx\n123456789\nABCDE\ny\n987654321')
      session.setSelections([{ anchor: 13 }, { anchor: 34 }])
      editor.attachSession(session)

      dispatchEditorKey('ArrowUp')
      expect(resolvedSelectionRanges(session)).toEqual([
        { anchor: 7, head: 7, start: 7, end: 7 },
        { anchor: 25, head: 25, start: 25, end: 25 },
      ])

      dispatchEditorKey('ArrowDown')
      expect(resolvedSelectionRanges(session)).toEqual([
        { anchor: 13, head: 13, start: 13, end: 13 },
        { anchor: 34, head: 34, start: 34, end: 34 },
      ])
    })

    it('keeps multi-cursor navigation for word, line, page, and document commands', () => {
      const wordSession = createDocumentSession('one two three four five six')
      wordSession.setSelections([{ anchor: 4 }, { anchor: 19 }])
      editor.attachSession(wordSession)

      dispatchEditorKey('ArrowRight', wordNavigationModifier())
      expect(wordSession.getSelections().selections).toHaveLength(2)

      const lineSession = createDocumentSession('abc\ndef')
      lineSession.setSelections([{ anchor: 1 }, { anchor: 5 }])
      editor.attachSession(lineSession)

      dispatchEditorKey('End')
      expect(resolvedSelectionRanges(lineSession)).toEqual([
        { anchor: 3, head: 3, start: 3, end: 3 },
        { anchor: 7, head: 7, start: 7, end: 7 },
      ])

      const pageSession = createDocumentSession(
        Array.from({ length: 12 }, (_value, index) => `line ${index}`).join('\n'),
      )
      pageSession.setSelections([{ anchor: 0 }, { anchor: 7 }])
      mockEditorViewport(editorRoot(), 80, 40)
      editor.attachSession(pageSession)

      dispatchEditorKey('PageDown')
      expect(pageSession.getSelections().selections).toHaveLength(2)

      const documentSession = createDocumentSession('abc\ndef')
      documentSession.setSelections([{ anchor: 1 }, { anchor: 5 }])
      editor.attachSession(documentSession)

      const documentEndKey = detectPlatform() === 'mac' ? 'ArrowDown' : 'End'
      const documentEndModifier = detectPlatform() === 'mac' ? { metaKey: true } : { ctrlKey: true }
      dispatchEditorKey(documentEndKey, documentEndModifier)
      expect(resolvedSelectionRanges(documentSession)).toEqual([
        { anchor: 7, head: 7, start: 7, end: 7 },
      ])
    })

    it('scrolls the caret into view while navigating by keyboard', () => {
      const session = createDocumentSession('0\n1\n2\n3\n4\n5')
      session.setSelection(0)
      mockEditorViewport(editorRoot(), 80, 40)
      editor.attachSession(session)

      for (let index = 0; index < 5; index += 1) dispatchEditorKey('ArrowDown')

      expect(editorRoot().scrollTop).toBeGreaterThan(0)
      expect(editor.getState().cursor).toEqual({ row: 5, column: 0 })
    })

    it('can disable default keymap bindings', () => {
      editor.dispose()
      editor = createVisibleEditor(container, { keymap: { enabled: false } })
      editor.setText('abc')

      dispatchEditorKey('ArrowLeft')

      expect(editor.getState().cursor).toEqual({ row: 0, column: 3 })
    })

    it('skips keymap change logs for equivalent keymap options', () => {
      const events: EditorLogEvent[] = []
      const keymap = (): EditorKeymapOptions => ({
        defaultBindings: false,
        layers: [
          {
            bindings: [{ command: 'cursorLeft', chord: ['ArrowLeft'] }],
            id: 'test.navigation',
          },
        ],
      })
      editor.dispose()
      editor = createVisibleEditor(container, {
        plugins: [createEditorLoggingPlugin((event) => events.push(event))],
      })
      editor.setText('abc')

      editor.setKeymap(keymap())
      editor.setKeymap(keymap())
      dispatchEditorKey('ArrowLeft')

      const keymapEvents = events.filter((event) => event.action === 'editor.keymap.changed')
      expect(editor.getState().cursor).toEqual({ row: 0, column: 2 })
      expect(keymapEvents).toHaveLength(1)
    })

    it('keeps browser selections synced to the document session', () => {
      const session = createDocumentSession('abcd')
      editor.attachSession(session)
      const textNode = rowTextNode()
      const range = document.createRange()
      range.setStart(textNode, 1)
      range.setEnd(textNode, 3)

      const selection = window.getSelection()!
      selection.removeAllRanges()
      selection.addRange(range)
      editorRoot().dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))

      const resolved = resolveSelection(
        session.getSnapshot(),
        session.getSelections().selections[0]!,
      )
      expect(resolved.startOffset).toBe(1)
      expect(resolved.endOffset).toBe(3)

      editorRoot().dispatchEvent(
        new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          data: 'X',
          inputType: 'insertText',
        }),
      )

      expect(session.materializeFullText()).toBe('aXd')
      expect(editorRoot().textContent).toBe('aXd')
    })

    it('keeps session-owned selections authoritative when browser selection drifts', () => {
      const session = createDocumentSession('abcd')
      editor.attachSession(session)

      dispatchEditorKey('a', primaryModifier())
      setNativeDomSelection(0, 0)
      document.dispatchEvent(new Event('selectionchange'))

      expect(resolvedSelectionRanges(session)).toEqual([{ anchor: 0, head: 4, start: 0, end: 4 }])

      editorInput().dispatchEvent(createPasteEvent('X'))

      expect(session.materializeFullText()).toBe('X')
      expect(resolvedSelectionRanges(session)).toEqual([{ anchor: 1, head: 1, start: 1, end: 1 }])
    })

    it('reconciles undo and redo selections before later browser selection drift', () => {
      const session = createDocumentSession('abcd')
      session.setSelection(1, 3)
      editor.attachSession(session)

      editorRoot().dispatchEvent(createInsertEvent('X'))
      editor.dispatchCommand('undo')
      setNativeDomSelection(0, 0)
      document.dispatchEvent(new Event('selectionchange'))

      expect(session.materializeFullText()).toBe('abcd')
      expect(resolvedSelectionRanges(session)).toEqual([{ anchor: 1, head: 3, start: 1, end: 3 }])

      editor.dispatchCommand('redo')
      setNativeDomSelection(0, 0)
      document.dispatchEvent(new Event('selectionchange'))

      expect(session.materializeFullText()).toBe('aXd')
      expect(resolvedSelectionRanges(session)).toEqual([{ anchor: 2, head: 2, start: 2, end: 2 }])

      editorRoot().dispatchEvent(createInsertEvent('!'))

      expect(session.materializeFullText()).toBe('aX!d')
    })

    it('renders range selections with custom selection geometry', () => {
      const session = createDocumentSession('abcd')
      editor.attachSession(session)
      const textNode = rowTextNode()
      const range = document.createRange()
      range.setStart(textNode, 1)
      range.setEnd(textNode, 3)

      const selection = window.getSelection()!
      selection.removeAllRanges()
      selection.addRange(range)
      editorRoot().dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))

      expect(selectionRanges()).toHaveLength(1)

      editorRoot().dispatchEvent(
        new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          data: 'X',
          inputType: 'insertText',
        }),
      )

      expect(selectionRanges()).toHaveLength(0)
    })

    it('adds an Option-click cursor and edits all cursors together', () => {
      const session = createDocumentSession('abcdef')
      session.setSelection(1)
      editor.attachSession(session)
      mockEditorViewport(editorRoot(), 120, 40)

      editorRoot().dispatchEvent(
        new MouseEvent('mousedown', {
          altKey: true,
          bubbles: true,
          cancelable: true,
          clientX: 34,
          clientY: 10,
          detail: 1,
        }),
      )
      editorRoot().dispatchEvent(createInsertEvent('X'))

      expect(session.getSelections().selections).toHaveLength(2)
      expect(editor.materializeFullText()).toBe('aXbcdXef')
      expect(container.querySelectorAll('.editor-virtualized-caret')).toHaveLength(2)
    })

    it('clears secondary cursors with Escape', () => {
      const session = createDocumentSession('abcdef')
      session.setSelection(1)
      session.addSelection(4)
      editor.attachSession(session)
      editor.focus()

      dispatchEditorKey('Escape')

      expect(session.getSelections().selections).toHaveLength(1)
      expect(container.querySelectorAll('.editor-virtualized-caret:not([hidden])')).toHaveLength(1)
    })

    it('leaves Escape on the cursor that was added last', () => {
      const session = createDocumentSession('abc\ndef\nghi')
      session.setSelection(5)
      editor.attachSession(session)
      mockEditorViewport(editorRoot(), 80, 60)

      expect(editor.dispatchCommand('editor.action.insertCursorBelow')).toBe(true)
      dispatchEditorKey('Escape')

      expect(resolvedSelectionRanges(session)).toEqual([{ anchor: 9, head: 9, start: 9, end: 9 }])
    })

    it('preserves the last-added cursor affinity and goal when Escape clears the others', () => {
      const session = createDocumentSession('abcdef')
      session.setSelections([
        { anchor: 1, affinity: 'after' },
        { anchor: 4, affinity: 'before', goal: SelectionGoal.horizontal(37) },
      ])
      editor.attachSession(session)

      dispatchEditorKey('Escape')

      expect(resolvedSelectionMetadata(session)).toEqual([
        {
          affinity: 'before',
          anchor: 4,
          goal: SelectionGoal.horizontal(37),
          head: 4,
        },
      ])
    })

    it('keeps extending in the same direction after two cursors collide', () => {
      const session = createDocumentSession('abcdef')
      session.setSelection(3)
      session.addSelection(5, 2)
      editor.attachSession(session)

      dispatchEditorKey('ArrowRight', { shiftKey: true })

      expect(resolvedSelectionRanges(session)).toEqual([{ anchor: 5, head: 3, start: 3, end: 5 }])
    })

    it('inserts cursors above and below through explicit editor commands', () => {
      const belowSession = createDocumentSession('abc\ndef\nghi')
      belowSession.setSelection(5)
      editor.attachSession(belowSession)
      mockEditorViewport(editorRoot(), 80, 60)

      expect(editor.dispatchCommand('editor.action.insertCursorBelow')).toBe(true)
      expect(resolvedSelectionRanges(belowSession)).toEqual([
        { anchor: 5, head: 5, start: 5, end: 5 },
        { anchor: 9, head: 9, start: 9, end: 9 },
      ])

      const aboveSession = createDocumentSession('abc\ndef\nghi')
      aboveSession.setSelections([{ anchor: 5 }, { anchor: 9 }])
      editor.attachSession(aboveSession)
      mockEditorViewport(editorRoot(), 80, 60)

      expect(editor.dispatchCommand('editor.action.insertCursorAbove')).toBe(true)
      expect(resolvedSelectionRanges(aboveSession)).toEqual([
        { anchor: 1, head: 1, start: 1, end: 1 },
        { anchor: 5, head: 5, start: 5, end: 5 },
        { anchor: 9, head: 9, start: 9, end: 9 },
      ])
    })

    it('keeps a cursor inserted from the line end riding the line ends below it', () => {
      const session = createDocumentSession('alpha\nab\nomega line')
      session.setSelection(0)
      editor.attachSession(session)
      mockEditorViewport(editorRoot(), 80, 60)

      editor.dispatchCommand('cursorLineEnd')
      editor.dispatchCommand('editor.action.insertCursorBelow')
      editor.dispatchCommand('editor.action.insertCursorBelow')

      expect(resolvedSelectionRanges(session)).toEqual([
        { anchor: 5, head: 5, start: 5, end: 5 },
        { anchor: 8, head: 8, start: 8, end: 8 },
        { anchor: 19, head: 19, start: 19, end: 19 },
      ])
    })

    it('selects the current word then adds the next exact occurrence with Mod+D', () => {
      const session = createDocumentSession('foo bar foo')
      session.setSelection(1)
      editor.attachSession(session)
      editor.focus()

      dispatchEditorKey('d', primaryModifier())

      let ranges = session.getSelections().selections.map((selection) => {
        const resolved = resolveSelection(session.getSnapshot(), selection)
        return { start: resolved.startOffset, end: resolved.endOffset }
      })
      expect(ranges).toEqual([{ start: 0, end: 3 }])

      dispatchEditorKey('d', primaryModifier())

      ranges = session.getSelections().selections.map((selection) => {
        const resolved = resolveSelection(session.getSnapshot(), selection)
        return { start: resolved.startOffset, end: resolved.endOffset }
      })
      expect(ranges).toEqual([
        { start: 0, end: 3 },
        { start: 8, end: 11 },
      ])
      expect(container.querySelectorAll('.editor-virtualized-caret')).toHaveLength(2)
    })

    it('preserves existing occurrence metadata and marks generated occurrences explicitly', () => {
      const session = createDocumentSession('foo bar foo')
      session.setSelection(0, 3, {
        affinity: 'before',
        goal: SelectionGoal.horizontal(29),
      })
      editor.attachSession(session)

      dispatchEditorKey('d', primaryModifier())

      expect(resolvedSelectionMetadata(session)).toEqual([
        {
          affinity: 'before',
          anchor: 0,
          goal: SelectionGoal.horizontal(29),
          head: 3,
        },
        { affinity: 'after', anchor: 8, goal: SelectionGoal.none(), head: 11 },
      ])
    })

    it('keeps Mod+D on an adjacent repeat as its own cursor', () => {
      const session = createDocumentSession('abab')
      session.setSelection(0, 2)
      editor.attachSession(session)

      dispatchEditorKey('d', primaryModifier())

      expect(resolvedSelectionRanges(session)).toEqual([
        { anchor: 0, head: 2, start: 0, end: 2 },
        { anchor: 2, head: 4, start: 2, end: 4 },
      ])

      editorRoot().dispatchEvent(createInsertEvent('X'))
      expect(editor.materializeFullText()).toBe('XX')
    })

    it('skips occurrences inside longer words when Mod+D starts from a caret', () => {
      const session = createDocumentSession('id width id')
      session.setSelection(1)
      editor.attachSession(session)

      dispatchEditorKey('d', primaryModifier())
      dispatchEditorKey('d', primaryModifier())

      expect(resolvedSelectionRanges(session)).toEqual([
        { anchor: 0, head: 2, start: 0, end: 2 },
        { anchor: 9, head: 11, start: 9, end: 11 },
      ])
    })

    it('matches the selected text exactly when Mod+D starts from a selection', () => {
      const session = createDocumentSession('id width id')
      session.setSelection(0, 2)
      editor.attachSession(session)

      dispatchEditorKey('d', primaryModifier())

      expect(resolvedSelectionRanges(session)).toEqual([
        { anchor: 0, head: 2, start: 0, end: 2 },
        { anchor: 4, head: 6, start: 4, end: 6 },
      ])
    })

    it('continues Mod+D from the cursor added last, not the first selection', () => {
      const session = createDocumentSession('foo bar foo bar')
      session.setSelection(0, 3)
      editor.attachSession(session)

      dispatchEditorKey('d', primaryModifier())
      session.addSelection(5)

      dispatchEditorKey('d', primaryModifier())

      expect(resolvedSelectionRanges(session)).toEqual([
        { anchor: 0, head: 3, start: 0, end: 3 },
        { anchor: 5, head: 5, start: 5, end: 5 },
        { anchor: 8, head: 11, start: 8, end: 11 },
        { anchor: 12, head: 15, start: 12, end: 15 },
      ])
    })

    it('keeps the Mod+D whole-word run out of the find widget', () => {
      const session = createDocumentSession('id width id')
      session.setSelection(1)
      editor.attachSession(session)

      dispatchEditorKey('d', primaryModifier())
      dispatchEditorKey('d', primaryModifier())
      dispatchEditorKey('f', primaryModifier())

      const toggles = container.querySelectorAll('.editor-find-input-controls .editor-find-button')
      expect(toggles[1]?.getAttribute('aria-pressed')).toBe('false')
    })

    it('selects all exact occurrences with VS Code occurrence command ids', () => {
      const highlightsSession = createDocumentSession('foo bar foo foo')
      highlightsSession.setSelection(1)
      editor.attachSession(highlightsSession)

      expect(editor.dispatchCommand('editor.action.selectHighlights')).toBe(true)
      expect(resolvedSelectionRanges(highlightsSession)).toEqual([
        { anchor: 0, head: 3, start: 0, end: 3 },
        { anchor: 8, head: 11, start: 8, end: 11 },
        { anchor: 12, head: 15, start: 12, end: 15 },
      ])

      const changeAllSession = createDocumentSession('foo bar foo bar')
      changeAllSession.setSelection(4, 7)
      editor.attachSession(changeAllSession)

      expect(editor.dispatchCommand('editor.action.changeAll')).toBe(true)
      expect(resolvedSelectionRanges(changeAllSession)).toEqual([
        { anchor: 4, head: 7, start: 4, end: 7 },
        { anchor: 12, head: 15, start: 12, end: 15 },
      ])
    })

    it('preserves the source direction and affinity when selecting all occurrences', () => {
      const session = createDocumentSession('foo bar foo')
      session.setSelection(3, 0, { affinity: 'before' })
      editor.attachSession(session)
      const view = Reflect.get(editor, 'view') as VirtualizedTextView
      const revealCaret = vi.spyOn(view, 'revealCaret')

      expect(editor.dispatchCommand('editor.action.selectHighlights')).toBe(true)
      expect(resolvedSelectionMetadata(session)).toEqual([
        { affinity: 'before', anchor: 3, goal: SelectionGoal.none(), head: 0 },
        { affinity: 'after', anchor: 8, goal: SelectionGoal.none(), head: 11 },
      ])
      expect(revealCaret).toHaveBeenLastCalledWith(0, 'before', undefined)
    })

    it('reveals the current side when adjacent matches share the same head', () => {
      const session = createDocumentSession('foofoo')
      session.setSelection(6, 3, { affinity: 'before' })
      editor.attachSession(session)
      const view = Reflect.get(editor, 'view') as VirtualizedTextView
      const revealCaret = vi.spyOn(view, 'revealCaret')

      expect(editor.dispatchCommand('editor.action.selectHighlights')).toBe(true)
      expect(resolvedSelectionMetadata(session)).toEqual([
        { affinity: 'after', anchor: 0, goal: SelectionGoal.none(), head: 3 },
        { affinity: 'before', anchor: 6, goal: SelectionGoal.none(), head: 3 },
      ])
      expect(revealCaret).toHaveBeenLastCalledWith(3, 'before', undefined)
    })

    it('preserves every existing occurrence while generating missing matches', () => {
      const session = createDocumentSession('foo foo foo')
      session.setSelections([
        {
          anchor: 3,
          affinity: 'before',
          goal: SelectionGoal.horizontal(17),
          head: 0,
        },
        {
          anchor: 7,
          affinity: 'before',
          goal: SelectionGoal.horizontal(29),
          head: 4,
        },
      ])
      editor.attachSession(session)

      expect(editor.dispatchCommand('editor.action.selectHighlights')).toBe(true)
      expect(resolvedSelectionMetadata(session)).toEqual([
        {
          affinity: 'before',
          anchor: 3,
          goal: SelectionGoal.horizontal(17),
          head: 0,
        },
        {
          affinity: 'before',
          anchor: 7,
          goal: SelectionGoal.horizontal(29),
          head: 4,
        },
        { affinity: 'after', anchor: 8, goal: SelectionGoal.none(), head: 11 },
      ])
    })

    it('moves the last selection to the next exact occurrence', () => {
      const session = createDocumentSession('foo bar foo foo')
      session.setSelection(1)
      editor.attachSession(session)

      expect(editor.dispatchCommand('editor.action.moveSelectionToNextFindMatch')).toBe(true)
      expect(resolvedSelectionRanges(session)).toEqual([{ anchor: 8, head: 11, start: 8, end: 11 }])

      session.setSelections([
        { anchor: 0, head: 3 },
        { anchor: 8, head: 11 },
      ])

      expect(editor.dispatchCommand('editor.action.moveSelectionToNextFindMatch')).toBe(true)
      expect(resolvedSelectionRanges(session)).toEqual([
        { anchor: 0, head: 3, start: 0, end: 3 },
        { anchor: 12, head: 15, start: 12, end: 15 },
      ])
    })

    it('preserves direction and affinity when moving a selection to the next occurrence', () => {
      const session = createDocumentSession('foo bar foo')
      session.setSelection(3, 0, { affinity: 'before' })
      editor.attachSession(session)
      const view = Reflect.get(editor, 'view') as VirtualizedTextView
      const revealCaret = vi.spyOn(view, 'revealCaret')

      expect(editor.dispatchCommand('editor.action.moveSelectionToNextFindMatch')).toBe(true)
      expect(resolvedSelectionMetadata(session)).toEqual([
        { affinity: 'before', anchor: 11, goal: SelectionGoal.none(), head: 8 },
      ])
      expect(revealCaret).toHaveBeenLastCalledWith(8, 'before', undefined)
    })

    it('reveals the moved side when adjacent occurrences share the same head', () => {
      const session = createDocumentSession('foofoofoo')
      session.setSelections([
        { anchor: 0, affinity: 'after', head: 3 },
        { anchor: 9, affinity: 'before', head: 6 },
      ])
      editor.attachSession(session)
      const view = Reflect.get(editor, 'view') as VirtualizedTextView
      const revealCaret = vi.spyOn(view, 'revealCaret')

      expect(editor.dispatchCommand('editor.action.moveSelectionToNextFindMatch')).toBe(true)
      expect(resolvedSelectionMetadata(session)).toEqual([
        { affinity: 'after', anchor: 0, goal: SelectionGoal.none(), head: 3 },
        { affinity: 'before', anchor: 6, goal: SelectionGoal.none(), head: 3 },
      ])
      expect(revealCaret).toHaveBeenLastCalledWith(3, 'before', undefined)
    })

    it('moves the last-added occurrence even when it sorts before the other selections', () => {
      const session = createDocumentSession('foo bar foo baz foo')
      session.setSelection(8, 11, { affinity: 'after' })
      session.addSelection(3, 0, { affinity: 'before' })
      editor.attachSession(session)
      const view = Reflect.get(editor, 'view') as VirtualizedTextView
      const revealCaret = vi.spyOn(view, 'revealCaret')

      expect(session.getSelections().lastAddedIndex).toBe(0)
      expect(editor.dispatchCommand('editor.action.moveSelectionToNextFindMatch')).toBe(true)
      expect(resolvedSelectionMetadata(session)).toEqual([
        { affinity: 'after', anchor: 8, goal: SelectionGoal.none(), head: 11 },
        {
          affinity: 'before',
          anchor: 19,
          goal: SelectionGoal.none(),
          head: 16,
        },
      ])
      expect(session.getSelections().lastAddedIndex).toBe(1)
      expect(revealCaret).toHaveBeenLastCalledWith(16, 'before', undefined)
    })

    it('reveals the wrapped occurrence when Mod+D loops to the top', () => {
      const session = createDocumentSession('foo\nx\nfoo\nx\nfoo')
      session.setSelection(7)
      editor.attachSession(session)
      mockEditorViewport(editorRoot(), 80, 40)

      dispatchEditorKey('d', primaryModifier())
      dispatchEditorKey('d', primaryModifier())

      expect(editorRoot().scrollTop).toBeGreaterThan(0)

      dispatchEditorKey('d', primaryModifier())

      const ranges = session.getSelections().selections.map((selection) => {
        const resolved = resolveSelection(session.getSnapshot(), selection)
        return { start: resolved.startOffset, end: resolved.endOffset }
      })
      expect(ranges).toEqual([
        { start: 0, end: 3 },
        { start: 6, end: 9 },
        { start: 12, end: 15 },
      ])
      expect(editorRoot().scrollTop).toBe(0)
    })

    it('leaves browser defaults alone for unhandled editor key commands', () => {
      editor.setText(' ')

      const addOccurrence = dispatchEditorKey('d', primaryModifier())
      const clearSecondary = dispatchEditorKey('Escape')

      expect(addOccurrence.defaultPrevented).toBe(false)
      expect(clearSecondary.defaultPrevented).toBe(false)
    })

    it('allows key bindings to explicitly prevent browser defaults', () => {
      editor.dispose()
      editor = createVisibleEditor(container, {
        keymap: {
          defaultBindings: false,
          layers: [
            {
              bindings: [
                {
                  command: 'addNextOccurrence',
                  chord: [{ key: 'D', mod: true }],
                  preventDefault: true,
                },
              ],
              id: 'test.prevent-default',
            },
          ],
        },
        plugins: withTestLanguagePlugins(),
      })
      editor.setText(' ')

      const addOccurrence = dispatchEditorKey('d', primaryModifier())

      expect(addOccurrence.defaultPrevented).toBe(true)
    })

    it('opens find, navigates matches, and paints find highlights', () => {
      const session = createDocumentSession('foo bar foo')
      editor.attachSession(session)

      expect(container.querySelector('.editor-find-widget')).toBeNull()

      dispatchEditorKey('f', primaryModifier())
      expect(container.querySelector('.editor-find-widget')).not.toBeNull()

      const findInput = container.querySelector('.editor-find-input') as HTMLInputElement
      findInput.value = 'foo'
      findInput.dispatchEvent(new Event('input', { bubbles: true }))

      expect([...highlightsMap.keys()].filter((name) => name.includes('find-match'))).toHaveLength(
        1,
      )
      let selection = resolveSelection(
        session.getSnapshot(),
        session.getSelections().selections[0]!,
      )
      expect({
        start: selection.startOffset,
        end: selection.endOffset,
      }).toEqual({
        start: 0,
        end: 3,
      })

      expect(editor.findNext()).toBe(true)
      selection = resolveSelection(session.getSnapshot(), session.getSelections().selections[0]!)
      expect({
        start: selection.startOffset,
        end: selection.endOffset,
      }).toEqual({
        start: 8,
        end: 11,
      })
    })

    it('toggles find closed from the editor and find input', () => {
      const session = createDocumentSession('foo')
      editor.attachSession(session)

      dispatchEditorKey('f', primaryModifier())
      const widget = container.querySelector('.editor-find-widget') as HTMLDivElement
      const findInput = container.querySelector('.editor-find-input') as HTMLInputElement

      expect(widget.hidden).toBe(false)

      const inputEvent = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'f',
        ...primaryModifier(),
      })
      findInput.dispatchEvent(inputEvent)

      expect(inputEvent.defaultPrevented).toBe(true)
      expect(widget.hidden).toBe(true)

      dispatchEditorKey('f', primaryModifier())
      expect(widget.hidden).toBe(false)

      dispatchEditorKey('f', primaryModifier())
      expect(widget.hidden).toBe(true)
    })

    it('replaces one and replace-all is one undoable edit', () => {
      const session = createDocumentSession('foo foo foo')
      editor.attachSession(session)

      editor.openFindReplace()
      const inputs = container.querySelectorAll('.editor-find-input')
      const findInput = inputs[0] as HTMLInputElement
      const replaceInput = inputs[1] as HTMLInputElement
      findInput.value = 'foo'
      findInput.dispatchEvent(new Event('input', { bubbles: true }))
      replaceInput.value = 'bar'
      replaceInput.dispatchEvent(new Event('input', { bubbles: true }))

      expect(editor.replaceOne()).toBe(true)
      expect(editor.materializeFullText()).toBe('bar foo foo')

      expect(editor.replaceAll()).toBe(true)
      expect(editor.materializeFullText()).toBe('bar bar bar')

      editor.dispatchCommand('undo')
      expect(editor.materializeFullText()).toBe('bar foo foo')
    })

    it('toggles the replace row from the find widget', () => {
      const session = createDocumentSession('foo')
      editor.attachSession(session)

      expect(editor.openFind()).toBe(true)
      const replaceRow = container.querySelector('.editor-find-replace-row') as HTMLDivElement
      const toggle = container.querySelector('.editor-find-replace-toggle') as HTMLButtonElement
      const matchCase = container.querySelector('button[title="Match Case (Off)"]')

      expect(replaceRow.hidden).toBe(true)
      expect(toggle.getAttribute('aria-expanded')).toBe('false')
      expect(toggle.title).toBe('Show Replace')
      expect(matchCase).not.toBeNull()

      toggle.click()

      expect(replaceRow.hidden).toBe(false)
      expect(toggle.getAttribute('aria-expanded')).toBe('true')
      expect(toggle.title).toBe('Hide Replace')
    })

    it('find-in-selection and select-all matches create multi-selections', () => {
      const session = createDocumentSession('foo outside foo inside foo')
      session.setSelection(12, 26)
      editor.attachSession(session)

      editor.openFind()
      expect(editor.dispatchCommand('toggleFindInSelection')).toBe(true)
      const findInput = container.querySelector('.editor-find-input') as HTMLInputElement
      findInput.value = 'foo'
      findInput.dispatchEvent(new Event('input', { bubbles: true }))
      expect(editor.selectAllMatches()).toBe(true)

      const ranges = session.getSelections().selections.map((selection) => {
        const resolved = resolveSelection(session.getSnapshot(), selection)
        return { start: resolved.startOffset, end: resolved.endOffset }
      })
      expect(ranges).toEqual([
        { start: 12, end: 15 },
        { start: 23, end: 26 },
      ])
    })

    it('updates custom selection immediately while dragging', () => {
      const session = createDocumentSession('abcd')
      editor.attachSession(session)
      mockEditorViewport(editorRoot(), 120, 40)

      const mouseDown = new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        clientX: 10,
        clientY: 10,
        detail: 1,
      })
      editorRoot().dispatchEvent(mouseDown)
      document.dispatchEvent(
        new MouseEvent('mousemove', {
          cancelable: true,
          clientX: 30,
          clientY: 10,
        }),
      )

      expect(mouseDown.defaultPrevented).toBe(true)
      expect(selectionRanges()).toHaveLength(1)

      let resolved = resolveSelection(session.getSnapshot(), session.getSelections().selections[0]!)
      expect(resolved.startOffset).toBe(1)
      expect(resolved.endOffset).toBe(3)

      document.dispatchEvent(
        new MouseEvent('mouseup', {
          cancelable: true,
          clientX: 30,
          clientY: 10,
        }),
      )

      resolved = resolveSelection(session.getSnapshot(), session.getSelections().selections[0]!)
      expect(resolved.startOffset).toBe(1)
      expect(resolved.endOffset).toBe(3)
    })

    it('keeps the browser affinity for an unsnapped character drag', () => {
      const session = createDocumentSession('abcd')
      editor.attachSession(session)
      mockEditorViewport(editorRoot(), 120, 40)
      const view = Reflect.get(editor, 'view') as VirtualizedTextView
      vi.spyOn(view, 'textPositionFromPoint')
        .mockReturnValueOnce({
          affinity: 'after',
          displayRow: 0,
          offset: 1,
          rowX: 8,
        })
        .mockReturnValueOnce({
          affinity: 'after',
          displayRow: 0,
          offset: 3,
          rowX: 24,
        })

      pressMouse({ clientX: 8, clientY: 10 })
      moveMouse({ clientX: 24, clientY: 10 })
      releaseMouse({ clientX: 24, clientY: 10 })

      expect(resolvedSelectionMetadata(session)).toEqual([
        { affinity: 'after', anchor: 1, goal: SelectionGoal.none(), head: 3 },
      ])
    })

    it('ignores browser selectionchange while dragging', () => {
      const session = createDocumentSession('abcd')
      editor.attachSession(session)
      mockEditorViewport(editorRoot(), 120, 40)

      editorRoot().dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          cancelable: true,
          clientX: 10,
          clientY: 10,
          detail: 1,
        }),
      )
      document.dispatchEvent(
        new MouseEvent('mousemove', {
          cancelable: true,
          clientX: 30,
          clientY: 10,
        }),
      )

      const staleRange = document.createRange()
      const textNode = rowTextNode()
      staleRange.setStart(textNode, 0)
      staleRange.setEnd(textNode, 0)
      const selection = window.getSelection()!
      selection.removeAllRanges()
      selection.addRange(staleRange)
      document.dispatchEvent(new Event('selectionchange'))

      const resolved = resolveSelection(
        session.getSnapshot(),
        session.getSelections().selections[0]!,
      )
      expect(resolved.startOffset).toBe(1)
      expect(resolved.endOffset).toBe(3)

      document.dispatchEvent(
        new MouseEvent('mouseup', {
          cancelable: true,
          clientX: 30,
          clientY: 10,
        }),
      )
    })

    it('moves the hidden input window with a pointer drag selection', () => {
      const session = createDocumentSession('abcd')
      editor.attachSession(session)
      editor.focus()
      mockEditorViewport(editorRoot(), 120, 40)

      const textNode = rowTextNode()
      const original = (
        document as Document & {
          caretRangeFromPoint?: (x: number, y: number) => Range | null
        }
      ).caretRangeFromPoint
      Object.defineProperty(document, 'caretRangeFromPoint', {
        configurable: true,
        value: (x: number) => {
          const range = document.createRange()
          const offset = x <= 10 ? 1 : 3
          range.setStart(textNode, offset)
          range.setEnd(textNode, offset)
          return range
        },
      })

      try {
        pressMouse({ clientX: 10, clientY: 10 })
        moveMouse({ clientX: 30, clientY: 10 })
        releaseMouse({ clientX: 30, clientY: 10 })
      } finally {
        if (original) {
          Object.defineProperty(document, 'caretRangeFromPoint', {
            configurable: true,
            value: original,
          })
        } else {
          Reflect.deleteProperty(document, 'caretRangeFromPoint')
        }
      }

      expect(hiddenInputWindow()).toEqual({
        selectionEnd: 3,
        selectionStart: 1,
        value: 'abcd',
      })
    })

    it('renders and copies pointer drag selections with selection sync disabled', () => {
      editor.dispose()
      editor = createVisibleEditor(container, {
        defaultText: 'abcd',
        selectionSyncMode: 'none',
      })
      mockEditorViewport(editorRoot(), 120, 40)
      const nativeSelection = spyOnNativeSelection()

      try {
        editorRoot().dispatchEvent(
          new MouseEvent('mousedown', {
            bubbles: true,
            cancelable: true,
            clientX: 10,
            clientY: 10,
            detail: 1,
          }),
        )
        document.dispatchEvent(
          new MouseEvent('mousemove', {
            cancelable: true,
            clientX: 30,
            clientY: 10,
          }),
        )
        document.dispatchEvent(
          new MouseEvent('mouseup', {
            cancelable: true,
            clientX: 30,
            clientY: 10,
          }),
        )

        expect(selectionRanges()).toHaveLength(1)
        expect(nativeSelection.addRange).not.toHaveBeenCalled()

        const copy = createCopyEvent()
        editorRoot().dispatchEvent(copy.event)

        expect(copy.materializeFullText()).toBe('bc')
      } finally {
        nativeSelection.restore()
      }
    })

    it('continues dragging selection when pointer hit-testing leaves the text', () => {
      const session = createDocumentSession('abcd')
      editor.attachSession(session)
      mockEditorViewport(editorRoot(), 120, 40)

      const textNode = rowTextNode()
      const originalCaretRangeFromPoint = (
        document as Document & {
          caretRangeFromPoint?: (x: number, y: number) => Range | null
        }
      ).caretRangeFromPoint
      Object.defineProperty(document, 'caretRangeFromPoint', {
        configurable: true,
        value: (x: number) => {
          if (x !== 10) return null

          const range = document.createRange()
          range.setStart(textNode, 1)
          range.setEnd(textNode, 1)
          return range
        },
      })

      editorRoot().dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          cancelable: true,
          clientX: 10,
          clientY: 10,
          detail: 1,
        }),
      )
      document.dispatchEvent(
        new MouseEvent('mousemove', {
          cancelable: true,
          clientX: 120,
          clientY: 10,
        }),
      )
      document.dispatchEvent(
        new MouseEvent('mouseup', {
          cancelable: true,
          clientX: 120,
          clientY: 10,
        }),
      )

      if (originalCaretRangeFromPoint) {
        Object.defineProperty(document, 'caretRangeFromPoint', {
          configurable: true,
          value: originalCaretRangeFromPoint,
        })
      } else {
        Reflect.deleteProperty(document, 'caretRangeFromPoint')
      }

      const resolved = resolveSelection(
        session.getSnapshot(),
        session.getSelections().selections[0]!,
      )
      expect(resolved.startOffset).toBe(1)
      expect(resolved.endOffset).toBe(4)
    })

    it('auto-scrolls while dragging selection past the viewport edge', () => {
      const session = createDocumentSession('0\n1\n2\n3\n4\n5')
      editor.attachSession(session)
      mockEditorViewport(editorRoot(), 80, 40)

      const textNode = rowTextNode()
      const originalCaretRangeFromPoint = (
        document as Document & {
          caretRangeFromPoint?: (x: number, y: number) => Range | null
        }
      ).caretRangeFromPoint
      Object.defineProperty(document, 'caretRangeFromPoint', {
        configurable: true,
        value: (x: number) => {
          if (x !== 0) return null

          const range = document.createRange()
          range.setStart(textNode, 0)
          range.setEnd(textNode, 0)
          return range
        },
      })

      editorRoot().dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          cancelable: true,
          clientX: 0,
          clientY: 5,
          detail: 1,
        }),
      )
      document.dispatchEvent(
        new MouseEvent('mousemove', {
          cancelable: true,
          clientX: 80,
          clientY: 45,
        }),
      )
      document.dispatchEvent(
        new MouseEvent('mouseup', {
          cancelable: true,
          clientX: 80,
          clientY: 45,
        }),
      )

      if (originalCaretRangeFromPoint) {
        Object.defineProperty(document, 'caretRangeFromPoint', {
          configurable: true,
          value: originalCaretRangeFromPoint,
        })
      } else {
        Reflect.deleteProperty(document, 'caretRangeFromPoint')
      }

      const resolved = resolveSelection(
        session.getSnapshot(),
        session.getSelections().selections[0]!,
      )
      expect(editorRoot().scrollTop).toBeGreaterThan(0)
      expect(resolved.endOffset).toBeGreaterThan(4)
    })

    it('auto-scrolls sideways while dragging selection past the viewport edge', () => {
      const session = createDocumentSession('a'.repeat(400))
      editor.attachSession(session)
      mockEditorViewport(editorRoot(), 80, 40)
      mockEditorHorizontalViewport(editorRoot(), 80, 800)

      editorRoot().dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          cancelable: true,
          clientX: 0,
          clientY: 5,
          detail: 1,
        }),
      )
      document.dispatchEvent(
        new MouseEvent('mousemove', {
          cancelable: true,
          clientX: 120,
          clientY: 5,
        }),
      )
      document.dispatchEvent(
        new MouseEvent('mouseup', {
          cancelable: true,
          clientX: 120,
          clientY: 5,
        }),
      )

      expect(editorRoot().scrollLeft).toBeGreaterThan(0)
      expect(editorRoot().scrollTop).toBe(0)
    })

    it('snaps to the bottom visible line end when dragging below the viewport', () => {
      const session = createDocumentSession('alpha\nbeta')
      editor.attachSession(session)
      mockEditorViewport(editorRoot(), 80, 40, 40)

      const textNode = rowTextNode()
      const originalCaretRangeFromPoint = (
        document as Document & {
          caretRangeFromPoint?: (x: number, y: number) => Range | null
        }
      ).caretRangeFromPoint
      Object.defineProperty(document, 'caretRangeFromPoint', {
        configurable: true,
        value: (x: number) => {
          if (x !== 0) return null

          const range = document.createRange()
          range.setStart(textNode, 0)
          range.setEnd(textNode, 0)
          return range
        },
      })

      editorRoot().dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          cancelable: true,
          clientX: 0,
          clientY: 5,
          detail: 1,
        }),
      )
      document.dispatchEvent(
        new MouseEvent('mousemove', {
          cancelable: true,
          clientX: 8,
          clientY: 45,
        }),
      )
      document.dispatchEvent(
        new MouseEvent('mouseup', {
          cancelable: true,
          clientX: 8,
          clientY: 45,
        }),
      )

      if (originalCaretRangeFromPoint) {
        Object.defineProperty(document, 'caretRangeFromPoint', {
          configurable: true,
          value: originalCaretRangeFromPoint,
        })
      } else {
        Reflect.deleteProperty(document, 'caretRangeFromPoint')
      }

      const resolved = resolveSelection(
        session.getSnapshot(),
        session.getSelections().selections[0]!,
      )
      expect(resolved.startOffset).toBe(0)
      expect(resolved.endOffset).toBe(10)
    })

    it('clamps cross-boundary browser selections before text input', () => {
      const before = document.createElement('span')
      before.textContent = 'outside before'
      const after = document.createElement('span')
      after.textContent = 'outside after'
      container.before(before)
      container.after(after)

      const session = createDocumentSession('abcd')
      editor.attachSession(session)
      const textNode = rowTextNode()
      const range = document.createRange()
      range.setStart(before.firstChild!, 0)
      range.setEnd(textNode, 2)

      const selection = window.getSelection()!
      selection.removeAllRanges()
      selection.addRange(range)
      editorRoot().dispatchEvent(
        new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          data: 'X',
          inputType: 'insertText',
        }),
      )

      expect(session.materializeFullText()).toBe('Xcd')
      expect(editorRoot().textContent).toBe('Xcd')
      before.remove()
      after.remove()
    })

    it('selects the current line on triple click', () => {
      const session = createDocumentSession('one\ntwo\nthree')
      editor.attachSession(session)
      mockEditorViewport(editorRoot(), 120, 80)

      editorRoot().dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          cancelable: true,
          clientX: 10,
          clientY: 30,
          detail: 3,
        }),
      )

      const resolved = resolveSelection(
        session.getSnapshot(),
        session.getSelections().selections[0]!,
      )
      expect(resolved.startOffset).toBe(4)
      expect(resolved.endOffset).toBe(7)

      editorRoot().dispatchEvent(
        new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          data: 'X',
          inputType: 'insertText',
        }),
      )

      expect(session.materializeFullText()).toBe('one\nX\nthree')
      expect(editor.materializeFullText()).toBe('one\nX\nthree')
    })

    it('selects the full document on quad click', () => {
      const session = createDocumentSession('abcd')
      editor.attachSession(session)

      editorRoot().dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          cancelable: true,
          detail: 4,
        }),
      )

      const resolved = resolveSelection(
        session.getSnapshot(),
        session.getSelections().selections[0]!,
      )
      expect(resolved.startOffset).toBe(0)
      expect(resolved.endOffset).toBe(4)

      editorRoot().dispatchEvent(
        new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          data: 'X',
          inputType: 'insertText',
        }),
      )

      expect(session.materializeFullText()).toBe('X')
      expect(editorRoot().textContent).toBe('X')
    })

    it('selects a word on double click', () => {
      const session = createDocumentSession('alpha beta')
      editor.attachSession(session)

      const textNode = rowTextNode()
      const range = document.createRange()
      range.setStart(textNode, 8)
      range.setEnd(textNode, 8)
      const originalCaretRangeFromPoint = (
        document as Document & {
          caretRangeFromPoint?: (x: number, y: number) => Range | null
        }
      ).caretRangeFromPoint
      Object.defineProperty(document, 'caretRangeFromPoint', {
        configurable: true,
        value: () => range,
      })

      editorRoot().dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          cancelable: true,
          clientX: 10,
          clientY: 10,
          detail: 2,
        }),
      )
      if (originalCaretRangeFromPoint) {
        Object.defineProperty(document, 'caretRangeFromPoint', {
          configurable: true,
          value: originalCaretRangeFromPoint,
        })
      } else {
        Reflect.deleteProperty(document, 'caretRangeFromPoint')
      }

      const resolved = resolveSelection(
        session.getSnapshot(),
        session.getSelections().selections[0]!,
      )
      expect(resolved.startOffset).toBe(6)
      expect(resolved.endOffset).toBe(10)

      editorRoot().dispatchEvent(
        new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          data: 'X',
          inputType: 'insertText',
        }),
      )

      expect(session.materializeFullText()).toBe('alpha X')
      expect(editorRoot().textContent).toBe('alpha X')
    })

    it('selects the double-clicked word on a line the document does not start with', () => {
      const session = createDocumentSession('one\ntwo\nthree\nfour\nalpha beta')
      editor.attachSession(session)
      mockEditorViewport(editorRoot(), 400, 200)

      editorRoot().dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          cancelable: true,
          clientX: 10,
          clientY: 120,
          detail: 2,
        }),
      )

      const resolved = resolveSelection(
        session.getSnapshot(),
        session.getSelections().selections[0]!,
      )
      expect(resolved.startOffset).toBe(19)
      expect(resolved.endOffset).toBe(24)
    })

    it('keeps a multi-click selection when stale DOM selection events arrive', () => {
      const session = createDocumentSession('alpha beta')
      editor.attachSession(session)

      const textNode = rowTextNode()
      const range = document.createRange()
      range.setStart(textNode, 8)
      range.setEnd(textNode, 8)
      const originalCaretRangeFromPoint = (
        document as Document & {
          caretRangeFromPoint?: (x: number, y: number) => Range | null
        }
      ).caretRangeFromPoint
      Object.defineProperty(document, 'caretRangeFromPoint', {
        configurable: true,
        value: () => range,
      })

      editorRoot().dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          cancelable: true,
          clientX: 10,
          clientY: 10,
          detail: 2,
        }),
      )
      if (originalCaretRangeFromPoint) {
        Object.defineProperty(document, 'caretRangeFromPoint', {
          configurable: true,
          value: originalCaretRangeFromPoint,
        })
      } else {
        Reflect.deleteProperty(document, 'caretRangeFromPoint')
      }

      const staleRange = document.createRange()
      staleRange.setStart(textNode, 0)
      staleRange.setEnd(textNode, 0)
      const selection = window.getSelection()!
      selection.removeAllRanges()
      selection.addRange(staleRange)
      editorRoot().dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
      document.dispatchEvent(new Event('selectionchange'))

      const resolved = resolveSelection(
        session.getSnapshot(),
        session.getSelections().selections[0]!,
      )
      expect(resolved.startOffset).toBe(6)
      expect(resolved.endOffset).toBe(10)
      expect(selectionRanges()).toHaveLength(1)

      editorRoot().dispatchEvent(
        new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          data: 'X',
          inputType: 'insertText',
        }),
      )

      expect(session.materializeFullText()).toBe('alpha X')
      expect(editorRoot().textContent).toBe('alpha X')
    })

    it('extends the selection from the previous press on a shift click', () => {
      const session = createDocumentSession('alpha bravo')
      editor.attachSession(session)
      mockEditorViewport(editorRoot(), 200, 200, 200)

      pressMouse({ clientX: 16, clientY: 10 })
      releaseMouse({ clientX: 16, clientY: 10 })
      const shiftClick = pressMouse({
        clientX: 56,
        clientY: 10,
        shiftKey: true,
      })

      expect(shiftClick.defaultPrevented).toBe(true)
      expect(resolvedSelectionRanges(session)).toEqual([{ anchor: 2, head: 7, start: 2, end: 7 }])
    })

    it('extends a select-all from its own anchor rather than the click before it', () => {
      const session = createDocumentSession('alpha bravo')
      editor.attachSession(session)
      mockEditorViewport(editorRoot(), 200, 200, 200)

      pressMouse({ clientX: 16, clientY: 10 })
      releaseMouse({ clientX: 16, clientY: 10 })
      dispatchEditorKey('a', primaryModifier())
      pressMouse({ clientX: 40, clientY: 10, shiftKey: true })
      releaseMouse({ clientX: 40, clientY: 10 })

      expect(resolvedSelectionRanges(session)).toEqual([{ anchor: 0, head: 5, start: 0, end: 5 }])
    })

    it('extends a shift arrow selection from its anchor, not its head', () => {
      const session = createDocumentSession('alpha bravo')
      editor.attachSession(session)
      mockEditorViewport(editorRoot(), 200, 200, 200)

      pressMouse({ clientX: 40, clientY: 10 })
      releaseMouse({ clientX: 40, clientY: 10 })
      dispatchEditorKey('ArrowLeft')
      dispatchEditorKey('ArrowLeft')
      dispatchEditorKey('ArrowLeft', { shiftKey: true })
      dispatchEditorKey('ArrowLeft', { shiftKey: true })
      dispatchEditorKey('ArrowLeft', { shiftKey: true })

      expect(resolvedSelectionRanges(session)).toEqual([{ anchor: 3, head: 0, start: 0, end: 3 }])

      pressMouse({ clientX: 56, clientY: 10, shiftKey: true })
      releaseMouse({ clientX: 56, clientY: 10 })

      expect(resolvedSelectionRanges(session)).toEqual([{ anchor: 3, head: 7, start: 3, end: 7 }])
    })

    it('keeps a double-clicked word selected when a shift click lands on its first character', () => {
      const session = createDocumentSession('alpha bravo charlie')
      editor.attachSession(session)
      mockEditorViewport(editorRoot(), 200, 200, 200)

      pressMouse({ clientX: 64, clientY: 10, detail: 2 })
      releaseMouse({ clientX: 64, clientY: 10 })
      pressMouse({ clientX: 48, clientY: 10, shiftKey: true })
      releaseMouse({ clientX: 48, clientY: 10 })

      expect(resolvedSelectionRanges(session)).toEqual([{ anchor: 11, head: 6, start: 6, end: 11 }])
    })

    it('keeps the dragged selection when the button comes up past the last line', () => {
      const session = createDocumentSession('alpha bravo')
      editor.attachSession(session)
      mockEditorViewport(editorRoot(), 200, 200, 200)

      pressMouse({ clientX: 16, clientY: 10 })
      moveMouse({ clientX: 56, clientY: 10 })
      releaseMouse({ clientX: 56, clientY: 400 })

      expect(resolvedSelectionRanges(session)).toEqual([{ anchor: 2, head: 7, start: 2, end: 7 }])
    })

    it('carries the selected text to where a drag from inside it lets go', () => {
      const session = createDocumentSession('alpha bravo')
      editor.attachSession(session)
      mockEditorViewport(editorRoot(), 200, 200, 200)

      pressMouse({ clientX: 0, clientY: 10 })
      releaseMouse({ clientX: 0, clientY: 10 })
      const caretAtDropPoint = caretTransform()

      pressMouse({ clientX: 48, clientY: 10 })
      moveMouse({ clientX: 88, clientY: 10 })
      releaseMouse({ clientX: 88, clientY: 10 })

      expect(resolvedSelectionRanges(session)).toEqual([{ anchor: 6, head: 11, start: 6, end: 11 }])

      pressMouse({ clientX: 64, clientY: 10 })
      moveMouse({ clientX: 0, clientY: 10 })

      expect(caretTransform()).toBe(caretAtDropPoint)
      expect(session.materializeFullText()).toBe('alpha bravo')

      releaseMouse({ clientX: 0, clientY: 10 })

      expect(session.materializeFullText()).toBe('bravoalpha ')
      expect(editorRoot().textContent).toBe('bravoalpha ')
      expect(resolvedSelectionRanges(session)).toEqual([{ anchor: 0, head: 5, start: 0, end: 5 }])
    })

    it('preserves direction and affinity when carrying selected text', () => {
      const session = createDocumentSession('alpha bravo')
      session.setSelection(11, 6, { affinity: 'before' })
      editor.attachSession(session)
      mockEditorViewport(editorRoot(), 200, 200, 200)

      pressMouse({ clientX: 64, clientY: 10 })
      moveMouse({ clientX: 0, clientY: 10 })
      releaseMouse({ clientX: 0, clientY: 10 })

      expect(session.materializeFullText()).toBe('bravoalpha ')
      expect(resolvedSelectionMetadata(session)).toEqual([
        { affinity: 'before', anchor: 5, goal: SelectionGoal.none(), head: 0 },
      ])
    })

    it('leaves the original behind when the copy modifier is down at the release', () => {
      const session = createDocumentSession('alpha bravo')
      editor.attachSession(session)
      mockEditorViewport(editorRoot(), 200, 200, 200)

      pressMouse({ clientX: 48, clientY: 10 })
      moveMouse({ clientX: 88, clientY: 10 })
      releaseMouse({ clientX: 88, clientY: 10 })
      pressMouse({ clientX: 64, clientY: 10 })
      moveMouse({ clientX: 0, clientY: 10 })
      releaseMouse({ altKey: true, clientX: 0, clientY: 10 })

      expect(session.materializeFullText()).toBe('bravoalpha bravo')
      expect(editorRoot().textContent).toBe('bravoalpha bravo')
      expect(resolvedSelectionRanges(session)).toEqual([{ anchor: 0, head: 5, start: 0, end: 5 }])
    })

    it('places the caret where a click inside the selection landed', () => {
      const session = createDocumentSession('alpha bravo')
      editor.attachSession(session)
      mockEditorViewport(editorRoot(), 200, 200, 200)

      pressMouse({ clientX: 48, clientY: 10 })
      moveMouse({ clientX: 88, clientY: 10 })
      releaseMouse({ clientX: 88, clientY: 10 })
      const view = Reflect.get(editor, 'view') as VirtualizedTextView
      vi.spyOn(view, 'textPositionFromPoint').mockReturnValue({
        affinity: 'before',
        displayRow: 0,
        offset: 8,
        rowX: 64,
      })
      pressMouse({ clientX: 64, clientY: 10 })
      releaseMouse({ clientX: 64, clientY: 10 })

      expect(session.materializeFullText()).toBe('alpha bravo')
      expect(resolvedSelectionRanges(session)).toEqual([{ anchor: 8, head: 8, start: 8, end: 8 }])
      expect(resolvedSelectionMetadata(session)[0]?.affinity).toBe('before')
    })

    it('recognizes movement between two visual sides of the same selected-text offset', () => {
      const session = createDocumentSession('alpha bravo')
      session.setSelection(6, 11, { affinity: 'before' })
      editor.attachSession(session)
      mockEditorViewport(editorRoot(), 200, 200, 200)
      const view = Reflect.get(editor, 'view') as VirtualizedTextView
      vi.spyOn(view, 'textPositionFromPoint')
        .mockReturnValueOnce({
          affinity: 'before',
          displayRow: 0,
          offset: 8,
          rowX: 64,
        })
        .mockReturnValueOnce({
          affinity: 'after',
          displayRow: 0,
          offset: 8,
          rowX: 64,
        })

      pressMouse({ clientX: 64, clientY: 10 })
      moveMouse({ clientX: 64, clientY: 10 })
      releaseMouse({ clientX: 64, clientY: 10 })

      expect(session.materializeFullText()).toBe('alpha bravo')
      expect(resolvedSelectionMetadata(session)).toEqual([
        { affinity: 'before', anchor: 6, goal: SelectionGoal.none(), head: 11 },
      ])
    })

    it('keeps the selection when a drag out of it comes back inside', () => {
      const session = createDocumentSession('alpha bravo')
      editor.attachSession(session)
      mockEditorViewport(editorRoot(), 200, 200, 200)

      pressMouse({ clientX: 48, clientY: 10 })
      moveMouse({ clientX: 88, clientY: 10 })
      releaseMouse({ clientX: 88, clientY: 10 })
      pressMouse({ clientX: 64, clientY: 10 })
      moveMouse({ clientX: 16, clientY: 10 })
      moveMouse({ clientX: 72, clientY: 10 })
      releaseMouse({ clientX: 72, clientY: 10 })

      expect(session.materializeFullText()).toBe('alpha bravo')
      expect(resolvedSelectionRanges(session)).toEqual([{ anchor: 6, head: 11, start: 6, end: 11 }])
      expect(selectionRanges()).toHaveLength(1)
    })

    it('carries the selected text forward without following its own removal', () => {
      const session = createDocumentSession('alpha bravo')
      editor.attachSession(session)
      mockEditorViewport(editorRoot(), 200, 200, 200)

      pressMouse({ clientX: 0, clientY: 10 })
      moveMouse({ clientX: 40, clientY: 10 })
      releaseMouse({ clientX: 40, clientY: 10 })
      pressMouse({ clientX: 16, clientY: 10 })
      moveMouse({ clientX: 88, clientY: 10 })
      releaseMouse({ clientX: 88, clientY: 10 })

      expect(session.materializeFullText()).toBe(' bravoalpha')
      expect(resolvedSelectionRanges(session)).toEqual([{ anchor: 6, head: 11, start: 6, end: 11 }])
    })

    it('starts a fresh selection when the press lands on the edge of one', () => {
      const session = createDocumentSession('alpha bravo charlie')
      editor.attachSession(session)
      mockEditorViewport(editorRoot(), 200, 200, 200)

      pressMouse({ clientX: 48, clientY: 10 })
      moveMouse({ clientX: 88, clientY: 10 })
      releaseMouse({ clientX: 88, clientY: 10 })
      pressMouse({ clientX: 88, clientY: 10 })
      moveMouse({ clientX: 152, clientY: 10 })
      releaseMouse({ clientX: 152, clientY: 10 })

      expect(session.materializeFullText()).toBe('alpha bravo charlie')
      expect(resolvedSelectionRanges(session)).toEqual([
        { anchor: 11, head: 19, start: 11, end: 19 },
      ])
    })

    it('does not carry text out of a readonly document', () => {
      editor.dispose()
      editor = createVisibleEditor(container, {
        defaultText: 'alpha bravo',
        editability: 'readonly',
      })
      mockEditorViewport(editorRoot(), 200, 200, 200)

      pressMouse({ clientX: 48, clientY: 10 })
      moveMouse({ clientX: 88, clientY: 10 })
      releaseMouse({ clientX: 88, clientY: 10 })
      pressMouse({ clientX: 64, clientY: 10 })
      moveMouse({ clientX: 0, clientY: 10 })
      releaseMouse({ clientX: 0, clientY: 10 })

      expect(editor.materializeFullText()).toBe('alpha bravo')
    })

    it('marks the drop point with a caret while a drag from outside crosses the text', () => {
      const session = createDocumentSession('alpha bravo')
      editor.attachSession(session)
      mockEditorViewport(editorRoot(), 200, 200, 200)

      pressMouse({ clientX: 56, clientY: 10 })
      releaseMouse({ clientX: 56, clientY: 10 })
      const caretAtDropPoint = caretTransform()

      pressMouse({ clientX: 0, clientY: 10 })
      moveMouse({ clientX: 40, clientY: 10 })
      releaseMouse({ clientX: 40, clientY: 10 })

      expect(caretTransform()).not.toBe(caretAtDropPoint)

      editorRoot().dispatchEvent(createDragOverEvent({ clientX: 56, clientY: 10 }))

      expect(caretTransform()).toBe(caretAtDropPoint)
      expect(resolvedSelectionRanges(session)).toEqual([{ anchor: 0, head: 5, start: 0, end: 5 }])

      editorRoot().dispatchEvent(createDragLeaveEvent(rowTextNode().parentElement))

      expect(caretTransform()).toBe(caretAtDropPoint)

      editorRoot().dispatchEvent(createDragLeaveEvent(null))

      expect(caretTransform()).not.toBe(caretAtDropPoint)
      expect(selectionRanges()).toHaveLength(1)
    })

    it('selects whole words while dragging out of a double click', () => {
      const session = createDocumentSession('alpha bravo charlie')
      editor.attachSession(session)
      mockEditorViewport(editorRoot(), 200, 200, 200)
      const view = Reflect.get(editor, 'view') as VirtualizedTextView
      vi.spyOn(view, 'textPositionFromPoint')
        .mockReturnValueOnce({
          affinity: 'before',
          displayRow: 0,
          offset: 8,
          rowX: 64,
        })
        .mockReturnValueOnce({
          affinity: 'before',
          displayRow: 0,
          offset: 2,
          rowX: 16,
        })

      pressMouse({ clientX: 64, clientY: 10, detail: 2 })
      moveMouse({ clientX: 16, clientY: 10 })

      expect(resolvedSelectionRanges(session)).toEqual([{ anchor: 11, head: 0, start: 0, end: 11 }])

      releaseMouse({ clientX: 16, clientY: 10 })

      expect(resolvedSelectionRanges(session)).toEqual([{ anchor: 11, head: 0, start: 0, end: 11 }])
      expect(resolvedSelectionMetadata(session)[0]?.affinity).toBe('after')
    })

    it('selects whole lines while dragging out of a triple click', () => {
      const session = createDocumentSession('one\ntwo\nthree')
      editor.attachSession(session)
      mockEditorViewport(editorRoot(), 200, 200, 200)
      const view = Reflect.get(editor, 'view') as VirtualizedTextView
      vi.spyOn(view, 'textPositionFromPoint')
        .mockReturnValueOnce({
          affinity: 'after',
          displayRow: 1,
          offset: 5,
          rowX: 8,
        })
        .mockReturnValueOnce({
          affinity: 'after',
          displayRow: 2,
          offset: 9,
          rowX: 8,
        })

      pressMouse({ clientX: 8, clientY: 30, detail: 3 })
      moveMouse({ clientX: 8, clientY: 54 })
      releaseMouse({ clientX: 8, clientY: 54 })

      expect(resolvedSelectionRanges(session)).toEqual([{ anchor: 4, head: 13, start: 4, end: 13 }])
      expect(resolvedSelectionMetadata(session)[0]?.affinity).toBe('before')
    })

    it('drags a column of cursors that skips lines ending before the rectangle', () => {
      const session = createDocumentSession('alpha bravo\nxy\ngamma delta')
      editor.attachSession(session)
      mockEditorViewport(editorRoot(), 200, 200, 200)

      pressMouse({ clientX: 32, clientY: 10 })
      releaseMouse({ clientX: 32, clientY: 10 })
      pressMouse({ altKey: true, clientX: 56, clientY: 10, shiftKey: true })
      moveMouse({ clientX: 56, clientY: 58 })
      releaseMouse({ clientX: 56, clientY: 58 })

      expect(resolvedSelectionRanges(session)).toEqual([
        { anchor: 4, head: 7, start: 4, end: 7 },
        { anchor: 19, head: 22, start: 19, end: 22 },
      ])
    })

    it('pushes the column rectangle with the keyboard chords', () => {
      const session = createDocumentSession('alpha bravo\nxy\ngamma delta')
      editor.attachSession(session)
      mockEditorViewport(editorRoot(), 200, 200, 200)

      pressMouse({ clientX: 32, clientY: 10 })
      releaseMouse({ clientX: 32, clientY: 10 })

      expect(dispatchDefaultKey('cursorColumnSelectDown').defaultPrevented).toBe(true)
      expect(dispatchDefaultKey('cursorColumnSelectDown').defaultPrevented).toBe(true)
      expect(resolvedSelectionRanges(session)).toEqual([
        { anchor: 4, head: 4, start: 4, end: 4 },
        { anchor: 14, head: 14, start: 14, end: 14 },
        { anchor: 19, head: 19, start: 19, end: 19 },
      ])

      expect(dispatchDefaultKey('cursorColumnSelectRight').defaultPrevented).toBe(true)
      expect(resolvedSelectionRanges(session)).toEqual([
        { anchor: 4, head: 5, start: 4, end: 5 },
        { anchor: 19, head: 20, start: 19, end: 20 },
      ])
    })

    it('pulls the column rectangle back with the left and up chords', () => {
      const session = createDocumentSession('alpha bravo\nkilo lima\nmike november')
      editor.attachSession(session)
      mockEditorViewport(editorRoot(), 200, 200, 200)

      pressMouse({ clientX: 32, clientY: 10 })
      releaseMouse({ clientX: 32, clientY: 10 })
      dispatchDefaultKey('cursorColumnSelectDown')
      dispatchDefaultKey('cursorColumnSelectDown')
      dispatchDefaultKey('cursorColumnSelectRight')

      expect(resolvedSelectionRanges(session)).toEqual([
        { anchor: 4, head: 5, start: 4, end: 5 },
        { anchor: 16, head: 17, start: 16, end: 17 },
        { anchor: 26, head: 27, start: 26, end: 27 },
      ])

      expect(dispatchDefaultKey('cursorColumnSelectLeft').defaultPrevented).toBe(true)
      expect(dispatchDefaultKey('cursorColumnSelectUp').defaultPrevented).toBe(true)
      expect(resolvedSelectionRanges(session)).toEqual([
        { anchor: 4, head: 4, start: 4, end: 4 },
        { anchor: 16, head: 16, start: 16, end: 16 },
      ])
    })

    it('moves the column rectangle a page at a time', () => {
      const text = Array.from({ length: 20 }, (_value, row) => `line ${row % 10}0`).join('\n')
      const lastRow = 19
      const caret = lastRow * 8 + 4
      const probe = createDocumentSession(text)
      probe.setSelection(0)
      mockEditorViewport(editorRoot(), 200, 200, 2_000)
      editor.attachSession(probe)

      // Whatever this viewport makes a page worth, taken off a plain page move so the rectangle can
      // be held to the same distance in both directions.
      dispatchEditorKey('PageDown')
      const pageRows = editor.getState().cursor.row

      const session = createDocumentSession(text)
      session.setSelection(caret)
      editor.attachSession(session)

      expect(dispatchDefaultKey('cursorColumnSelectPageUp').defaultPrevented).toBe(true)
      expect(resolvedSelectionRanges(session).map((range) => range.anchor)).toEqual(
        Array.from(
          { length: pageRows + 1 },
          (_value, index) => (lastRow - pageRows + index) * 8 + 4,
        ),
      )

      expect(dispatchDefaultKey('cursorColumnSelectPageDown').defaultPrevented).toBe(true)
      expect(resolvedSelectionRanges(session)).toEqual([
        { anchor: caret, head: caret, start: caret, end: caret },
      ])
    })

    it('stops the column rectangle at the widest line it covers', () => {
      const session = createDocumentSession('alpha bravo\nxy')
      editor.attachSession(session)
      mockEditorViewport(editorRoot(), 200, 200, 200)

      pressMouse({ clientX: 32, clientY: 10 })
      releaseMouse({ clientX: 32, clientY: 10 })
      dispatchDefaultKey('cursorColumnSelectRight')
      dispatchDefaultKey('cursorColumnSelectDown')
      for (let press = 0; press < 12; press += 1) dispatchDefaultKey('cursorColumnSelectRight')

      expect(resolvedSelectionRanges(session)).toEqual([{ anchor: 4, head: 11, start: 4, end: 11 }])

      // The columns the chord could not reach are not owed back on the way out.
      dispatchDefaultKey('cursorColumnSelectLeft')

      expect(resolvedSelectionRanges(session)).toEqual([{ anchor: 4, head: 10, start: 4, end: 10 }])
    })

    it('grows a new column rectangle from a caret that has moved on', () => {
      const session = createDocumentSession('alpha bravo\nkilo lima\nmike november')
      editor.attachSession(session)
      mockEditorViewport(editorRoot(), 200, 200, 200)

      pressMouse({ clientX: 32, clientY: 10 })
      releaseMouse({ clientX: 32, clientY: 10 })
      dispatchDefaultKey('cursorColumnSelectDown')
      dispatchDefaultKey('cursorDocumentEnd')

      expect(resolvedSelectionRanges(session)).toEqual([
        { anchor: 35, head: 35, start: 35, end: 35 },
      ])

      dispatchDefaultKey('cursorColumnSelectUp')

      expect(resolvedSelectionRanges(session)).toEqual([
        { anchor: 21, head: 21, start: 21, end: 21 },
        { anchor: 35, head: 35, start: 35, end: 35 },
      ])
    })

    it('anchors a fresh column rectangle where an alt-shift press lands', () => {
      const session = createDocumentSession('alpha bravo\nkilo lima\nmike november')
      editor.attachSession(session)
      mockEditorViewport(editorRoot(), 200, 200, 200)

      pressMouse({ clientX: 32, clientY: 10 })
      releaseMouse({ clientX: 32, clientY: 10 })
      dispatchDefaultKey('cursorColumnSelectDown')
      dispatchDefaultKey('cursorColumnSelectDown')

      pressMouse({ altKey: true, clientX: 64, clientY: 58, shiftKey: true })
      releaseMouse({ clientX: 64, clientY: 58 })

      const ranges = resolvedSelectionRanges(session)

      // One row, the one the caret was left on: the three-row box the chords had grown is gone
      // rather than being stretched out to the pointer.
      expect(ranges).toHaveLength(1)
      expect(ranges[0]?.anchor).toBe(26)
      expect(ranges[0]?.head).toBeGreaterThan(26)
    })

    it('scrolls the corner the column rectangle is being pushed into view', () => {
      const text = '0\n1\n2\n3\n4\n5'
      const rows = 5
      const probe = createDocumentSession(text)
      probe.setSelection(0)
      mockEditorViewport(editorRoot(), 80, 40)
      editor.attachSession(probe)

      // Where this viewport has to sit for the last row to be on screen, taken from a plain caret
      // walk down to it: the anchored corner is on screen the whole way, so a reveal aimed there
      // leaves the view somewhere short of this and never says so.
      for (let press = 0; press < rows; press += 1) dispatchDefaultKey('cursorDown')
      const scrollTopShowingLastRow = editorRoot().scrollTop
      expect(scrollTopShowingLastRow).toBeGreaterThan(0)

      const session = createDocumentSession(text)
      session.setSelection(0)
      editor.attachSession(session)

      for (let press = 0; press < rows; press += 1) dispatchDefaultKey('cursorColumnSelectDown')

      expect(resolvedSelectionRanges(session)).toHaveLength(rows + 1)
      expect(editorRoot().scrollTop).toBe(scrollTopShowingLastRow)
    })

    it('reads the rows of a tall column rectangle once per chord', () => {
      const rows = 200
      const session = createDocumentSession(
        Array.from({ length: rows }, () => 'alpha bravo').join('\n'),
      )
      session.setSelection(4)
      mockEditorViewport(editorRoot(), 200, 200, 5_000)
      editor.attachSession(session)

      for (let press = 1; press < rows; press += 1) dispatchDefaultKey('cursorColumnSelectDown')
      expect(resolvedSelectionRanges(session)).toHaveLength(rows)

      let reads = 0
      const getTextSnapshot = vi
        .spyOn(session, 'getTextSnapshot')
        .mockReturnValue(countingTextSnapshot(session.getTextSnapshot(), () => (reads += 1)))
      try {
        dispatchDefaultKey('cursorColumnSelectRight')
      } finally {
        getTextSnapshot.mockRestore()
      }

      // How far right the rectangle may go is read off the same walk that places the cursors: a
      // second walk to work it out again would double every keypress on a tall box.
      expect(reads).toBeLessThanOrEqual(rows)
      expect(resolvedSelectionRanges(session)[0]).toEqual({
        anchor: 4,
        head: 5,
        start: 4,
        end: 5,
      })
    })

    it('drops the column rectangle when the text under it changes', () => {
      const session = createDocumentSession('alpha bravo\nkilo lima\nmike november')
      editor.attachSession(session)
      mockEditorViewport(editorRoot(), 200, 200, 200)

      pressMouse({ clientX: 32, clientY: 10 })
      releaseMouse({ clientX: 32, clientY: 10 })
      expect(editor.dispatchCommand('cursorColumnSelectDown')).toBe(true)

      editorRoot().dispatchEvent(
        new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          data: 'X',
          inputType: 'insertText',
        }),
      )

      expect(session.materializeFullText()).toBe('alphXa bravo\nkiloX lima\nmike november')
      expect(editor.dispatchCommand('cursorColumnSelectDown')).toBe(true)
      expect(resolvedSelectionRanges(session)).toEqual([
        { anchor: 18, head: 18, start: 18, end: 18 },
        { anchor: 29, head: 29, start: 29, end: 29 },
      ])
    })
  })

  describe('openDocument', () => {
    it('sets anonymous text buffers without document identity', () => {
      editor.setText('abc', { languageId: 'typescript' })

      expect(editor.materializeFullText()).toBe('abc')
      expect(editorRoot().textContent).toBe('abc')
      expect(editor.getState()).toMatchObject({
        documentId: null,
        languageId: 'typescript',
        length: 3,
        canUndo: false,
        canRedo: false,
      })
    })

    it('syncs static document text through an editor change', () => {
      const changes: DocumentSessionChange[] = []
      editor.dispose()
      editor = createVisibleEditor(container, {
        onChange: (_state, change) => {
          if (change) changes.push(change)
        },
      })
      editor.openDocument({
        documentId: 'generated:/note.txt',
        documentMode: 'static',
        text: 'abc',
      })

      editor.syncText('abcdef', { documentMode: 'static' })

      expect(editor.materializeFullText()).toBe('abcdef')
      expect(editorRoot().textContent).toBe('abcdef')
      expect(changes.at(-1)).toMatchObject({
        kind: 'edit',
      })
      expect(changes.at(-1)?.textSnapshot.materializeFullText()).toBe('abcdef')
      expect(editor.getState()).toMatchObject({
        canUndo: false,
        documentMode: 'static',
        length: 6,
      })
    })

    it('opens editable documents and exposes editor state', () => {
      editor.openDocument({ documentId: 'note.txt', text: 'abc' })

      expect(editor.materializeFullText()).toBe('abc')
      expect(editorRoot().textContent).toBe('abc')
      expect(editor.getState()).toMatchObject({
        documentId: 'note.txt',
        languageId: null,
        syntaxStatus: 'plain',
        length: 3,
        canUndo: false,
        canRedo: false,
      })
    })

    it('routes text input through the owned document session', () => {
      const states: EditorState[] = []
      editor.dispose()
      editor = createVisibleEditor(container, {
        onChange: (state) => states.push(state),
      })
      editor.openDocument({ documentId: 'note.txt', text: 'abc' })

      editorRoot().dispatchEvent(
        new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          data: '!',
          inputType: 'insertText',
        }),
      )

      expect(editor.materializeFullText()).toBe('abc!')
      expect(editor.getState().canUndo).toBe(true)
      expect(states.at(-1)?.length).toBe(4)
    })

    it('routes undo through the owned document session', () => {
      editor.openDocument({ documentId: 'note.txt', text: 'abc' })
      editorRoot().dispatchEvent(
        new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          data: '!',
          inputType: 'insertText',
        }),
      )

      editorRoot().dispatchEvent(
        new KeyboardEvent('keydown', {
          bubbles: true,
          cancelable: true,
          key: 'z',
          ...primaryModifier(),
        }),
      )

      expect(editor.materializeFullText()).toBe('abc')
      expect(editor.getState()).toMatchObject({
        canUndo: false,
        canRedo: true,
      })
    })

    it('clears owned documents', () => {
      editor.openDocument({ documentId: 'note.txt', text: 'abc' })
      editor.setTokens([{ start: 0, end: 3, style: { color: '#ff0000' } }])

      editor.clearDocument()

      expect(editor.materializeFullText()).toBe('')
      expect(editor.getState()).toMatchObject({
        documentId: null,
        languageId: null,
        syntaxStatus: 'plain',
        length: 0,
      })
      expect(highlightsMap.size).toBe(0)
    })

    it('applies focused programmatic edits', () => {
      editor.setText('abcdef')

      editor.edit({ from: 1, to: 4, text: 'X' })

      expect(editor.materializeFullText()).toBe('aXef')
      expect(editor.getState()).toMatchObject({
        canUndo: true,
        cursor: { row: 0, column: 4 },
      })
    })

    it('creates an anonymous buffer before editing when needed', () => {
      editor.edit({ from: 0, to: 0, text: 'hi' })

      expect(editor.materializeFullText()).toBe('hi')
      expect(editor.getState()).toMatchObject({
        documentId: null,
        length: 2,
        canUndo: true,
      })
    })

    it('applies batch edits as one editor change and one undo step', () => {
      const changes: DocumentSessionChange[] = []
      editor.dispose()
      editor = createVisibleEditor(container, {
        onChange: (_state, change) => {
          if (change) changes.push(change)
        },
      })
      editor.setText('abcd')

      editor.edit([
        { from: 3, to: 3, text: 'Y' },
        { from: 1, to: 2, text: 'X' },
      ])

      expect(editor.materializeFullText()).toBe('aXcYd')
      expect(changes).toHaveLength(1)
      expect(changes[0]?.edits).toEqual([
        { from: 1, to: 2, text: 'X' },
        { from: 3, to: 3, text: 'Y' },
      ])

      editor.dispatchCommand('undo')
      expect(editor.materializeFullText()).toBe('abcd')
    })

    it('skips undo history for configured programmatic edits', () => {
      editor.setText('abc')

      editor.edit({ from: 3, to: 3, text: '!' }, { history: 'skip' })

      expect(editor.materializeFullText()).toBe('abc!')
      expect(editor.getState().canUndo).toBe(false)
    })

    it('does not clear existing redo history for skipped programmatic edits', () => {
      editor.setText('abc')
      editor.edit({ from: 3, to: 3, text: '!' })
      editor.dispatchCommand('undo')

      expect(editor.getState().canRedo).toBe(true)
      editor.edit({ from: 3, to: 3, text: '?' }, { history: 'skip' })

      expect(editor.materializeFullText()).toBe('abc?')
      expect(editor.getState().canRedo).toBe(true)
    })

    it('rejects invalid and overlapping programmatic edits without changing text', () => {
      editor.setText('abcd')

      expect(() => {
        editor.edit([
          { from: 1, to: 3, text: 'X' },
          { from: 2, to: 4, text: 'Y' },
        ])
      }).toThrow(RangeError)
      expect(() => {
        editor.edit({ from: 10, to: 10, text: '!' })
      }).toThrow(RangeError)
      expect(editor.materializeFullText()).toBe('abcd')
    })

    it('supports explicit post-edit selections', () => {
      editor.setText('abcdef')

      editor.edit({ from: 0, to: 3, text: 'let' }, { selection: { anchor: 1, head: 3 } })

      expect(editor.getState().cursor).toEqual({ row: 0, column: 3 })
      expect(window.getSelection()?.toString()).toBe('et')
    })

    it('uses explicit language ids for syntax highlights', async () => {
      const created: EditorSyntaxSessionOptions[] = []
      setEditorSyntaxSessionFactory((options) => {
        created.push(options)
        return createMockSyntaxSession()
      })

      editor.openDocument({
        documentId: 'main.ts',
        languageId: 'typescript',
        text: 'const a = 1;',
      })
      await flushMicrotasks()

      expect(created).toEqual([
        expect.objectContaining({
          documentId: 'main.ts',
          includeHighlights: true,
          languageId: 'typescript',
          syntaxMode: 'range',
        }),
      ])
      expect(readAll(created[0]!.textSnapshot)).toBe('const a = 1;')
      expect(editor.getState().syntaxStatus).toBe('ready')
      expect(highlightsMap.size).toBe(1)
    })

    it('queries visible syntax ranges after compact structural refresh', async () => {
      const ranges: EditorSyntaxRange[] = []
      setEditorSyntaxSessionFactory(() =>
        createMockSyntaxSession({
          refresh: async () => createSyntaxResult([]),
          queryRange: async (range) => {
            ranges.push(range)
            return createSyntaxResult([
              {
                start: range.startIndex,
                end: range.startIndex + 5,
                style: { color: '#00ff00' },
              },
            ])
          },
        }),
      )

      editor.openDocument({
        documentId: 'main.ts',
        languageId: 'typescript',
        text: 'const a = 1;',
      })
      await flushSyntaxDebounce()

      expect(ranges.length).toBeGreaterThan(0)
      expect(ranges[0]?.startIndex).toBe(0)
      expect(ranges[0]?.endIndex).toBeGreaterThan(0)
      expect(editor.getState().syntaxStatus).toBe('ready')
    })

    it('requests visible syntax on scroll without reparsing the document', async () => {
      const ranges: EditorSyntaxRange[] = []
      let refreshCount = 0
      setEditorSyntaxSessionFactory(() =>
        createMockSyntaxSession({
          refresh: async () => {
            refreshCount += 1
            return createSyntaxResult([])
          },
          queryRange: async (range) => {
            ranges.push(range)
            return createSyntaxResult([])
          },
        }),
      )
      const text = Array.from(
        { length: 20_000 },
        (_value, index) => `const line${index} = ${index};`,
      ).join('\n')

      editor.openDocument({
        documentId: 'main.ts',
        languageId: 'typescript',
        text,
      })
      await flushSyntaxDebounce()
      const initialRangeCount = ranges.length

      editor.setScrollPosition({ top: 300_000, left: 0 })
      await flushSyntaxDebounce()
      const scrolledRanges = ranges.slice(initialRangeCount)

      expect(refreshCount).toBe(1)
      expect(scrolledRanges.length).toBeGreaterThan(0)
      expect(scrolledRanges.some((range) => range.startIndex > 0)).toBe(true)
    })

    it('does not query stale visible syntax ranges before edit parsing catches up', async () => {
      const ranges: EditorSyntaxRange[] = []
      const applyChangeResult = createDeferred<EditorSyntaxResult>()
      let applyChangeStarted = false
      setEditorSyntaxSessionFactory(() =>
        createMockSyntaxSession({
          refresh: async () => createSyntaxResult([]),
          applyChange: () => {
            applyChangeStarted = true
            return applyChangeResult.promise
          },
          queryRange: async (range) => {
            ranges.push(range)
            return createSyntaxResult([
              {
                start: range.startIndex + 10,
                end: range.startIndex + 15,
                style: { color: '#00ff00' },
              },
            ])
          },
        }),
      )
      const text = Array.from(
        { length: 20_000 },
        (_value, index) => `const line${index} = ${index};`,
      ).join('\n')

      editor.openDocument({
        documentId: 'main.ts',
        languageId: 'typescript',
        text,
      })
      await flushSyntaxDebounce()
      const rangeCountAfterOpen = ranges.length

      editor.edit({ from: 0, to: 0, text: '\n' })
      editor.setScrollPosition({ top: 300_000, left: 0 })
      await flushTimers()
      await flushMicrotasks()

      expect(ranges).toHaveLength(rangeCountAfterOpen)

      await flushSyntaxDebounce()
      expect(applyChangeStarted).toBe(true)
      expect(ranges).toHaveLength(rangeCountAfterOpen)

      applyChangeResult.resolve(createSyntaxResult([]))
      await flushMicrotasks()

      expect(ranges).toHaveLength(rangeCountAfterOpen + 1)
      expect(ranges.at(-1)?.startIndex).toBeGreaterThan(0)
    })

    it('prefetches syntax ahead of fast scroll direction', async () => {
      const ranges: EditorSyntaxRange[] = []
      setEditorSyntaxSessionFactory(() =>
        createMockSyntaxSession({
          refresh: async () => createSyntaxResult([]),
          queryRange: async (range) => {
            ranges.push(range)
            return createSyntaxResult([])
          },
        }),
      )
      const text = Array.from(
        { length: 60_000 },
        (_value, index) => `const line${index} = ${index};`,
      ).join('\n')

      editor.openDocument({
        documentId: 'main.ts',
        languageId: 'typescript',
        text,
      })
      await flushSyntaxDebounce()
      const rangeCountBeforeScroll = ranges.length

      editor.setScrollPosition({ top: 900_000, left: 0 })
      await flushSyntaxDebounce()

      expect(hasLongSyntaxRange(ranges.slice(rangeCountBeforeScroll))).toBe(true)
    })

    it('queries the teleported viewport before the larger syntax prefetch range', async () => {
      const ranges: EditorSyntaxRange[] = []
      setEditorSyntaxSessionFactory(() =>
        createMockSyntaxSession({
          refresh: async () => createSyntaxResult([]),
          queryRange: async (range) => {
            ranges.push(range)
            return createSyntaxResult([])
          },
        }),
      )
      const text = Array.from(
        { length: 60_000 },
        (_value, index) => `const line${index} = ${index};`,
      ).join('\n')

      editor.openDocument({
        documentId: 'main.ts',
        languageId: 'typescript',
        text,
      })
      await flushSyntaxDebounce()
      const rangeCountBeforeTeleport = ranges.length

      editor.setScrollPosition({ top: 900_000, left: 0 })
      const urgentRange = ranges[rangeCountBeforeTeleport]
      await flushSyntaxDebounce()
      const postTeleportRanges = ranges.slice(rangeCountBeforeTeleport)

      expect(rangeLength(urgentRange)).toBeLessThan(120_000)
      expect(hasLongSyntaxRange(postTeleportRanges)).toBe(true)
    })

    it('queries the teleported viewport synchronously from contribution scroll updates', async () => {
      const ranges: EditorSyntaxRange[] = []
      let contributionContext: EditorViewContributionContext | null = null
      const plugin: EditorPlugin = {
        activate: (context) =>
          context.registerViewContribution({
            createContribution: (context) => {
              contributionContext = context
              return {
                update: () => undefined,
                dispose: () => undefined,
              }
            },
          }),
      }
      setEditorSyntaxSessionFactory(() =>
        createMockSyntaxSession({
          refresh: async () => createSyntaxResult([]),
          queryRange: async (range) => {
            ranges.push(range)
            return createSyntaxResult([])
          },
        }),
      )
      editor.dispose()
      editor = createVisibleEditor(container, {
        plugins: withTestLanguagePlugins(plugin),
      })
      const text = Array.from(
        { length: 60_000 },
        (_value, index) => `const line${index} = ${index};`,
      ).join('\n')

      editor.openDocument({
        documentId: 'main.ts',
        languageId: 'typescript',
        text,
      })
      await flushSyntaxDebounce()
      const rangeCountBeforeTeleport = ranges.length

      requireViewContributionContext(contributionContext).setScrollPosition({ top: 900_000 })
      const urgentRange = ranges[rangeCountBeforeTeleport]
      await flushSyntaxDebounce()
      const postTeleportRanges = ranges.slice(rangeCountBeforeTeleport)

      expect(editor.getScrollPosition().top).toBe(900_000)
      expect(rangeLength(urgentRange)).toBeLessThan(120_000)
      expect(hasLongSyntaxRange(postTeleportRanges)).toBe(true)
    })

    it('does not cache visible syntax ranges while range queries are not ready', async () => {
      const ranges: EditorSyntaxRange[] = []
      let canQueryRange = false
      setEditorSyntaxSessionFactory(() =>
        createMockSyntaxSession({
          canQueryRange: () => canQueryRange,
          refresh: async () => createSyntaxResult([]),
          queryRange: async (range) => {
            ranges.push(range)
            return createSyntaxResult([
              {
                start: range.startIndex + 10,
                end: range.startIndex + 15,
                style: { color: '#00ff00' },
              },
            ])
          },
        }),
      )
      const text = Array.from(
        { length: 60_000 },
        (_value, index) => `const line${index} = ${index};`,
      ).join('\n')

      editor.openDocument({
        documentId: 'main.ts',
        languageId: 'typescript',
        text,
      })
      await flushSyntaxDebounce()

      editor.setScrollPosition({ top: 300_000, left: 0 })
      await flushSyntaxDebounce()
      expect(ranges).toHaveLength(0)

      canQueryRange = true
      editor.setScrollPosition({ top: 250_000, left: 0 })

      expect(ranges).toHaveLength(1)
      expect(ranges[0]?.startIndex).toBeGreaterThan(0)
    })

    it('keeps syntax prefetch behind the visible range query', async () => {
      const ranges: EditorSyntaxRange[] = []
      const pendingRanges: Deferred<EditorSyntaxResult>[] = []
      let deferRangeQueries = false
      setEditorSyntaxSessionFactory(() =>
        createMockSyntaxSession({
          refresh: async () => createSyntaxResult([]),
          queryRange: (range) => {
            ranges.push(range)
            if (!deferRangeQueries) return Promise.resolve(createSyntaxResult([]))

            const pending = createDeferred<EditorSyntaxResult>()
            pendingRanges.push(pending)
            return pending.promise
          },
        }),
      )
      const text = Array.from(
        { length: 60_000 },
        (_value, index) => `const line${index} = ${index};`,
      ).join('\n')

      editor.openDocument({
        documentId: 'main.ts',
        languageId: 'typescript',
        text,
      })
      await flushSyntaxDebounce()
      const rangeCountBeforeTeleport = ranges.length
      deferRangeQueries = true

      editor.setScrollPosition({ top: 900_000, left: 0 })
      await new Promise((resolve) => setTimeout(resolve, 40))
      await flushMicrotasks()

      expect(ranges).toHaveLength(rangeCountBeforeTeleport + 1)
      expect(rangeLength(ranges[rangeCountBeforeTeleport])).toBeLessThan(120_000)

      pendingRanges[0]?.resolve(createSyntaxResult([]))
      await flushMicrotasks()
      await new Promise((resolve) => setTimeout(resolve, 40))
      await flushMicrotasks()

      expect(ranges.length).toBeGreaterThan(rangeCountBeforeTeleport + 1)
      expect(rangeLength(ranges.at(-1))).toBeGreaterThan(200_000)
    })

    it('warms non-visible syntax tiles in the background', async () => {
      const ranges: EditorSyntaxRange[] = []
      setEditorSyntaxSessionFactory(() =>
        createMockSyntaxSession({
          refresh: async () => createSyntaxResult([]),
          queryRange: async (range) => {
            ranges.push(range)
            return createSyntaxResult([])
          },
        }),
      )
      const text = Array.from(
        { length: 60_000 },
        (_value, index) => `const line${index} = ${index};`,
      ).join('\n')

      editor.openDocument({
        documentId: 'main.ts',
        languageId: 'typescript',
        text,
      })
      await flushSyntaxDebounce()
      await flushSyntaxDebounce()

      const warmedTile = ranges.find(
        (range) => range.startIndex >= 120_000 && rangeLength(range) <= 120_000,
      )
      expect(warmedTile).toBeDefined()
      expect(ranges).not.toContainEqual({ startIndex: 0, endIndex: 120_000 })
    })

    it('keeps fold paint pending when the viewport moves before its first structural result', async () => {
      const events: ViewContributionEvent[] = []
      const pending: {
        range: EditorSyntaxRange
        result: Deferred<EditorSyntaxResult>
      }[] = []
      editor.dispose()
      editor = createVisibleEditor(container, {
        plugins: [createViewContributionPlugin(events)],
      })
      setEditorSyntaxSessionFactory(() =>
        createMockSyntaxSession({
          refresh: async () => createSyntaxResult([]),
          queryRange: (range) => {
            const result = createDeferred<EditorSyntaxResult>()
            pending.push({ range, result })
            return result.promise
          },
        }),
      )
      const text = Array.from(
        { length: 60_000 },
        (_, index) => `const line${index} = ${index};`,
      ).join('\n')
      editor.openDocument({
        documentId: 'main.ts',
        languageId: 'typescript',
        text,
      })
      await vi.waitFor(() => expect(pending).toHaveLength(1))
      editor.setScrollPosition({ top: 900_000, left: 0 })
      const firstRange = pending[0]!
      events.length = 0
      firstRange.result.resolve(createSyntaxResult([]))
      await vi.waitFor(() => expect(pending.length).toBeGreaterThan(1))
      expect(events.at(-1)?.snapshot?.syntaxStatus).toBe('loading')
      expect(events.at(-1)?.snapshot?.paintLayers).toBeNull()
      expect(
        events.some((event) =>
          event.snapshot?.foldMarkers.some((marker) => marker.key.includes(':indent:')),
        ),
      ).toBe(false)
      const currentRange = pending.find((entry) => entry.range.startIndex > 800_000)!
      expect(currentRange).toBeDefined()
      currentRange.result.resolve(createSyntaxResult([]))
      await vi.waitFor(() => expect(events.at(-1)?.snapshot?.syntaxStatus).toBe('ready'))
      expect(events.at(-1)?.snapshot?.paintLayers).toEqual([])
    })

    it('keeps visible syntax folds when offscreen range warming finishes', async () => {
      const events: ViewContributionEvent[] = []
      const ranges: EditorSyntaxRange[] = []
      const prefix = 'if (x) {\n  y();\n}\n'
      const text =
        prefix +
        Array.from({ length: 60_000 }, (_value, index) => `const line${index} = ${index};`).join(
          '\n',
        )
      const fold = {
        startIndex: 0,
        endIndex: prefix.length - 1,
        startLine: 0,
        endLine: 2,
        type: 'statement_block',
        languageId: 'typescript',
      }
      editor.dispose()
      editor = createVisibleEditor(container, {
        plugins: withTestLanguagePlugins(createViewContributionPlugin(events)),
      })
      setEditorSyntaxSessionFactory(() =>
        createMockSyntaxSession({
          refresh: async () => createSyntaxResult([], []),
          queryRange: async (range) => {
            ranges.push(range)
            const folds =
              range.startIndex <= fold.startIndex && range.endIndex >= fold.endIndex ? [fold] : []
            return createSyntaxResult([], folds)
          },
        }),
      )

      editor.openDocument({
        documentId: 'main.ts',
        languageId: 'typescript',
        text,
      })
      await flushSyntaxDebounce()

      expect(latestFoldMarkers(events)).toHaveLength(1)

      await flushSyntaxDebounce()

      expect(
        ranges.some((range) => range.startIndex >= 120_000 && rangeLength(range) <= 120_000),
      ).toBe(true)
      expect(latestFoldMarkers(events)).toHaveLength(1)
    })

    it('keeps previously queried syntax tokens while scrolling to a new range', async () => {
      const events: ViewContributionEvent[] = []
      const ranges: EditorSyntaxRange[] = []
      editor.dispose()
      editor = createVisibleEditor(container, {
        plugins: withTestLanguagePlugins(createViewContributionPlugin(events)),
      })
      setEditorSyntaxSessionFactory(() =>
        createMockSyntaxSession({
          refresh: async () => createSyntaxResult([]),
          queryRange: async (range) => {
            ranges.push(range)
            return createSyntaxResult([
              {
                start: range.startIndex + 10,
                end: range.startIndex + 15,
                style: { color: '#00ff00' },
              },
            ])
          },
        }),
      )
      const text = Array.from(
        { length: 20_000 },
        (_value, index) => `const line${index} = ${index};`,
      ).join('\n')

      editor.openDocument({
        documentId: 'main.ts',
        languageId: 'typescript',
        text,
      })
      await flushSyntaxDebounce()
      const rangeCountAfterOpen = ranges.length
      const initialToken = tokenSnapshotFromLastEvent(events)[0]
      expect(initialToken).toMatchObject({ start: 10, end: 15 })

      editor.setScrollPosition({ top: 300_000, left: 0 })
      await flushSyntaxDebounce()
      const tokens = tokenSnapshotFromLastEvent(events)
      const scrolledRanges = ranges.slice(rangeCountAfterOpen)
      const scrolledToken = tokens.find((token) =>
        scrolledRanges.some(
          (range) => range.startIndex > 0 && token.start === range.startIndex + 10,
        ),
      )

      expect(tokens).toContainEqual(initialToken)
      expect(scrolledToken).toBeDefined()
    })

    it('repaints cached syntax immediately when scrolling back to a previous range', async () => {
      const events: ViewContributionEvent[] = []
      const ranges: EditorSyntaxRange[] = []
      editor.dispose()
      editor = createVisibleEditor(container, {
        plugins: withTestLanguagePlugins(createViewContributionPlugin(events)),
      })
      setEditorSyntaxSessionFactory(() =>
        createMockSyntaxSession({
          refresh: async () => createSyntaxResult([]),
          queryRange: async (range) => {
            ranges.push(range)
            return createSyntaxResult([
              {
                start: range.startIndex + 10,
                end: range.startIndex + 15,
                style: { color: '#00ff00' },
              },
            ])
          },
        }),
      )
      const text = Array.from(
        { length: 20_000 },
        (_value, index) => `const line${index} = ${index};`,
      ).join('\n')

      editor.openDocument({
        documentId: 'main.ts',
        languageId: 'typescript',
        text,
      })
      await flushSyntaxDebounce()
      const initialToken = tokenSnapshotFromLastEvent(events)[0]

      editor.setScrollPosition({ top: 300_000, left: 0 })
      const rangeCountAfterScrollAway = await flushSyntaxUntilSettled(() => ranges.length)

      editor.setScrollPosition({ top: 0, left: 0 })
      await flushSyntaxDebounce()
      const tokens = tokenSnapshotFromLastEvent(events)

      expect(rangeCountAfterScrollAway).toBeGreaterThan(1)
      expect(ranges).toHaveLength(rangeCountAfterScrollAway)
      expect(tokens).toContainEqual(initialToken)
    })

    it('does not reuse cached visible syntax after newline edits', async () => {
      const ranges: EditorSyntaxRange[] = []
      setEditorSyntaxSessionFactory(() =>
        createMockSyntaxSession({
          refresh: async () => createSyntaxResult([]),
          queryRange: async (range) => {
            ranges.push(range)
            return createSyntaxResult([
              {
                start: range.startIndex + 10,
                end: range.startIndex + 15,
                style: { color: '#00ff00' },
              },
            ])
          },
        }),
      )
      const text = Array.from(
        { length: 20_000 },
        (_value, index) => `const line${index} = ${index};`,
      ).join('\n')

      editor.openDocument({
        documentId: 'main.ts',
        languageId: 'typescript',
        text,
      })
      await flushSyntaxDebounce()
      editor.setScrollPosition({ top: 300_000, left: 0 })
      await flushSyntaxDebounce()

      editor.setSelection(5, 5, { reveal: false })
      editorRoot().dispatchEvent(createLineBreakEvent())
      expect(editor.materializeFullText().startsWith('const\n line0')).toBe(true)
      const rangeCountBeforeScrollBack = ranges.length
      editor.setScrollPosition({ top: 0, left: 0 })
      await flushTimers()
      await flushMicrotasks()

      if (ranges.length > rangeCountBeforeScrollBack) {
        expect(ranges.at(-1)?.startIndex).toBe(0)
      }

      await flushSyntaxDebounce()

      expect(ranges.length).toBeGreaterThan(rangeCountBeforeScrollBack)
      expect(ranges.slice(rangeCountBeforeScrollBack).some((range) => range.startIndex === 0)).toBe(
        true,
      )
    })

    it('applies syncText changes through incremental syntax sessions', async () => {
      const appliedChanges: DocumentSessionChange[] = []
      setEditorSyntaxSessionFactory(() =>
        createMockSyntaxSession({
          applyChange: async (change) => {
            appliedChanges.push(change)
            return createSyntaxResult()
          },
        }),
      )

      editor.openDocument({
        documentId: 'generated:/main.ts',
        documentMode: 'static',
        languageId: 'typescript',
        text: 'const a = 1;',
      })
      await flushMicrotasks()

      editor.syncText('const ab = 1;', {
        documentMode: 'static',
        languageId: 'typescript',
      })
      await flushSyntaxDebounce()

      expect(appliedChanges).toHaveLength(1)
      expect(appliedChanges[0]).toMatchObject({
        edits: [{ from: 7, text: 'b', to: 7 }],
        kind: 'edit',
      })
      expect(appliedChanges[0]?.textSnapshot.materializeFullText()).toBe('const ab = 1;')
    })

    it('does not infer language from document ids', async () => {
      const created: EditorSyntaxSessionOptions[] = []
      setEditorSyntaxSessionFactory((options) => {
        created.push(options)
        return createMockSyntaxSession()
      })

      editor.openDocument({ documentId: 'main.ts', text: 'const a = 1;' })
      await flushMicrotasks()

      expect(created).toEqual([])
      expect(editor.getState()).toMatchObject({
        languageId: null,
        syntaxStatus: 'plain',
      })
      expect(highlightsMap.size).toBe(0)
    })

    it('uses plugin highlights instead of Tree-sitter tokens', async () => {
      const created: EditorSyntaxSessionOptions[] = []
      const highlighter = createMockHighlighterSession({
        refresh: async () =>
          createHighlightResult([{ start: 6, end: 7, style: { color: '#00ff00' } }]),
      })
      editor.dispose()
      editor = createVisibleEditor(container, {
        plugins: withTestGutterPlugins(createHighlighterPlugin(highlighter)),
      })
      setEditorSyntaxSessionFactory((options) => {
        created.push(options)
        return createMockSyntaxSession({
          refresh: async () =>
            createSyntaxResult([{ start: 0, end: 5, style: { color: '#ff0000' } }]),
        })
      })

      editor.openDocument({
        documentId: 'main.ts',
        languageId: 'typescript',
        text: 'const a = 1;',
      })
      await flushMicrotasks()

      expect(created[0]).toEqual(expect.objectContaining({ includeHighlights: false }))
      expect(tokenHighlightRanges()).toHaveLength(1)
      expect(tokenHighlightRanges()[0]?.startOffset).toBe(6)
    })

    it('applies highlighter theme colors without dropping configured Tree-sitter syntax colors', async () => {
      const highlighter = createMockHighlighterSession({
        refresh: async () =>
          createHighlightResult([], {
            backgroundColor: '#ffffff',
            foregroundColor: '#24292e',
            gutterForegroundColor: '#6e7781',
          }),
      })
      editor.dispose()
      editor = createVisibleEditor(container, {
        plugins: withTestLanguagePlugins(createHighlighterPlugin(highlighter)),
        theme: { syntax: { keyword: '#cf222e' } },
      })
      setEditorSyntaxSessionFactory(() => createMockSyntaxSession())

      editor.openDocument({
        documentId: 'main.ts',
        languageId: 'typescript',
        text: 'const a = 1;',
      })
      await flushMicrotasks()

      const root = editorRoot()
      expect(root.style.getPropertyValue('--editor-background')).toBe('#ffffff')
      expect(root.style.getPropertyValue('--editor-foreground')).toBe('#24292e')
      expect(root.style.getPropertyValue('--editor-gutter-foreground')).toBe('#6e7781')
      expect(root.style.getPropertyValue('--editor-syntax-keyword')).toBe('#cf222e')
    })

    it('keeps configured theme colors above highlighter theme colors', async () => {
      const highlighter = createMockHighlighterSession({
        refresh: async () =>
          createHighlightResult([], {
            backgroundColor: '#ffffff',
            foregroundColor: '#24292e',
            syntax: { keyword: '#0969da' },
          }),
      })
      editor.dispose()
      editor = createVisibleEditor(container, {
        plugins: withTestLanguagePlugins(createHighlighterPlugin(highlighter)),
        theme: {
          backgroundColor: '#101010',
          foregroundColor: '#eeeeee',
          syntax: { keyword: '#cf222e' },
        },
      })
      setEditorSyntaxSessionFactory(() => createMockSyntaxSession())

      editor.openDocument({
        documentId: 'main.ts',
        languageId: 'typescript',
        text: 'const a = 1;',
      })
      await flushMicrotasks()

      const root = editorRoot()
      expect(root.style.getPropertyValue('--editor-background')).toBe('#101010')
      expect(root.style.getPropertyValue('--editor-foreground')).toBe('#eeeeee')
      expect(root.style.getPropertyValue('--editor-syntax-keyword')).toBe('#cf222e')
    })

    it('exposes the resolved highlighter theme to view contributions', async () => {
      const events: ViewContributionEvent[] = []
      const highlighter = createMockHighlighterSession({
        refresh: async () =>
          createHighlightResult([], {
            backgroundColor: '#ffffff',
            foregroundColor: '#24292e',
            syntax: { keyword: '#cf222e' },
          }),
      })
      editor.dispose()
      editor = createVisibleEditor(container, {
        plugins: withTestLanguagePlugins(
          createViewContributionPlugin(events),
          createHighlighterPlugin(highlighter),
        ),
      })

      editor.openDocument({
        documentId: 'main.ts',
        languageId: 'typescript',
        text: 'const a = 1;',
      })
      await flushMicrotasks()

      const tokenEvent = events.findLast((event) => event.kind === 'tokens')
      expect(tokenEvent?.snapshot?.theme).toMatchObject({
        backgroundColor: '#ffffff',
        foregroundColor: '#24292e',
        syntax: { keyword: '#cf222e' },
      })
    })

    it('applies highlighter provider theme colors before a document is opened', async () => {
      const highlighter = createMockHighlighterSession()
      editor.dispose()
      editor = createVisibleEditor(container, {
        plugins: withTestLanguagePlugins(
          createHighlighterPlugin(highlighter, {
            loadTheme: async () => ({
              backgroundColor: '#ffffff',
              foregroundColor: '#24292e',
            }),
          }),
        ),
      })
      await flushMicrotasks()

      const root = editorRoot()
      expect(root.style.getPropertyValue('--editor-background')).toBe('#ffffff')
      expect(root.style.getPropertyValue('--editor-foreground')).toBe('#24292e')
      expect(editor.getState()).toMatchObject({ length: 0, canUndo: false })
    })

    it('keeps highlighter provider theme colors after clearing a document', async () => {
      const highlighter = createMockHighlighterSession({
        refresh: async () =>
          createHighlightResult([], {
            backgroundColor: '#0d1117',
          }),
      })
      editor.dispose()
      editor = createVisibleEditor(container, {
        plugins: withTestLanguagePlugins(
          createHighlighterPlugin(highlighter, {
            loadTheme: async () => ({ backgroundColor: '#ffffff' }),
          }),
        ),
      })
      await flushMicrotasks()

      editor.openDocument({
        documentId: 'main.ts',
        languageId: 'typescript',
        text: 'const a = 1;',
      })
      await flushMicrotasks()
      expect(editorRoot().style.getPropertyValue('--editor-background')).toBe('#0d1117')

      editor.clearDocument()

      expect(editorRoot().style.getPropertyValue('--editor-background')).toBe('#ffffff')
    })

    it('keeps Tree-sitter folds when plugin highlights are active', async () => {
      const text = 'if (x) {\n  y();\n}\nz();'
      const foldEnd = text.indexOf('\nz();')
      const highlighter = createMockHighlighterSession({
        refresh: async () =>
          createHighlightResult([{ start: 3, end: 4, style: { color: '#00ff00' } }]),
      })
      editor.dispose()
      editor = createVisibleEditor(container, {
        plugins: withTestGutterPlugins(createHighlighterPlugin(highlighter)),
      })
      setEditorSyntaxSessionFactory(() =>
        createMockSyntaxSession({
          refresh: async () =>
            createSyntaxResult(
              [{ start: 0, end: 2, style: { color: '#ff0000' } }],
              [
                {
                  startIndex: 0,
                  endIndex: foldEnd,
                  startLine: 0,
                  endLine: 2,
                  type: 'statement_block',
                  languageId: 'typescript',
                },
              ],
            ),
        }),
      )

      editor.openDocument({
        documentId: 'main.ts',
        languageId: 'typescript',
        text,
      })
      await flushMicrotasks()

      expect(foldToggle().dataset.editorFoldState).toBe('expanded')
      expect(tokenHighlightRanges()[0]?.startOffset).toBe(3)
    })

    it('renders syntax fold controls and toggles collapsed rows', async () => {
      const text = 'if (x) {\n  y();\n}\nz();'
      const foldEnd = text.indexOf('\nz();')
      editor.dispose()
      editor = createVisibleEditor(container, {
        plugins: withTestGutterPlugins(),
      })
      setEditorSyntaxSessionFactory(() =>
        createMockSyntaxSession({
          refresh: async () =>
            createSyntaxResult(
              [],
              [
                {
                  startIndex: 0,
                  endIndex: foldEnd,
                  startLine: 0,
                  endLine: 2,
                  type: 'statement_block',
                  languageId: 'typescript',
                },
              ],
            ),
        }),
      )

      editor.openDocument({
        documentId: 'main.ts',
        languageId: 'typescript',
        text,
      })
      await flushMicrotasks()

      expect(foldToggle().dataset.editorFoldState).toBe('expanded')
      expect(editorRoot().textContent).toContain('  y();')

      foldToggle().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

      expect(foldToggle().dataset.editorFoldState).toBe('collapsed')
      expect(editorRoot().textContent).toContain('...')
      expect(editorRoot().textContent).not.toContain('  y();')

      foldToggle().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

      expect(foldToggle().dataset.editorFoldState).toBe('expanded')
      expect(editorRoot().textContent).toContain('  y();')
    })

    it('keeps nested syntax fold projections as markers', async () => {
      const text = 'if (x) {\n  if (y) {\n    z();\n  }\n}\na();'
      const outerEnd = text.indexOf('\na();')
      const innerStart = text.indexOf('if (y)')
      const innerEnd = text.indexOf('\n  }', innerStart)
      const events: ViewContributionEvent[] = []
      editor.dispose()
      editor = createVisibleEditor(container, {
        plugins: withTestGutterPlugins(createViewContributionPlugin(events)),
      })
      setEditorSyntaxSessionFactory(() =>
        createMockSyntaxSession({
          refresh: async () =>
            createSyntaxResult(
              [],
              [
                {
                  startIndex: innerStart,
                  endIndex: innerEnd,
                  startLine: 1,
                  endLine: 3,
                  type: 'inner_block',
                  languageId: 'typescript',
                },
                {
                  startIndex: 0,
                  endIndex: outerEnd,
                  startLine: 0,
                  endLine: 4,
                  type: 'outer_block',
                  languageId: 'typescript',
                },
              ],
            ),
        }),
      )

      editor.openDocument({
        documentId: 'main.ts',
        languageId: 'typescript',
        text,
      })
      await flushMicrotasks()

      expect(latestFoldMarkers(events)).toHaveLength(2)
      expect(latestFoldMarkers(events)[0]).toMatchObject({
        endOffset: outerEnd,
        endRow: 4,
        startOffset: 0,
        startRow: 0,
      })
      expect(latestFoldMarkers(events)[1]).toMatchObject({
        endOffset: innerEnd,
        endRow: 3,
        startOffset: innerStart,
        startRow: 1,
      })
    })

    it('folds, unfolds, and toggles syntax folds through the editor API', async () => {
      const text = 'if (x) {\n  y();\n}\nz();'
      const foldEnd = text.indexOf('\nz();')
      editor.dispose()
      editor = createVisibleEditor(container, {
        plugins: withTestGutterPlugins(),
      })
      setEditorSyntaxSessionFactory(() =>
        createMockSyntaxSession({
          refresh: async () =>
            createSyntaxResult(
              [],
              [
                {
                  startIndex: 0,
                  endIndex: foldEnd,
                  startLine: 0,
                  endLine: 2,
                  type: 'statement_block',
                  languageId: 'typescript',
                },
              ],
            ),
        }),
      )

      editor.openDocument({
        documentId: 'main.ts',
        languageId: 'typescript',
        text,
      })
      await flushMicrotasks()

      expect(editor.fold(0)).toBe(true)
      expect(foldToggle().dataset.editorFoldState).toBe('collapsed')
      expect(editorRoot().textContent).not.toContain('  y();')

      expect(editor.fold(0)).toBe(false)
      expect(editor.unfold(0)).toBe(true)
      expect(foldToggle().dataset.editorFoldState).toBe('expanded')
      expect(editorRoot().textContent).toContain('  y();')

      editor.setSelection(0)
      expect(editor.toggleFold()).toBe(true)
      expect(foldToggle().dataset.editorFoldState).toBe('collapsed')
      expect(editor.toggleFold()).toBe(true)
      expect(foldToggle().dataset.editorFoldState).toBe('expanded')
    })

    it('folds and unfolds all syntax folds through the editor API', async () => {
      const text = 'if (x) {\n  y();\n}\nwhile (z) {\n  q();\n}\n'
      const secondStart = text.indexOf('while')
      const events: ViewContributionEvent[] = []
      editor.dispose()
      editor = createVisibleEditor(container, {
        plugins: withTestGutterPlugins(createViewContributionPlugin(events)),
      })
      setEditorSyntaxSessionFactory(() =>
        createMockSyntaxSession({
          refresh: async () =>
            createSyntaxResult(
              [],
              [
                {
                  startIndex: 0,
                  endIndex: secondStart - 1,
                  startLine: 0,
                  endLine: 2,
                  type: 'statement_block',
                  languageId: 'typescript',
                },
                {
                  startIndex: secondStart,
                  endIndex: text.length,
                  startLine: 3,
                  endLine: 5,
                  type: 'statement_block',
                  languageId: 'typescript',
                },
              ],
            ),
        }),
      )

      editor.openDocument({
        documentId: 'main.ts',
        languageId: 'typescript',
        text,
      })
      await flushMicrotasks()

      expect(editor.foldAll()).toBe(true)
      expect(events.at(-1)?.snapshot?.foldMarkers.map((marker) => marker.collapsed)).toEqual([
        true,
        true,
      ])
      expect(editorRoot().textContent).not.toContain('  y();')
      expect(editor.foldAll()).toBe(false)

      expect(editor.unfoldAll()).toBe(true)
      expect(events.at(-1)?.snapshot?.foldMarkers.map((marker) => marker.collapsed)).toEqual([
        false,
        false,
      ])
      expect(editorRoot().textContent).toContain('  y();')
      expect(editorRoot().textContent).toContain('  q();')
      expect(editor.unfoldAll()).toBe(false)
    })

    it('hides fold controls on rows without fold candidates', async () => {
      const text = 'if (x) {\n  y();\n}\nz();'
      const foldEnd = text.indexOf('\nz();')
      editor.dispose()
      editor = createVisibleEditor(container, {
        plugins: withTestGutterPlugins(),
      })
      setEditorSyntaxSessionFactory(() =>
        createMockSyntaxSession({
          refresh: async () =>
            createSyntaxResult(
              [],
              [
                {
                  startIndex: 0,
                  endIndex: foldEnd,
                  startLine: 0,
                  endLine: 2,
                  type: 'statement_block',
                  languageId: 'typescript',
                },
              ],
            ),
        }),
      )

      editor.openDocument({
        documentId: 'main.ts',
        languageId: 'typescript',
        text,
      })
      await flushMicrotasks()

      const buttons = [
        ...document.querySelectorAll<HTMLButtonElement>('.editor-virtualized-fold-toggle'),
      ]
      const visible = buttons.filter((button) => !button.hidden)
      const hidden = buttons.filter((button) => button.hidden)

      expect(visible).toHaveLength(1)
      expect(hidden.length).toBeGreaterThan(0)
      expect(hidden.every((button) => button.disabled && button.tabIndex === -1)).toBe(true)
      expect(
        visible[0]
          ?.closest('[data-editor-virtual-gutter-row]')
          ?.getAttribute('data-editor-virtual-gutter-row'),
      ).toBe('0')
      expect(
        visible[0]
          ?.closest("[data-editor-gutter-contribution='fold-gutter']")
          ?.previousElementSibling?.classList.contains('editor-virtualized-line-number'),
      ).toBe(true)
    })

    it('steps the caret past a collapsed region instead of into the rows it hides', async () => {
      await openCollapsedBlock(editor)
      editor.setSelection(COLLAPSED_BLOCK_HEADER_END)

      dispatchEditorKey('ArrowRight')

      expect(rowsContainingText('  y2();')).toHaveLength(0)
      expect(editor.getState().cursor).toEqual({ row: 4, column: 0 })
      editorRoot().dispatchEvent(createInsertEvent('Q'))
      expect(rowsContainingText('Qz();')).toHaveLength(1)
    })

    it('steps back onto the fold header instead of the last row it hides', async () => {
      await openCollapsedBlock(editor)
      editor.setSelection(COLLAPSED_BLOCK_NEXT_ROW)

      dispatchEditorKey('ArrowLeft')

      expect(editor.getState().cursor).toEqual({
        row: 0,
        column: COLLAPSED_BLOCK_HEADER_END,
      })
      editorRoot().dispatchEvent(createInsertEvent('Q'))
      expect(rowsContainingText('if (x) {Q')).toHaveLength(1)
    })

    it('lets the caret a fold closed over leave the region on the next key', async () => {
      await openCollapsedBlock(editor)
      editor.unfoldAll()
      editor.setSelection(COLLAPSED_BLOCK_HIDDEN_OFFSET)
      editor.fold(0)

      dispatchEditorKey('ArrowRight')
      editorRoot().dispatchEvent(createInsertEvent('Q'))

      expect(editor.materializeFullText()).toContain('\nQz();')
      expect(rowsContainingText('Qz();')).toHaveLength(1)
    })

    it('opens the region a caret is set inside rather than retargeting the caret', async () => {
      await openCollapsedBlock(editor)

      editor.setSelection(COLLAPSED_BLOCK_HIDDEN_OFFSET)

      expect(editor.getState().cursor).toEqual({ row: 2, column: 2 })
      editorRoot().dispatchEvent(createInsertEvent('Q'))
      expect(rowsContainingText('  Qy2();')).toHaveLength(1)
      expect(editor.materializeFullText()).toContain('  y();\n  Qy2();')
    })

    // Rows a host hid through a fold map of its own answer to no region anyone can open, so the
    // caret has nothing to be revealed by and still has to end up on a row that is drawn.
    it('pulls a caret set into rows a host fold map hides onto the row on screen', () => {
      const session = createDocumentSession(COLLAPSED_BLOCK_TEXT)
      editor.attachSession(session)
      editor.setFoldMap(
        createFoldMap(session.getSnapshot(), [
          {
            startIndex: 0,
            endIndex: COLLAPSED_BLOCK_TEXT.indexOf('\nz();'),
            startLine: 0,
            endLine: 3,
            type: 'statement_block',
          },
        ]),
      )

      editor.setSelection(COLLAPSED_BLOCK_HIDDEN_OFFSET)

      expect(editor.getState().cursor).toEqual({
        row: 0,
        column: COLLAPSED_BLOCK_HEADER_END,
      })
    })

    it('leaves a find match inside a collapsed region addressable by find itself', async () => {
      const session = createDocumentSession(COLLAPSED_BLOCK_TEXT)
      await openCollapsedBlock(editor)
      editor.attachSession(session)
      expect(editor.fold(0)).toBe(true)
      expect(rowsContainingText('  y2();')).toHaveLength(0)

      dispatchEditorKey('f', primaryModifier())
      const findInput = container.querySelector('.editor-find-input') as HTMLInputElement
      findInput.value = 'y'
      findInput.dispatchEvent(new Event('input', { bubbles: true }))

      const firstMatch = resolveSelection(
        session.getSnapshot(),
        session.getSelections().selections[0]!,
      )
      expect({
        start: firstMatch.startOffset,
        end: firstMatch.endOffset,
      }).toEqual({
        start: 11,
        end: 12,
      })

      expect(editor.findNext()).toBe(true)

      const secondMatch = resolveSelection(
        session.getSnapshot(),
        session.getSelections().selections[0]!,
      )
      expect({
        start: secondMatch.startOffset,
        end: secondMatch.endOffset,
      }).toEqual({
        start: 18,
        end: 19,
      })
      // And on screen: landing on a hit opened the region that was hiding it.
      expect(rowsContainingText('  y2();')).toHaveLength(1)
    })

    it('refreshes syntax after edits', async () => {
      const changes: string[] = []
      setEditorSyntaxSessionFactory(() =>
        createMockSyntaxSession({
          applyChange: async (change) => {
            changes.push(change.textSnapshot.materializeFullText())
            return createSyntaxResult([{ start: 6, end: 7, style: { color: '#00ff00' } }])
          },
        }),
      )

      editor.openDocument({
        documentId: 'main.ts',
        languageId: 'typescript',
        text: 'const a = 1;',
      })
      await flushMicrotasks()
      editorRoot().dispatchEvent(
        new InputEvent('beforeinput', {
          bubbles: true,
          cancelable: true,
          data: '!',
          inputType: 'insertText',
        }),
      )
      await flushMicrotasks()

      expect(changes).toEqual([])
      await flushSyntaxDebounce()
      expect(changes).toEqual(['const a = 1;!'])
      expect(editor.getState().syntaxStatus).toBe('ready')
      expect(highlightsMap.size).toBe(1)
    })

    it('reloads the syntax session when edit syntax fails', async () => {
      const createdTexts: string[] = []
      let disposeCount = 0
      setEditorSyntaxSessionFactory((options) => {
        createdTexts.push(readAll(options.textSnapshot))
        const isInitialSession = createdTexts.length === 1

        return createMockSyntaxSession({
          refresh: async () =>
            createSyntaxResult([{ start: 0, end: 5, style: { color: '#00ff00' } }]),
          applyChange: async () => {
            if (!isInitialSession) return createSyntaxResult()
            throw new Error('incremental syntax failed')
          },
          dispose: () => {
            disposeCount += 1
          },
        })
      })

      editor.openDocument({
        documentId: 'main.ts',
        languageId: 'typescript',
        text: 'const a = 1;',
      })
      await flushMicrotasks()
      editorRoot().dispatchEvent(createInsertEvent('!'))

      await flushSyntaxDebounce()
      await flushMicrotasks()

      expect(createdTexts).toEqual(['const a = 1;', 'const a = 1;!'])
      expect(disposeCount).toBe(1)
      expect(editor.getState().syntaxStatus).toBe('ready')
      expect(tokenHighlightRanges()[0]?.startOffset).toBe(0)
    })

    it('keeps projected syntax highlights until edit syntax finishes', async () => {
      const editResult = createDeferred<EditorSyntaxResult>()
      setEditorSyntaxSessionFactory(() =>
        createMockSyntaxSession({
          refresh: async () =>
            createSyntaxResult([{ start: 0, end: 5, style: { color: '#ff0000' } }]),
          applyChange: () => editResult.promise,
        }),
      )

      editor.openDocument({
        documentId: 'main.ts',
        languageId: 'typescript',
        text: 'world',
      })
      await flushMicrotasks()
      setCollapsedDomSelection(2)
      editorRoot().dispatchEvent(createInsertEvent('X'))

      const ranges = [...tokenHighlights()[0]!]
      expect(editor.materializeFullText()).toBe('woXrld')
      expect(ranges).toHaveLength(1)
      expect(ranges[0]!.startOffset).toBe(0)

      await flushSyntaxDebounce()
      editResult.resolve(createSyntaxResult([{ start: 0, end: 6, style: { color: '#00ff00' } }]))
      await flushMicrotasks()

      expect(editor.getState().syntaxStatus).toBe('ready')
      expect(tokenHighlights()).toHaveLength(1)
    })

    it('keeps projected syntax highlights stable through mixed newlines and typing', async () => {
      setEditorSyntaxSessionFactory(() =>
        createMockSyntaxSession({
          refresh: async () =>
            createSyntaxResult([
              { start: 0, end: 2, style: { color: '#ff0000' } },
              { start: 3, end: 5, style: { color: '#00ff00' } },
              { start: 6, end: 8, style: { color: '#0000ff' } },
            ]),
          applyChange: () => new Promise<EditorSyntaxResult>(() => undefined),
        }),
      )

      editor.openDocument({
        documentId: 'main.ts',
        languageId: 'typescript',
        text: 'aa\nbb\ncc',
      })
      await flushMicrotasks()

      editor.setSelection(1)
      editorRoot().dispatchEvent(createLineBreakEvent())
      editor.setSelection(2)
      editorRoot().dispatchEvent(createInsertEvent('X'))
      editor.setSelection(3)
      editorRoot().dispatchEvent(createLineBreakEvent())
      editor.setSelection(4)
      editorRoot().dispatchEvent(createInsertEvent('Y'))

      const bbNode = rowTextNode(3)
      const bbRange = tokenHighlightRanges().find((range) => range.startContainer === bbNode)
      expect(editor.materializeFullText()).toBe('a\nX\nYa\nbb\ncc')
      expect(bbRange).toBeDefined()
      expect(bbRange!.startOffset).toBe(0)
      expect(bbRange!.endOffset).toBe(2)
    })

    it('keeps projected syntax highlights stable through repeated newline-only edits', async () => {
      setEditorSyntaxSessionFactory(() =>
        createMockSyntaxSession({
          refresh: async () =>
            createSyntaxResult([
              { start: 0, end: 2, style: { color: '#ff0000' } },
              { start: 3, end: 5, style: { color: '#00ff00' } },
              { start: 6, end: 8, style: { color: '#0000ff' } },
            ]),
          applyChange: () => new Promise<EditorSyntaxResult>(() => undefined),
        }),
      )

      editor.openDocument({
        documentId: 'main.ts',
        languageId: 'typescript',
        text: 'aa\nbb\ncc',
      })
      await flushMicrotasks()

      for (let count = 0; count < 4; count += 1) {
        editor.setSelection(editor.materializeFullText().indexOf('bb'))
        editorRoot().dispatchEvent(createLineBreakEvent())
      }

      const bbRow =
        editor
          .materializeFullText()
          .slice(0, editor.materializeFullText().indexOf('bb'))
          .split('\n').length - 1
      const bbNode = rowTextNode(bbRow)
      const bbRange = tokenHighlightRanges().find((range) => range.startContainer === bbNode)
      expect(editor.materializeFullText()).toBe('aa\n\n\n\n\nbb\ncc')
      expect(bbRange).toBeDefined()
      expect(bbRange!.startOffset).toBe(0)
      expect(bbRange!.endOffset).toBe(2)
    })

    it('keeps syntax fold controls until edit syntax finishes', async () => {
      const text = 'if (x) {\n  y();\n}\nz();'
      const foldEnd = text.indexOf('\nz();')
      const editResult = createDeferred<EditorSyntaxResult>()
      editor.dispose()
      editor = createVisibleEditor(container, {
        plugins: withTestGutterPlugins(),
      })
      setEditorSyntaxSessionFactory(() =>
        createMockSyntaxSession({
          refresh: async () =>
            createSyntaxResult(
              [],
              [
                {
                  startIndex: 0,
                  endIndex: foldEnd,
                  startLine: 0,
                  endLine: 2,
                  type: 'statement_block',
                  languageId: 'typescript',
                },
              ],
            ),
          applyChange: () => editResult.promise,
        }),
      )

      editor.openDocument({
        documentId: 'main.ts',
        languageId: 'typescript',
        text,
      })
      await flushMicrotasks()
      editorRoot().dispatchEvent(createInsertEvent('!'))

      expect(editor.materializeFullText()).toBe(`${text}!`)
      expect(foldToggle().dataset.editorFoldState).toBe('expanded')

      await flushSyntaxDebounce()
      editResult.resolve(createSyntaxResult([], []))
      await flushMicrotasks()

      expect(document.querySelector('.editor-virtualized-fold-toggle:not([hidden])')).toBeNull()
    })

    it('keeps projected highlights and folds through undo while syntax is pending', async () => {
      const text = 'if (x) {\n  y();\n}\nz();'
      const foldEnd = text.indexOf('\nz();')
      const changes: DocumentSessionChange[] = []
      let refreshCount = 0
      editor.dispose()
      editor = createVisibleEditor(container, {
        plugins: withTestGutterPlugins(),
      })
      setEditorSyntaxSessionFactory(() =>
        createMockSyntaxSession({
          refresh: async () => {
            refreshCount += 1
            return createSyntaxResult(
              [{ start: 0, end: 2, style: { color: '#ff0000' } }],
              [
                {
                  startIndex: 0,
                  endIndex: foldEnd,
                  startLine: 0,
                  endLine: 2,
                  type: 'statement_block',
                  languageId: 'typescript',
                },
              ],
            )
          },
          applyChange: async (change) => {
            changes.push(change)
            return createSyntaxResult(
              [{ start: 0, end: 2, style: { color: '#00ff00' } }],
              [
                {
                  startIndex: 0,
                  endIndex: foldEnd,
                  startLine: 0,
                  endLine: 2,
                  type: 'statement_block',
                  languageId: 'typescript',
                },
              ],
            )
          },
        }),
      )

      editor.openDocument({
        documentId: 'main.ts',
        languageId: 'typescript',
        text,
      })
      await flushMicrotasks()
      editorRoot().dispatchEvent(createInsertEvent('!'))
      editorRoot().dispatchEvent(
        new KeyboardEvent('keydown', {
          bubbles: true,
          cancelable: true,
          key: 'z',
          ...primaryModifier(),
        }),
      )

      expect(editor.materializeFullText()).toBe(text)
      expect(tokenHighlightRanges()).toHaveLength(1)
      expect(foldToggle().dataset.editorFoldState).toBe('expanded')
      expect(refreshCount).toBe(1)

      await flushSyntaxDebounce()
      expect(refreshCount).toBe(1)
      expect(changes).toHaveLength(1)
      // The insert and its undo share one debounce window, so the session, which last saw the
      // original text, receives the burst composed against that text: a no-op at the caret.
      expect(changes[0]).toMatchObject({
        kind: 'undo',
        edits: [{ from: text.length, to: text.length, text: '' }],
      })
    })

    it('moves syntax fold controls through line edits while syntax is pending', async () => {
      const text = 'a\nif (x) {\n  y();\n}\nz();'
      const foldStart = text.indexOf('if')
      const foldEnd = text.indexOf('\nz();')
      const editResult = createDeferred<EditorSyntaxResult>()
      editor.dispose()
      editor = createVisibleEditor(container, {
        plugins: withTestGutterPlugins(),
      })
      setEditorSyntaxSessionFactory(() =>
        createMockSyntaxSession({
          refresh: async () =>
            createSyntaxResult(
              [],
              [
                {
                  startIndex: foldStart,
                  endIndex: foldEnd,
                  startLine: 1,
                  endLine: 3,
                  type: 'statement_block',
                  languageId: 'typescript',
                },
              ],
            ),
          applyChange: () => editResult.promise,
        }),
      )

      editor.openDocument({
        documentId: 'main.ts',
        languageId: 'typescript',
        text,
      })
      await flushMicrotasks()
      foldToggle().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      setCollapsedDomSelection(0)
      editorRoot().dispatchEvent(createLineBreakEvent())

      const gutterRow = foldToggle()
        .closest('[data-editor-virtual-gutter-row]')
        ?.getAttribute('data-editor-virtual-gutter-row')
      expect(gutterRow).toBe('2')
      expect(foldToggle().dataset.editorFoldState).toBe('collapsed')
      expect(editorRoot().textContent).toContain('...')
      expect(editorRoot().textContent).not.toContain('  y();')

      await flushSyntaxDebounce()
      editResult.resolve(createSyntaxResult([], []))
      await flushMicrotasks()
    })

    it('debounces rapid edit syntax requests to the latest text', async () => {
      const changes: string[] = []
      setEditorSyntaxSessionFactory(() =>
        createMockSyntaxSession({
          refresh: async () => createSyntaxResult([]),
          applyChange: async (change) => {
            changes.push(change.textSnapshot.materializeFullText())
            return createSyntaxResult([{ start: 0, end: 5, style: { color: '#00ff00' } }])
          },
        }),
      )

      editor.openDocument({
        documentId: 'main.ts',
        languageId: 'typescript',
        text: 'const a = 1;',
      })
      await flushMicrotasks()
      editorRoot().dispatchEvent(createInsertEvent('!'))
      editorRoot().dispatchEvent(createInsertEvent('?'))

      await flushSyntaxDebounce()
      expect(changes).toEqual(['const a = 1;!?'])
      expect(editor.materializeFullText()).toBe('const a = 1;!?')
      expect(highlightsMap.size).toBe(1)
    })

    it('ignores stale syntax results after a newer edit', async () => {
      const initial = createDeferred<EditorSyntaxResult>()
      const firstEdit = createDeferred<EditorSyntaxResult>()
      const secondEdit = createDeferred<EditorSyntaxResult>()
      const editResults = [firstEdit, secondEdit]
      setEditorSyntaxSessionFactory(() =>
        createMockSyntaxSession({
          refresh: () => initial.promise,
          applyChange: () => editResults.shift()!.promise,
        }),
      )

      editor.openDocument({
        documentId: 'main.ts',
        languageId: 'typescript',
        text: 'const a = 1;',
      })
      initial.resolve(createSyntaxResult([]))
      await flushMicrotasks()
      editorRoot().dispatchEvent(createInsertEvent('!'))
      await flushSyntaxDebounce()
      editorRoot().dispatchEvent(createInsertEvent('?'))
      await flushSyntaxDebounce()

      secondEdit.resolve(createSyntaxResult([{ start: 0, end: 5, style: { color: '#00ff00' } }]))
      await flushMicrotasks()
      expect(highlightsMap.size).toBe(1)

      firstEdit.resolve(createSyntaxResult([{ start: 6, end: 7, style: { color: '#ff0000' } }]))
      await flushMicrotasks()
      expect(editor.materializeFullText()).toBe('const a = 1;!?')
      expect(highlightsMap.size).toBe(1)
    })

    it('debounces rapid edit plugin highlight requests to the latest text', async () => {
      const changes: string[] = []
      const highlighter = createMockHighlighterSession({
        refresh: async () => createHighlightResult([]),
        applyChange: async (change) => {
          changes.push(change.textSnapshot.materializeFullText())
          return createHighlightResult([{ start: 0, end: 5, style: { color: '#00ff00' } }])
        },
      })
      editor.dispose()
      editor = createVisibleEditor(container, {
        plugins: withTestLanguagePlugins(createHighlighterPlugin(highlighter)),
      })
      setEditorSyntaxSessionFactory(() =>
        createMockSyntaxSession({
          refresh: async () => createSyntaxResult([]),
          applyChange: async () => createSyntaxResult([]),
        }),
      )

      editor.openDocument({
        documentId: 'main.ts',
        languageId: 'typescript',
        text: 'const a = 1;',
      })
      await flushMicrotasks()
      editorRoot().dispatchEvent(createInsertEvent('!'))
      editorRoot().dispatchEvent(createInsertEvent('?'))

      await flushSyntaxDebounce()
      expect(changes).toEqual(['const a = 1;!?'])
      expect(tokenHighlightRanges()[0]?.startOffset).toBe(0)
    })

    it('reloads the plugin highlighter session when edit highlighting fails', async () => {
      const createdTexts: string[] = []
      let disposeCount = 0
      const plugin: EditorPlugin = {
        activate: (context) =>
          context.registerHighlighter({
            createSession: (options) => {
              createdTexts.push(readAll(options.textSnapshot))
              const isInitialSession = createdTexts.length === 1

              return createMockHighlighterSession({
                refresh: async () =>
                  createHighlightResult(
                    isInitialSession ? [] : [{ start: 0, end: 5, style: { color: '#00ff00' } }],
                  ),
                applyChange: async () => {
                  throw new Error('incremental highlighting failed')
                },
                dispose: () => {
                  disposeCount += 1
                },
              })
            },
          }),
      }
      editor.dispose()
      editor = createVisibleEditor(container, {
        plugins: withTestLanguagePlugins(plugin),
      })
      setEditorSyntaxSessionFactory(() =>
        createMockSyntaxSession({
          refresh: async () => createSyntaxResult([]),
          applyChange: async () => createSyntaxResult([]),
        }),
      )

      editor.openDocument({
        documentId: 'main.ts',
        languageId: 'typescript',
        text: 'const a = 1;',
      })
      await flushMicrotasks()
      editorRoot().dispatchEvent(createInsertEvent('!'))

      await flushSyntaxDebounce()
      await flushMicrotasks()

      expect(createdTexts).toEqual(['const a = 1;', 'const a = 1;!'])
      expect(disposeCount).toBe(1)
      expect(tokenHighlightRanges()[0]?.startOffset).toBe(0)
    })

    it('sends undo edits to plugin highlighter sessions', async () => {
      const changes: DocumentSessionChange[] = []
      const highlighter = createMockHighlighterSession({
        refresh: async () => createHighlightResult([]),
        applyChange: async (change) => {
          changes.push(change)
          return createHighlightResult([])
        },
      })
      editor.dispose()
      editor = createVisibleEditor(container, {
        plugins: withTestLanguagePlugins(createHighlighterPlugin(highlighter)),
      })
      setEditorSyntaxSessionFactory(() =>
        createMockSyntaxSession({
          refresh: async () => createSyntaxResult([]),
          applyChange: async () => createSyntaxResult([]),
        }),
      )

      editor.openDocument({
        documentId: 'main.ts',
        languageId: 'typescript',
        text: 'const a = 1;',
      })
      await flushMicrotasks()
      editorRoot().dispatchEvent(createInsertEvent('!'))
      editorRoot().dispatchEvent(
        new KeyboardEvent('keydown', {
          bubbles: true,
          cancelable: true,
          key: 'z',
          ...primaryModifier(),
        }),
      )

      await flushSyntaxDebounce()
      expect(changes).toHaveLength(1)
      // The insert and its undo land in one debounce window, so the highlighter, which last saw
      // the original text, receives the burst composed against that text: a no-op at the caret.
      expect(changes[0]).toMatchObject({
        kind: 'undo',
        edits: [{ from: 12, to: 12, text: '' }],
      })
    })

    it('ignores stale plugin highlight results after a newer edit', async () => {
      const firstEdit = createDeferred<EditorHighlightResult>()
      const secondEdit = createDeferred<EditorHighlightResult>()
      const editResults = [firstEdit, secondEdit]
      const highlighter = createMockHighlighterSession({
        refresh: async () => createHighlightResult([]),
        applyChange: () => editResults.shift()!.promise,
      })
      editor.dispose()
      editor = createVisibleEditor(container, {
        plugins: withTestLanguagePlugins(createHighlighterPlugin(highlighter)),
      })
      setEditorSyntaxSessionFactory(() =>
        createMockSyntaxSession({
          refresh: async () => createSyntaxResult([]),
          applyChange: async () => createSyntaxResult([]),
        }),
      )

      editor.openDocument({
        documentId: 'main.ts',
        languageId: 'typescript',
        text: 'const a = 1;',
      })
      await flushMicrotasks()
      editorRoot().dispatchEvent(createInsertEvent('!'))
      await flushSyntaxDebounce()
      editorRoot().dispatchEvent(createInsertEvent('?'))
      await flushSyntaxDebounce()

      secondEdit.resolve(createHighlightResult([{ start: 0, end: 5, style: { color: '#00ff00' } }]))
      await flushMicrotasks()
      expect(tokenHighlightRanges()[0]?.startOffset).toBe(0)

      firstEdit.resolve(createHighlightResult([{ start: 6, end: 7, style: { color: '#ff0000' } }]))
      await flushMicrotasks()
      expect(editor.materializeFullText()).toBe('const a = 1;!?')
      expect(tokenHighlightRanges()[0]?.startOffset).toBe(0)
    })

    it('keeps structural syntax ready when plugin highlighting fails', async () => {
      const highlighter = createMockHighlighterSession({
        refresh: async () => {
          throw new Error('highlight failed')
        },
      })
      editor.dispose()
      editor = createVisibleEditor(container, {
        plugins: withTestLanguagePlugins(createHighlighterPlugin(highlighter)),
      })
      setEditorSyntaxSessionFactory(() =>
        createMockSyntaxSession({
          refresh: async () => createSyntaxResult([]),
        }),
      )

      editor.openDocument({
        documentId: 'main.ts',
        languageId: 'typescript',
        text: 'const a = 1;',
      })
      await flushMicrotasks()

      expect(editor.getState().syntaxStatus).toBe('ready')
      expect(tokenHighlights()).toHaveLength(0)
    })

    it('falls back to plain text for unknown languages', async () => {
      const created: EditorSyntaxSessionOptions[] = []
      setEditorSyntaxSessionFactory((options) => {
        created.push(options)
        return createMockSyntaxSession()
      })

      editor.openDocument({ documentId: 'README', text: 'hello' })
      await flushMicrotasks()

      expect(created).toEqual([])
      expect(editor.getState().syntaxStatus).toBe('plain')
      expect(highlightsMap.size).toBe(0)
    })

    it('keeps explicit but unregistered languages editable', async () => {
      editor.dispose()
      editor = createVisibleEditor(container)

      editor.openDocument({
        documentId: 'main.rs',
        languageId: 'rust',
        text: 'fn main() {}',
      })
      await flushMicrotasks()
      editorRoot().dispatchEvent(createLineBreakEvent())
      await flushSyntaxDebounce()

      expect(editor.materializeFullText()).toBe('fn main() {}\n')
      expect(editor.getState()).toMatchObject({
        languageId: 'rust',
        syntaxStatus: 'plain',
      })
      expect(highlightsMap.size).toBe(0)
    })

    it('logs one wide structural syntax failure and keeps editing available', async () => {
      const events: EditorLogEvent[] = []
      setEditorSyntaxSessionFactory(() =>
        createMockSyntaxSession({
          refresh: async () => {
            throw new Error('parse failed')
          },
        }),
      )
      editor.dispose()
      editor = createVisibleEditor(container, {
        plugins: [createEditorLoggingPlugin((event) => events.push(event))],
      })

      editor.openDocument({
        documentId: 'main.ts',
        languageId: 'typescript',
        text: 'const a = 1;',
      })
      await flushMicrotasks()
      expect(editor.getState().syntaxStatus).toBe('error')
      expect(
        events.filter(
          (event) =>
            event.action === 'editor.syntax.structural_request_failed' ||
            event.action === 'editor.syntax.structural_error',
        ),
      ).toEqual([
        expect.objectContaining({
          action: 'editor.syntax.structural_request_failed',
          error: expect.objectContaining({ message: 'parse failed' }),
          level: 'error',
          syntax: expect.objectContaining({
            changeKind: 'refresh',
            syntaxStatus: 'error',
          }),
        }),
      ])
      editorRoot().dispatchEvent(createInsertEvent('!'))

      expect(editor.materializeFullText()).toBe('const a = 1;!')
    })
  })

  describe('clear', () => {
    it('clears content and highlights', () => {
      editor.setContent('test')
      editor.setTokens([{ start: 0, end: 4, style: { color: '#ff0000' } }])
      editor.clear()
      expect(editorRoot().textContent).toBe('')
      expect(highlightsMap.size).toBe(0)
    })

    it('unsubscribes from an attached buffer before clearing the document', () => {
      const buffer = createEditorTextBuffer('old')
      const session = createEditorBufferSession(buffer)
      const unsubscribe = vi.fn()
      trackBufferSubscriptionDisposal(buffer, unsubscribe)
      editor.attachSession(session)

      editor.clearDocument()
      session.applyEdits([{ from: 0, to: 3, text: 'stale' }])

      expect(unsubscribe).toHaveBeenCalledOnce()
      expect(editor.materializeFullText()).toBe('')
      expect(editorRoot().textContent).toBe('')
    })
  })

  describe('dispose', () => {
    it('removes elements from DOM', () => {
      expect(container.querySelector('.editor-virtualized')).not.toBeNull()
      editor.dispose()
      expect(container.querySelector('.editor-virtualized')).toBeNull()
    })
  })
})

/** The text `edit` leaves behind, which a detached `applyEdit` is handed alongside the edit. */
function after(text: string, edit: { from: number; to: number; text: string }) {
  return createStringTextSnapshot(text.slice(0, edit.from) + edit.text + text.slice(edit.to))
}
