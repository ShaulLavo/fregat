import {
  createEditorOptionSync,
  EDITOR_OPTION_DESCRIPTORS,
  type EditorControlledOptionName,
  type EditorControlledSelection,
  type EditorOptionSync,
} from '@singapore-editor/core'
import {
  Editor,
  type EditorChangeHandler,
  type EditorCommandContext,
  type EditorCommandId,
  type EditorDocumentMode,
  type EditorEditability,
  type EditorEditInput,
  type EditorEditOptions,
  type EditorKeymapOptions,
  type EditorOpenDocumentOptions,
  type EditorOptions,
  type EditorRangeDecoration,
  type EditorScrollMode,
  type EditorScrollPosition,
  type EditorSetSelectionOptions,
  type EditorSetTextOptions,
  type EditorState,
  type EditorSuspiciousCharactersOptions,
} from '@singapore-editor/core/editor'
import type { TextReadSnapshot } from '@singapore-editor/core/document'
import type { EditorSyntaxLanguageId } from '@singapore-editor/core/syntax'
import type { EditorTheme, HiddenCharactersMode } from '@singapore-editor/core/rendering'
import type {
  EditorContributionChange,
  EditorPlugin,
  EditorViewContributionUpdateKind,
  EditorViewSnapshot,
} from '@singapore-editor/core/extensions'
import {
  batch,
  createEffect,
  createSignal,
  onCleanup,
  onMount,
  untrack,
  type Accessor,
} from 'solid-js'

export type SolidEditorReactiveValue<T> = T | Accessor<T>

export type SolidEditorDocument = {
  readonly documentId?: string
  readonly revision?: string | number
  readonly text: string
  readonly documentMode?: EditorDocumentMode
  readonly languageId?: EditorSyntaxLanguageId | null
  readonly scrollPosition?: EditorScrollPosition
}

export type SolidEditorSelection = EditorControlledSelection

export type SolidEditorOptions = Omit<
  EditorOptions,
  | 'editability'
  | 'fontFamily'
  | 'fontSize'
  | 'gutterLeadingInset'
  | 'gutterScroll'
  | 'hiddenCharacters'
  | 'keymap'
  | 'lineHeight'
  | 'onChange'
  | 'rangeDecorations'
  | 'rowGap'
  | 'scrollMode'
  | 'suspiciousCharacters'
  | 'tabMovesFocus'
  | 'tabSize'
  | 'theme'
  | 'wordWrap'
> & {
  readonly document?: SolidEditorReactiveValue<SolidEditorDocument | null | undefined>
  readonly editability?: SolidEditorReactiveValue<EditorEditability | undefined>
  readonly fontFamily?: SolidEditorReactiveValue<string | undefined>
  readonly fontSize?: SolidEditorReactiveValue<number | undefined>
  readonly gutterLeadingInset?: SolidEditorReactiveValue<number | undefined>
  readonly gutterScroll?: SolidEditorReactiveValue<EditorOptions['gutterScroll']>
  readonly theme?: SolidEditorReactiveValue<EditorTheme | null | undefined>
  readonly hiddenCharacters?: SolidEditorReactiveValue<HiddenCharactersMode | undefined>
  readonly keymap?: SolidEditorReactiveValue<EditorKeymapOptions | undefined>
  readonly lineHeight?: SolidEditorReactiveValue<number | undefined>
  readonly rangeDecorations?: SolidEditorReactiveValue<readonly EditorRangeDecoration[] | undefined>
  readonly rowGap?: SolidEditorReactiveValue<number | undefined>
  readonly scrollMode?: SolidEditorReactiveValue<EditorScrollMode | undefined>
  readonly selection?: SolidEditorReactiveValue<SolidEditorSelection | null | undefined>
  readonly scrollPosition?: SolidEditorReactiveValue<EditorScrollPosition | null | undefined>
  readonly suspiciousCharacters?: SolidEditorReactiveValue<
    EditorSuspiciousCharactersOptions | undefined
  >
  readonly tabMovesFocus?: SolidEditorReactiveValue<boolean | undefined>
  readonly tabSize?: SolidEditorReactiveValue<number | undefined>
  readonly wordWrap?: SolidEditorReactiveValue<boolean | undefined>
  readonly onChange?: EditorChangeHandler
}

export type SolidEditorCommands = {
  focus(): void
  openDocument(document: EditorOpenDocumentOptions): void
  setText(text: string, options?: EditorSetTextOptions): void
  edit(editOrEdits: EditorEditInput, options?: EditorEditOptions): void
  setSelection(anchor: number, head?: number, options?: EditorSetSelectionOptions): void
  setScrollPosition(scrollPosition: EditorScrollPosition): void
  dispatchCommand(command: EditorCommandId, context?: EditorCommandContext): boolean
  openFind(): boolean
  openFindReplace(): boolean
  closeFind(): boolean
  findNext(): boolean
  findPrevious(): boolean
  replaceOne(): boolean
  replaceAll(): boolean
  selectAllMatches(): boolean
}

export type SolidEditorController = {
  /** Pass as a JSX ref; creates the editor after Solid mounts and disposes it with its owner. */
  element(element: HTMLElement): void
  editor: Accessor<Editor | null>
  state: Accessor<EditorState | null>
  snapshot: Accessor<EditorViewSnapshot | null>
  textSnapshot: Accessor<TextReadSnapshot | null>
  /** The whole text of the current revision: O(document length) on the first read of each one. */
  materializeFullText: Accessor<string>
  lastChange: Accessor<EditorContributionChange | null>
  updateKind: Accessor<EditorViewContributionUpdateKind | null>
  dispose(): void
  readonly commands: SolidEditorCommands
}

type SolidEditorRuntime = {
  readonly getEditor: Accessor<Editor | null>
  readonly setEditor: (editor: Editor | null) => void
  readonly setState: (state: EditorState | null) => void
  readonly setSnapshot: (snapshot: EditorViewSnapshot | null) => void
  readonly setTextSnapshot: (snapshot: TextReadSnapshot | null) => void
  readonly setLastChange: (change: EditorContributionChange | null) => void
  readonly setUpdateKind: (kind: EditorViewContributionUpdateKind | null) => void
}

const NO_DOCUMENT = Symbol('no-document')

export function createEditor(options: SolidEditorOptions = {}): SolidEditorController {
  const [editor, setEditor] = createSignal<Editor | null>(null)
  const [state, setState] = createSignal<EditorState | null>(null)
  const [snapshot, setSnapshot] = createSignal<EditorViewSnapshot | null>(null)
  const [textSnapshot, setTextSource] = createSignal<TextReadSnapshot | null>(null)
  const fullText = createLazyFullTextAccessor(textSnapshot)
  // Any new source — an edit, a replaced or closed document — ends the cached pair's revision.
  const setTextSnapshot = (next: TextReadSnapshot | null): void => {
    fullText.release(next)
    setTextSource(() => next)
  }
  const [lastChange, setLastChange] = createSignal<EditorContributionChange | null>(null)
  const [updateKind, setUpdateKind] = createSignal<EditorViewContributionUpdateKind | null>(null)
  const runtime = {
    getEditor: editor,
    setEditor,
    setState,
    setSnapshot,
    setTextSnapshot,
    setLastChange,
    setUpdateKind,
  } satisfies SolidEditorRuntime
  const documentState = createDocumentState()
  const optionSync = createEditorOptionSync()

  let lifecycle: 'pending' | 'ready' | 'disposed' = 'pending'
  let pendingHost: HTMLElement | null = null

  const dispose = (): void => {
    pendingHost = null
    disposeEditor(runtime)
    fullText.clear()
    documentState.clear()
    optionSync.reset()
  }

  const mount = (element: HTMLElement): void => {
    if (lifecycle === 'disposed') return
    if (lifecycle === 'pending') {
      pendingHost = element
      return
    }
    dispose()
    mountEditor(element, options, runtime, documentState, optionSync)
  }

  onMount(() => {
    lifecycle = 'ready'
    if (pendingHost) mount(pendingHost)
  })
  createReactiveEffects(options, runtime, documentState, optionSync)
  onCleanup(() => {
    lifecycle = 'disposed'
    dispose()
  })

  return {
    element: mount,
    editor,
    state,
    snapshot,
    textSnapshot,
    materializeFullText: fullText.read,
    lastChange,
    updateKind,
    dispose,
    commands: createCommands(editor, documentState),
  }
}

type LazyFullTextAccessor = {
  readonly read: Accessor<string>
  readonly clear: () => void
  /** Drops the cached pair unless it belongs to `next`; never reads `next` itself. */
  readonly release: (next: TextReadSnapshot | null) => void
}

/** Holds at most the current source and its text, and lets go as soon as the source moves on. */
function createLazyFullTextAccessor(
  textSnapshot: Accessor<TextReadSnapshot | null>,
): LazyFullTextAccessor {
  let cachedSource: TextReadSnapshot | null = null
  let cachedText = ''

  const readWholeRevision = (): string => {
    const source = textSnapshot()
    if (source === cachedSource) return cachedText

    cachedSource = source
    cachedText = source ? source.readRange(0, source.length) : ''
    return cachedText
  }
  const clear = (): void => {
    cachedSource = null
    cachedText = ''
  }
  const release = (next: TextReadSnapshot | null): void => {
    if (next !== cachedSource) clear()
  }
  return { read: readWholeRevision, clear, release }
}

function mountEditor(
  element: HTMLElement,
  options: SolidEditorOptions,
  runtime: SolidEditorRuntime,
  documentState: SolidEditorDocumentState,
  optionSync: EditorOptionSync,
): void {
  const instance = new Editor(element, createConstructorOptions(options, runtime))

  batch(() => {
    runtime.setEditor(instance)
    runtime.setState(instance.getState())
    runtime.setTextSnapshot(instance.getTextSnapshot())
  })

  untrack(() => {
    syncDocument(instance, readReactive(options.document), documentState)
    for (const descriptor of EDITOR_OPTION_DESCRIPTORS) {
      optionSync.apply(instance, descriptor, controlledOptionInput(options, descriptor.name))
    }
  })
}

function createConstructorOptions(
  options: SolidEditorOptions,
  runtime: SolidEditorRuntime,
): EditorOptions {
  const {
    document: _document,
    editability,
    fontFamily,
    fontSize,
    gutterLeadingInset,
    gutterScroll,
    hiddenCharacters,
    keymap,
    lineHeight,
    onChange,
    plugins,
    rangeDecorations,
    rowGap,
    scrollMode,
    scrollPosition: _scrollPosition,
    selection: _selection,
    suspiciousCharacters,
    tabMovesFocus,
    tabSize,
    theme,
    wordWrap,
    ...constructorOptions
  } = options

  return untrack((): EditorOptions => ({
    ...constructorOptions,
    editability: readReactive(editability),
    fontFamily: readReactive(fontFamily),
    fontSize: readReactive(fontSize),
    gutterLeadingInset: readReactive(gutterLeadingInset),
    gutterScroll: readReactive(gutterScroll),
    hiddenCharacters: readReactive(hiddenCharacters),
    keymap: readReactive(keymap),
    lineHeight: readReactive(lineHeight),
    rangeDecorations: readReactive(rangeDecorations),
    rowGap: readReactive(rowGap),
    scrollMode: readReactive(scrollMode),
    suspiciousCharacters: readReactive(suspiciousCharacters),
    tabMovesFocus: readReactive(tabMovesFocus),
    tabSize: readReactive(tabSize),
    theme: readReactive(theme) ?? undefined,
    wordWrap: readReactive(wordWrap),
    plugins: [createSolidSyncPlugin(runtime)].concat(plugins ?? []),
    onChange: (state, change) => {
      syncChange(runtime, state, change)
      onChange?.(state, change)
    },
  }))
}

function createReactiveEffects(
  options: SolidEditorOptions,
  runtime: SolidEditorRuntime,
  documentState: SolidEditorDocumentState,
  optionSync: EditorOptionSync,
): void {
  createEffect(() =>
    syncDocument(runtime.getEditor(), readReactive(options.document), documentState),
  )
  // One effect per descriptor, so each option tracks only the source it was given.
  for (const descriptor of EDITOR_OPTION_DESCRIPTORS) {
    createEffect(() =>
      optionSync.apply(
        runtime.getEditor(),
        descriptor,
        controlledOptionInput(options, descriptor.name),
      ),
    )
  }
}

function controlledOptionInput(
  options: SolidEditorOptions,
  name: EditorControlledOptionName,
): unknown {
  return readReactive(options[name] as SolidEditorReactiveValue<unknown>)
}

function createSolidSyncPlugin(runtime: SolidEditorRuntime): EditorPlugin {
  return {
    name: 'solid-editor-sync',
    activate: (context) =>
      context.registerViewContribution({
        createContribution: () => ({
          update: (snapshot, kind, change) => syncSnapshot(runtime, snapshot, kind, change ?? null),
          dispose: () => undefined,
        }),
      }),
  }
}

function syncSnapshot(
  runtime: SolidEditorRuntime,
  snapshot: EditorViewSnapshot,
  kind: EditorViewContributionUpdateKind,
  change: EditorContributionChange | null,
): void {
  batch(() => {
    runtime.setSnapshot(snapshot)
    runtime.setTextSnapshot(snapshot.textSnapshot)
    runtime.setLastChange(change)
    runtime.setUpdateKind(kind)
  })
}

function syncChange(
  runtime: SolidEditorRuntime,
  state: EditorState,
  change: EditorContributionChange | null,
): void {
  const editor = runtime.getEditor()

  batch(() => {
    runtime.setState(state)
    runtime.setTextSnapshot(editor?.getTextSnapshot() ?? null)
    runtime.setLastChange(change)
  })
}

function syncDocument(
  editor: Editor | null,
  document: SolidEditorDocument | null | undefined,
  state: SolidEditorDocumentState,
): void {
  if (!editor) return

  const key = documentKey(document)
  if (key === state.key()) return

  state.setKey(key)
  if (!document) {
    editor.clearDocument()
    return
  }

  editor.openDocument({
    documentId: document.documentId,
    documentMode: document.documentMode,
    languageId: document.languageId,
    scrollPosition: document.scrollPosition,
    text: document.text,
  })
}

function disposeEditor(runtime: SolidEditorRuntime): void {
  const editor = runtime.getEditor()
  if (!editor) return

  editor.dispose()
  batch(() => {
    runtime.setEditor(null)
    runtime.setState(null)
    runtime.setSnapshot(null)
    runtime.setTextSnapshot(null)
    runtime.setLastChange(null)
    runtime.setUpdateKind(null)
  })
}

function createCommands(
  editor: Accessor<Editor | null>,
  documentState: SolidEditorDocumentState,
): SolidEditorCommands {
  return {
    focus: () => editor()?.focus(),
    openDocument: (document) => {
      documentState.setKey(documentKey(document))
      editor()?.openDocument(document)
    },
    setText: (text, options) => editor()?.setText(text, options),
    edit: (editOrEdits, options) => editor()?.edit(editOrEdits, options),
    setSelection: (anchor, head, options) => editor()?.setSelection(anchor, head, options),
    setScrollPosition: (scrollPosition) => editor()?.setScrollPosition(scrollPosition),
    dispatchCommand: (command, context) => editor()?.dispatchCommand(command, context) ?? false,
    openFind: () => editor()?.openFind() ?? false,
    openFindReplace: () => editor()?.openFindReplace() ?? false,
    closeFind: () => editor()?.closeFind() ?? false,
    findNext: () => editor()?.findNext() ?? false,
    findPrevious: () => editor()?.findPrevious() ?? false,
    replaceOne: () => editor()?.replaceOne() ?? false,
    replaceAll: () => editor()?.replaceAll() ?? false,
    selectAllMatches: () => editor()?.selectAllMatches() ?? false,
  }
}

type SolidEditorDocumentState = {
  key(): SolidEditorDocumentKey
  setKey(key: SolidEditorDocumentKey): void
  clear(): void
}

type SolidEditorDocumentKey = string | typeof NO_DOCUMENT

function createDocumentState(): SolidEditorDocumentState {
  let key: SolidEditorDocumentKey = NO_DOCUMENT

  return {
    key: () => key,
    setKey: (nextKey) => {
      key = nextKey
    },
    clear: () => {
      key = NO_DOCUMENT
    },
  }
}

function documentKey(document: SolidEditorDocument | null | undefined): SolidEditorDocumentKey {
  if (!document) return NO_DOCUMENT

  return `${document.documentId ?? ''}\u0000${document.documentMode ?? ''}\u0000${
    document.revision ?? ''
  }`
}

function readReactive<T>(value: SolidEditorReactiveValue<T> | undefined): T | undefined {
  if (typeof value !== 'function') return value

  return (value as Accessor<T>)()
}
