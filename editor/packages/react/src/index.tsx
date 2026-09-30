import {
  createEditorOptionSync,
  EDITOR_OPTION_DESCRIPTORS,
  type EditorControlledSelection,
  type EditorOptionDescriptor,
  type EditorOptionSync,
} from '@singapore-editor/core'
import {
  Editor,
  type EditorChangeHandler,
  type EditorCommandContext,
  type EditorCommandId,
  type EditorDocumentMode,
  type EditorDocumentAnalysis,
  type EditorEditInput,
  type EditorEditOptions,
  type EditorOpenDocumentOptions,
  type EditorOptions,
  type EditorPreparedDocument,
  type EditorPreparedTagValue,
  type EditorScrollPosition,
  type EditorSetSelectionOptions,
  type EditorSetTextOptions,
  type EditorState,
} from '@singapore-editor/core/editor'
import {
  createEditorBufferSession,
  type DocumentSession,
  type EditorBufferSession,
  type EditorTextBuffer,
  type EditorViewSession,
  type TextReadSnapshot,
  type TextSnapshot,
} from '@singapore-editor/core/document'
import type { EditorSyntaxLanguageId } from '@singapore-editor/core/syntax'
import type { EditorTheme, HiddenCharactersMode } from '@singapore-editor/core/rendering'
import type {
  EditorContributionChange,
  EditorInitialPaintEvent,
  EditorPlugin,
  EditorViewContributionUpdateKind,
  EditorViewSnapshot,
} from '@singapore-editor/core/extensions'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactElement,
} from 'react'

export type ReactEditorDocument = {
  readonly analysis?: EditorDocumentAnalysis | null
  readonly documentId?: string
  readonly revision?: string | number
  readonly buffer?: EditorTextBuffer | null
  readonly view?: EditorViewSession | null
  readonly session?: DocumentSession | null
  readonly text: string
  readonly documentMode?: EditorDocumentMode
  readonly documentConfigurationTag?: readonly EditorPreparedTagValue[]
  readonly highlighterConfigurationTag?: readonly EditorPreparedTagValue[]
  readonly languageId?: EditorSyntaxLanguageId | null
  readonly preparedDocument?: EditorPreparedDocument | null
  readonly scrollPosition?: EditorScrollPosition
  readonly textSyncMode?: ReactEditorDocumentTextSyncMode
  readonly structuralConfigurationTag?: readonly EditorPreparedTagValue[]
}

export type ReactEditorDocumentTextSyncMode = 'open' | 'incremental'

export type ReactEditorSelection = EditorControlledSelection

export type ReactEditorOptions = Omit<
  EditorOptions,
  'hiddenCharacters' | 'onChange' | 'onInitialPaint' | 'theme'
> & {
  readonly document?: ReactEditorDocument | null | undefined
  readonly theme?: EditorTheme | null | undefined
  readonly hiddenCharacters?: HiddenCharactersMode | undefined
  readonly selection?: ReactEditorSelection | null | undefined
  readonly scrollPosition?: EditorScrollPosition | null | undefined
  readonly storeSync?: ReactEditorStoreSyncMode
  readonly onChange?: EditorChangeHandler
  readonly onInitialPaint?: (event: EditorInitialPaintEvent) => void
}

export type ReactEditorStoreSyncMode = 'full' | 'none'

export type ReactEditorCommands = {
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

export type ReactEditorStoreSnapshot = {
  readonly editor: Editor | null
  readonly state: EditorState | null
  readonly snapshot: EditorViewSnapshot | null
  readonly textSnapshot: TextReadSnapshot | null
  readonly lastChange: EditorContributionChange | null
  readonly updateKind: EditorViewContributionUpdateKind | null
}

export type ReactEditorSelector<T> = (snapshot: ReactEditorStoreSnapshot) => T
export type ReactEditorSelectorEquality<T> = (current: T, next: T) => boolean

export type ReactEditorController = {
  mount(element: HTMLElement): void
  dispose(): void
  getEditor(): Editor | null
  getState(): EditorState | null
  getSnapshot(): EditorViewSnapshot | null
  getTextSnapshot(): TextSnapshot | null
  materializeFullText(): string
  getLastChange(): EditorContributionChange | null
  getUpdateKind(): EditorViewContributionUpdateKind | null
  useEditorInstance(): Editor | null
  useState(): EditorState | null
  useSnapshot(): EditorViewSnapshot | null
  useTextSnapshot(): TextReadSnapshot | null
  /** Re-renders with the whole text on every text revision: O(document length) each time. */
  useFullText(): string
  useLastChange(): EditorContributionChange | null
  useUpdateKind(): EditorViewContributionUpdateKind | null
  readonly commands: ReactEditorCommands
}

export type EditorHostProps = {
  readonly controller: ReactEditorController
  readonly className?: string
  readonly style?: CSSProperties
}

type ReactEditorStorePatch = Partial<ReactEditorStoreSnapshot>

type ReactEditorSelectorSubscription<T> = {
  selector: ReactEditorSelector<T>
  isEqual: ReactEditorSelectorEquality<T>
  value: T
  notify: (() => void) | null
}

type ReactEditorDocumentState = {
  generation(): number
  key(): ReactEditorDocumentKey
  identityKey(): ReactEditorDocumentKey
  setKey(key: ReactEditorDocumentKey, identityKey?: ReactEditorDocumentKey): void
  clear(): void
}

type ReactEditorDocumentKey = string | typeof NO_DOCUMENT

type ReactEditorSnapshotEligibility = {
  readonly documentKey: string | null
  readonly snapshot: string | null
}

type ReactEditorControllerPrivate = ReactEditorController & {
  readonly [CONTROLLER_PRIVATE]: ReactEditorControllerImplementation
}

// Selectors can run during Fast Refresh before the controller's owner rerenders.
const CONTROLLER_PRIVATE = Symbol.for('@singapore-editor/react/controller-private')
const NO_DOCUMENT = Symbol('no-document')
const EMPTY_PLUGINS: readonly EditorPlugin[] = []
const DOCUMENT_OPTION_NAMES = new Set(['rangeDecorations', 'selection', 'scrollPosition'])
const CONFIGURATION_OPTIONS = EDITOR_OPTION_DESCRIPTORS.filter(
  (descriptor) => !DOCUMENT_OPTION_NAMES.has(descriptor.name),
)
const DOCUMENT_OPTIONS = EDITOR_OPTION_DESCRIPTORS.filter((descriptor) =>
  DOCUMENT_OPTION_NAMES.has(descriptor.name),
)
const useEditorLayoutEffect = typeof document === 'undefined' ? useEffect : useLayoutEffect

const selectEditor = (snapshot: ReactEditorStoreSnapshot): Editor | null => snapshot.editor
const selectState = (snapshot: ReactEditorStoreSnapshot): EditorState | null => snapshot.state
const selectSnapshot = (snapshot: ReactEditorStoreSnapshot): EditorViewSnapshot | null =>
  snapshot.snapshot
const selectTextSnapshot = (snapshot: ReactEditorStoreSnapshot): TextReadSnapshot | null =>
  snapshot.textSnapshot
const selectLastChange = (snapshot: ReactEditorStoreSnapshot): EditorContributionChange | null =>
  snapshot.lastChange
const selectUpdateKind = (
  snapshot: ReactEditorStoreSnapshot,
): EditorViewContributionUpdateKind | null => snapshot.updateKind

export function useEditor(options: ReactEditorOptions = {}): ReactEditorController {
  // Lazy state, not a lazily filled ref: render reads it, and refs are off-limits in render.
  const [held, setHeld] = useState(() => new ReactEditorControllerImplementation(options))
  const controller =
    held.constructor === ReactEditorControllerImplementation
      ? held
      : new ReactEditorControllerImplementation(options)
  if (controller !== held) setHeld(controller)

  controller.setOptions(options)
  useControlledOptionSync(controller, options)
  useEffect(() => {
    controller.retainReactOwner()
    return () => controller.scheduleReactDispose()
  }, [controller])

  return controller
}

export function EditorHost({ controller, className, style }: EditorHostProps): ReactElement {
  const hostRef = useRef<HTMLDivElement | null>(null)

  useEditorLayoutEffect(() => {
    const element = hostRef.current
    if (!element) return

    controller.mount(element)
    return () => internalController(controller).scheduleReactDispose()
  }, [controller])

  return <div ref={hostRef} className={className} style={style} />
}

export function useEditorSelector<T>(
  controller: ReactEditorController,
  selector: ReactEditorSelector<T>,
  isEqual: ReactEditorSelectorEquality<T> = Object.is,
): T {
  const store = internalController(controller).store
  // Lazy state, not a lazily filled ref: render reads it, and refs are off-limits in render.
  const [held, setHeld] = useState(() => ({
    store,
    subscription: store.createSubscription(selector, isEqual),
  }))
  const subscription =
    held.store === store ? held.subscription : store.createSubscription(selector, isEqual)
  if (subscription !== held.subscription) setHeld({ store, subscription })

  store.refreshSubscription(subscription, selector, isEqual)

  const subscribe = useCallback(
    (notify: () => void) => store.subscribe(subscription, notify),
    [store, subscription],
  )
  const getSnapshot = useCallback(() => subscription.value, [subscription])

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

class ReactEditorControllerImplementation implements ReactEditorController {
  public readonly [CONTROLLER_PRIVATE] = this
  public readonly store = new ReactEditorStore()
  public readonly commands: ReactEditorCommands
  private readonly reactSyncPlugin: EditorPlugin
  private readonly documentState = createDocumentState()
  private readonly optionSync: EditorOptionSync = createEditorOptionSync()
  private syncedPlugins: readonly EditorPlugin[] | null = null
  private syncedStoreSyncMode: ReactEditorStoreSyncMode | null = null
  private syncedSnapshotEligibility: ReactEditorSnapshotEligibility | null = null
  private requestedDocumentGeneration = 0
  private editorIncarnation = 0
  private mountedElement: HTMLElement | null = null
  private scheduledDisposeGeneration: number | null = null
  private nextDisposeGeneration = 0
  private suspendedStoreFields: ReactEditorStoreSnapshot | null = null
  private options: ReactEditorOptions

  public constructor(options: ReactEditorOptions) {
    this.options = options
    this.reactSyncPlugin = createReactSyncPlugin(this)
    this.commands = createCommands(() => this.getEditor(), this.documentState)
  }

  public mount(element: HTMLElement): void {
    this.retainReactOwner()
    if (this.mountedElement === element && this.getEditor()) return

    this.store.batch(() => {
      this.disposeImmediately()
      this.mountedElement = element
      this.mountEditor(element)
    })
  }

  public dispose(): void {
    this.retainReactOwner()
    this.disposeImmediately()
  }

  public retainReactOwner(): void {
    this.scheduledDisposeGeneration = null
    this.resumeSuspendedEditor()
  }

  public scheduleReactDispose(): void {
    if (this.scheduledDisposeGeneration !== null) return

    this.nextDisposeGeneration += 1
    const generation = this.nextDisposeGeneration
    this.scheduledDisposeGeneration = generation
    this.suspendEditor()
    // @justification Waits out React's synchronous StrictMode unmount and remount; the generation
    // guard drops the disposal when the component came straight back.
    queueMicrotask(() => {
      if (this.scheduledDisposeGeneration !== generation) return

      this.scheduledDisposeGeneration = null
      this.disposeImmediately()
    })
  }

  private disposeImmediately(): void {
    this.store.batch(() => {
      this.editorIncarnation += 1
      this.suspendedStoreFields?.editor?.dispose()
      this.suspendedStoreFields = null
      disposeEditor(this.store)
      this.mountedElement = null
      this.documentState.clear()
      this.optionSync.reset()
      this.clearSyncedPlugins()
      this.syncedSnapshotEligibility = null
    })
  }

  private suspendEditor(): void {
    const snapshot = this.store.read()
    if (!snapshot.editor) return

    this.suspendedStoreFields = snapshot
    this.store.update(createEmptyStoreSnapshot())
  }

  private resumeSuspendedEditor(): void {
    const suspended = this.suspendedStoreFields
    if (!suspended) return

    this.suspendedStoreFields = null
    this.store.update(suspended)
  }

  public setOptions(options: ReactEditorOptions): void {
    this.options = options
  }

  public getEditor(): Editor | null {
    return this.store.read().editor
  }

  public getState(): EditorState | null {
    return this.getEditor()?.getState() ?? null
  }

  public getSnapshot(): EditorViewSnapshot | null {
    return this.store.read().snapshot
  }

  public getTextSnapshot(): TextSnapshot | null {
    return this.getEditor()?.getTextSnapshot() ?? null
  }

  public materializeFullText(): string {
    return this.getEditor()?.materializeFullText() ?? ''
  }

  public getLastChange(): EditorContributionChange | null {
    return this.store.read().lastChange
  }

  public getUpdateKind(): EditorViewContributionUpdateKind | null {
    return this.store.read().updateKind
  }

  public readonly useEditorInstance = (): Editor | null => useEditorSelector(this, selectEditor)
  public readonly useState = (): EditorState | null => useEditorSelector(this, selectState)
  public readonly useSnapshot = (): EditorViewSnapshot | null =>
    useEditorSelector(this, selectSnapshot)
  public readonly useTextSnapshot = (): TextReadSnapshot | null =>
    useEditorSelector(this, selectTextSnapshot)
  public readonly useFullText = (): string => {
    // Per hook, so the string is retained by this subscriber alone and released on unmount.
    const [selectFullText] = useState(createFullTextSelector)
    return useEditorSelector(this, selectFullText)
  }
  public readonly useLastChange = (): EditorContributionChange | null =>
    useEditorSelector(this, selectLastChange)
  public readonly useUpdateKind = (): EditorViewContributionUpdateKind | null =>
    useEditorSelector(this, selectUpdateKind)

  public syncDocumentOption(): void {
    const editor = this.getEditor()
    if (!editor) return

    this.syncSnapshotEligibility(editor)
    this.syncAuthoritativeDocument(editor)
  }

  public syncConfigurationOptions(): void {
    this.applyControlledOptions(this.getEditor(), CONFIGURATION_OPTIONS)
  }

  public syncDocumentControls(): void {
    this.applyControlledOptions(this.getEditor(), DOCUMENT_OPTIONS)
  }

  public syncPluginsOption(): void {
    const editor = this.getEditor()
    if (!editor) return
    if (this.pluginsSynced(this.options)) return

    syncPlugins(editor, this.reactSyncPlugin, this.options)
    this.markPluginsSynced(this.options)
  }

  public syncSnapshot(
    snapshot: EditorViewSnapshot,
    kind: EditorViewContributionUpdateKind,
    change: EditorContributionChange | null,
  ): void {
    if (!this.shouldSyncStore()) return
    if (this.getEditor()?.getPresentationState() === 'provisional') return

    const patch = {
      snapshot,
      textSnapshot: snapshot.textSnapshot,
      lastChange: change,
      updateKind: kind,
      ...(kind === 'selection' ? { state: this.getEditor()?.getState() ?? null } : {}),
    } satisfies ReactEditorStorePatch

    this.store.update(patch)
  }

  public syncChange(state: EditorState, change: EditorContributionChange | null): void {
    if (!this.shouldSyncStore()) return

    this.store.update({
      state,
      textSnapshot: this.getEditor()?.getTextSnapshot() ?? null,
      lastChange: change,
    })
  }

  private mountEditor(element: HTMLElement): void {
    this.editorIncarnation += 1
    const editorIncarnation = this.editorIncarnation
    const instance = new Editor(element, this.createConstructorOptions(editorIncarnation))
    this.markPluginsSynced(this.options)
    this.syncedSnapshotEligibility = snapshotEligibility(this.options)

    this.store.update({
      editor: instance,
      state: instance.getState(),
      textSnapshot: instance.getTextSnapshot(),
    })
    if (instance.getPresentationState() === 'provisional') this.clearPresentedSnapshot()
    this.syncMountedOptions(instance)
  }

  private createConstructorOptions(editorIncarnation: number): EditorOptions {
    const {
      document: _document,
      hiddenCharacters,
      onChange: _onChange,
      onInitialPaint: _onInitialPaint,
      onPresentationChange: _onPresentationChange,
      plugins: _plugins,
      scrollPosition: _scrollPosition,
      selection: _selection,
      storeSync: _storeSync,
      theme,
      ...constructorOptions
    } = this.options

    return {
      ...constructorOptions,
      snapshot: snapshotEligibility(this.options).snapshot,
      hiddenCharacters,
      theme: theme ?? undefined,
      plugins: editorPluginsForOptions(this.reactSyncPlugin, this.options),
      onChange: (state, change) => {
        this.syncChange(state, change)
        this.options.onChange?.(state, change)
      },
      onInitialPaint: (event) => this.forwardInitialPaint(event, editorIncarnation),
      onPresentationChange: (state) => this.forwardPresentationChange(state, editorIncarnation),
    }
  }

  private forwardInitialPaint(event: EditorInitialPaintEvent, editorIncarnation: number): void {
    const documentGeneration = this.documentState.generation()
    const requestedDocumentKey = this.options.documentKey
    // @justification Defers delivery until the mount survives React's synchronous StrictMode
    // replay; the incarnation guard cancels disposed mounts, and no editor work is scheduled.
    queueMicrotask(() => {
      if (editorIncarnation !== this.editorIncarnation) return
      if (documentGeneration !== this.documentState.generation()) return
      if (requestedDocumentKey !== this.options.documentKey) return

      this.options.onInitialPaint?.(event)
    })
  }

  private syncMountedOptions(editor: Editor): void {
    this.syncAuthoritativeDocument(editor)
    this.applyControlledOptions(editor)
  }

  private syncAuthoritativeDocument(editor: Editor): void {
    const document = this.options.documentKey === null ? null : this.options.document
    syncDocument(editor, document, this.documentState)
  }

  private syncSnapshotEligibility(editor: Editor): void {
    const next = snapshotEligibility(this.options)
    const previous = this.syncedSnapshotEligibility
    if (previous?.documentKey === next.documentKey && previous.snapshot === next.snapshot) return

    if (previous && previous.documentKey !== next.documentKey) {
      this.requestedDocumentGeneration += 1
      editor.clearDocument()
      this.documentState.clear()
    }

    this.syncedSnapshotEligibility = next
    editor.setSnapshot(next.snapshot, next.documentKey)
  }

  private forwardPresentationChange(
    state: ReturnType<Editor['getPresentationState']>,
    editorIncarnation: number,
  ): void {
    if (state === 'provisional') this.clearPresentedSnapshot()
    const requestedDocumentKey = this.options.documentKey
    const requestedDocumentGeneration = this.requestedDocumentGeneration
    // @justification Defers the callback past StrictMode's synchronous replay; the incarnation,
    // document and state guards drop it when the editor moved on, and no editor work is scheduled.
    queueMicrotask(() => {
      if (editorIncarnation !== this.editorIncarnation) return
      if (requestedDocumentKey !== this.options.documentKey) return
      if (requestedDocumentGeneration !== this.requestedDocumentGeneration) return
      if (this.getEditor()?.getPresentationState() !== state) return

      this.options.onPresentationChange?.(state)
    })
  }

  private clearPresentedSnapshot(): void {
    this.store.update({ snapshot: null, updateKind: null })
  }

  private applyControlledOptions(
    editor: Editor | null,
    descriptors: readonly EditorOptionDescriptor[] = EDITOR_OPTION_DESCRIPTORS,
  ): void {
    for (const descriptor of descriptors) {
      this.optionSync.apply(editor, descriptor, this.options[descriptor.name])
    }
  }

  private shouldSyncStore(): boolean {
    return reactEditorStoreSyncMode(this.options) === 'full'
  }

  private pluginsSynced(options: ReactEditorOptions): boolean {
    if (this.syncedStoreSyncMode !== reactEditorStoreSyncMode(options)) return false
    return samePlugins(this.syncedPlugins, options.plugins ?? EMPTY_PLUGINS)
  }

  private markPluginsSynced(options: ReactEditorOptions): void {
    this.syncedPlugins = [...(options.plugins ?? EMPTY_PLUGINS)]
    this.syncedStoreSyncMode = reactEditorStoreSyncMode(options)
  }

  private clearSyncedPlugins(): void {
    this.syncedPlugins = null
    this.syncedStoreSyncMode = null
  }
}

class ReactEditorStore {
  private snapshot = createEmptyStoreSnapshot()
  private readonly subscriptions = new Set<ReactEditorSelectorSubscription<unknown>>()
  private version = 0
  private batchDepth = 0
  private notifyAfterBatch = false

  public read(): ReactEditorStoreSnapshot {
    return this.snapshot
  }

  public update(patch: ReactEditorStorePatch): void {
    if (!hasStorePatchChange(this.snapshot, patch)) return

    this.snapshot = mergeStorePatch(this.snapshot, patch)
    this.version += 1
    this.queueNotify()
  }

  public batch<T>(run: () => T): T {
    this.batchDepth += 1
    try {
      return run()
    } finally {
      this.batchDepth -= 1
      this.flushBatchedNotify()
    }
  }

  public createSubscription<T>(
    selector: ReactEditorSelector<T>,
    isEqual: ReactEditorSelectorEquality<T>,
  ): ReactEditorSelectorSubscription<T> {
    return {
      selector,
      isEqual,
      value: selector(this.snapshot),
      notify: null,
    }
  }

  public refreshSubscription<T>(
    subscription: ReactEditorSelectorSubscription<T>,
    selector: ReactEditorSelector<T>,
    isEqual: ReactEditorSelectorEquality<T>,
  ): void {
    subscription.selector = selector
    subscription.isEqual = isEqual
    this.refreshSubscriptionValue(subscription)
  }

  public subscribe<T>(
    subscription: ReactEditorSelectorSubscription<T>,
    notify: () => void,
  ): () => void {
    subscription.notify = notify
    this.refreshSubscriptionValue(subscription)
    this.subscriptions.add(subscription as ReactEditorSelectorSubscription<unknown>)

    return () => {
      this.subscriptions.delete(subscription as ReactEditorSelectorSubscription<unknown>)
      subscription.notify = null
    }
  }

  private notify(): void {
    for (const subscription of this.subscriptions) {
      this.notifySubscription(subscription)
    }
  }

  private queueNotify(): void {
    if (this.batchDepth === 0) {
      this.notify()
      return
    }

    this.notifyAfterBatch = true
  }

  private flushBatchedNotify(): void {
    if (this.batchDepth > 0) return
    if (!this.notifyAfterBatch) return

    this.notifyAfterBatch = false
    this.notify()
  }

  private notifySubscription<T>(subscription: ReactEditorSelectorSubscription<T>): void {
    const nextValue = subscription.selector(this.snapshot)
    if (subscription.isEqual(subscription.value, nextValue)) return

    subscription.value = nextValue
    subscription.notify?.()
  }

  private refreshSubscriptionValue<T>(subscription: ReactEditorSelectorSubscription<T>): void {
    const nextValue = subscription.selector(this.snapshot)
    if (subscription.isEqual(subscription.value, nextValue)) return

    subscription.value = nextValue
  }
}

function useControlledOptionSync(
  controller: ReactEditorControllerImplementation,
  options: ReactEditorOptions,
): void {
  const documentIdentity = documentKey(options.document)

  useEditorLayoutEffect(
    () => controller.syncPluginsOption(),
    [controller, options.plugins, options.storeSync],
  )
  // Admission reads current appearance; document offsets wait until after attachment.
  useEditorLayoutEffect(() => controller.syncConfigurationOptions())
  useEditorLayoutEffect(
    () => controller.syncDocumentOption(),
    [controller, documentIdentity, options.documentKey, options.snapshot],
  )
  // Runs on every render because the descriptors, not a dependency list, decide what moved.
  useEditorLayoutEffect(() => controller.syncDocumentControls())
}

function snapshotEligibility(options: ReactEditorOptions): ReactEditorSnapshotEligibility {
  return {
    documentKey: options.documentKey ?? null,
    snapshot: options.documentKey === null ? null : (options.snapshot ?? null),
  }
}

function createReactSyncPlugin(controller: ReactEditorControllerImplementation): EditorPlugin {
  return {
    name: 'react-editor-sync',
    activate: (context) =>
      context.registerViewContribution({
        createContribution: () => ({
          update: (snapshot, kind, change) =>
            controller.syncSnapshot(snapshot, kind, change ?? null),
          dispose: () => undefined,
        }),
      }),
  }
}

function syncDocument(
  editor: Editor | null,
  document: ReactEditorDocument | null | undefined,
  state: ReactEditorDocumentState,
): void {
  if (!editor) return

  const key = documentKey(document)
  if (key === state.key()) return
  const identityKey = documentIdentityKey(document)
  const previousIdentityKey = state.identityKey()

  state.setKey(key, identityKey)
  if (!document) {
    editor.clearDocument()
    return
  }

  const session = reactEditorDocumentSession(document)
  if (session) {
    editor.attachSession(session, {
      analysis: document.analysis,
      documentId: document.documentId,
      documentConfigurationTag: document.documentConfigurationTag,
      highlighterConfigurationTag: document.highlighterConfigurationTag,
      languageId: document.languageId,
      preparedDocument: document.preparedDocument,
      scrollPosition: reactEditorDocumentScrollPosition(document),
      structuralConfigurationTag: document.structuralConfigurationTag,
    })
    return
  }

  if (canSyncDocumentTextIncrementally(document, previousIdentityKey, identityKey)) {
    editor.syncText(document.text, {
      documentMode: document.documentMode,
      languageId: document.languageId,
      scrollPosition: reactEditorDocumentScrollPosition(document),
    })
    return
  }

  editor.openDocument({
    documentId: document.documentId,
    documentMode: document.documentMode,
    languageId: document.languageId,
    scrollPosition: reactEditorDocumentScrollPosition(document),
    text: document.text,
  })
}

function canSyncDocumentTextIncrementally(
  document: ReactEditorDocument,
  previousIdentityKey: ReactEditorDocumentKey,
  identityKey: ReactEditorDocumentKey,
): boolean {
  if (document.textSyncMode !== 'incremental') return false
  if (previousIdentityKey === NO_DOCUMENT) return false

  return previousIdentityKey === identityKey
}

function syncPlugins(
  editor: Editor | null,
  reactSyncPlugin: EditorPlugin,
  options: ReactEditorOptions,
): void {
  if (!editor) return

  editor.setPlugins(editorPluginsForOptions(reactSyncPlugin, options))
}

function editorPluginsForOptions(
  reactSyncPlugin: EditorPlugin,
  options: ReactEditorOptions,
): readonly EditorPlugin[] {
  if (reactEditorStoreSyncMode(options) === 'none') return options.plugins ?? []

  return [reactSyncPlugin, ...(options.plugins ?? [])]
}

function reactEditorStoreSyncMode(options: ReactEditorOptions): ReactEditorStoreSyncMode {
  return options.storeSync ?? 'full'
}

function samePlugins(
  left: readonly EditorPlugin[] | null,
  right: readonly EditorPlugin[],
): boolean {
  if (!left) return false
  if (left.length !== right.length) return false

  return left.every((plugin, index) => plugin === right[index])
}

function disposeEditor(store: ReactEditorStore): void {
  const editor = store.read().editor
  editor?.dispose()
  store.update(createEmptyStoreSnapshot())
}

function createCommands(
  editor: () => Editor | null,
  documentState: ReactEditorDocumentState,
): ReactEditorCommands {
  return {
    focus: () => editor()?.focus(),
    openDocument: (document) => {
      documentState.setKey(documentKey(document), documentIdentityKey(document))
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

function createDocumentState(): ReactEditorDocumentState {
  let generation = 0
  let key: ReactEditorDocumentKey = NO_DOCUMENT
  let identityKey: ReactEditorDocumentKey = NO_DOCUMENT

  return {
    generation: () => generation,
    key: () => key,
    identityKey: () => identityKey,
    setKey: (nextKey, nextIdentityKey = nextKey) => {
      generation += 1
      key = nextKey
      identityKey = nextIdentityKey
    },
    clear: () => {
      generation += 1
      key = NO_DOCUMENT
      identityKey = NO_DOCUMENT
    },
  }
}

function documentKey(
  document:
    | (Readonly<{
        readonly analysis?: EditorDocumentAnalysis | null
        readonly buffer?: EditorTextBuffer | null
        readonly documentId?: string
        readonly documentMode?: EditorDocumentMode
        readonly documentConfigurationTag?: readonly EditorPreparedTagValue[]
        readonly highlighterConfigurationTag?: readonly EditorPreparedTagValue[]
        readonly languageId?: EditorSyntaxLanguageId | null
        readonly preparedDocument?: EditorPreparedDocument | null
        readonly revision?: string | number
        readonly session?: DocumentSession | null
        readonly text?: string
        readonly textSyncMode?: ReactEditorDocumentTextSyncMode
        readonly structuralConfigurationTag?: readonly EditorPreparedTagValue[]
        readonly view?: EditorViewSession | null
      }> &
        object)
    | null
    | undefined,
): ReactEditorDocumentKey {
  if (!document) return NO_DOCUMENT

  const incremental = document.textSyncMode === 'incremental'
  const liveSession = documentHasLiveBuffer(document) || documentHasLiveSession(document)
  const revision = documentRevisionKey(document, incremental)
  const textVersion = incremental && !liveSession ? (document.text ?? '') : ''
  const identityKey = documentIdentityKey(document)
  if (identityKey === NO_DOCUMENT) return NO_DOCUMENT

  return `${identityKey}\u0000${revision}\u0000${textVersion}\u0000${preparedDocumentIdentity(
    document.preparedDocument,
  )}\u0000${analysisIdentity(document.analysis ?? document.preparedDocument?.analysis)}\u0000${preparedTagsKey(document)}`
}

function documentRevisionKey(
  document: Readonly<{
    readonly buffer?: EditorTextBuffer | null
    readonly revision?: string | number
    readonly session?: DocumentSession | null
    readonly view?: EditorViewSession | null
  }> &
    object,
  incremental: boolean,
) {
  if (documentHasLiveBuffer(document)) return ''
  if (incremental) return ''
  if (documentHasLiveSession(document)) return ''

  return document.revision ?? ''
}

function documentIdentityKey(
  document:
    | (Readonly<{
        readonly buffer?: EditorTextBuffer | null
        readonly documentId?: string
        readonly documentMode?: EditorDocumentMode
        readonly languageId?: EditorSyntaxLanguageId | null
        readonly session?: DocumentSession | null
        readonly view?: EditorViewSession | null
      }> &
        object)
    | null
    | undefined,
): ReactEditorDocumentKey {
  if (!document) return NO_DOCUMENT

  const session = 'session' in document ? document.session : null
  const buffer = 'buffer' in document ? document.buffer : null
  const view = 'view' in document ? document.view : null
  return `${document.documentId ?? ''}\u0000${document.documentMode ?? ''}\u0000${
    document.languageId ?? ''
  }\u0000${sessionIdentity(session)}\u0000${bufferViewIdentity(buffer, view)}`
}

const sessionKeys = new WeakMap<DocumentSession, number>()
const preparedDocumentKeys = new WeakMap<EditorPreparedDocument, number>()
const analysisKeys = new WeakMap<EditorDocumentAnalysis, number>()
const bufferKeys = new WeakMap<EditorTextBuffer, number>()
const viewKeys = new WeakMap<EditorViewSession, number>()
const bufferViewSessions = new WeakMap<
  EditorTextBuffer,
  WeakMap<EditorViewSession, EditorBufferSession>
>()
let nextSessionKey = 1
let nextPreparedDocumentKey = 1
let nextAnalysisKey = 1
let nextBufferKey = 1
let nextViewKey = 1

function sessionIdentity(session: DocumentSession | null | undefined): string {
  if (!session) return ''

  const existing = sessionKeys.get(session)
  if (existing !== undefined) return `${existing}`

  const key = nextSessionKey
  nextSessionKey += 1
  sessionKeys.set(session, key)
  return `${key}`
}

function preparedDocumentIdentity(
  preparedDocument: EditorPreparedDocument | null | undefined,
): string {
  if (!preparedDocument) return ''

  const existing = preparedDocumentKeys.get(preparedDocument)
  if (existing !== undefined) return `${existing}`

  const key = nextPreparedDocumentKey
  nextPreparedDocumentKey += 1
  preparedDocumentKeys.set(preparedDocument, key)
  return `${key}`
}

function analysisIdentity(analysis: EditorDocumentAnalysis | null | undefined): string {
  if (!analysis) return ''
  const existing = analysisKeys.get(analysis)
  if (existing !== undefined) return `${existing}`
  const key = nextAnalysisKey++
  analysisKeys.set(analysis, key)
  return `${key}`
}

function preparedTagsKey(document: {
  readonly documentConfigurationTag?: readonly EditorPreparedTagValue[]
  readonly structuralConfigurationTag?: readonly EditorPreparedTagValue[]
}): string {
  // Highlighter tags validate a prepared result at attachment; changing colors is not a new document.
  return JSON.stringify([
    document.documentConfigurationTag ?? [],
    document.structuralConfigurationTag ?? [],
  ])
}

function bufferViewIdentity(
  buffer: EditorTextBuffer | null | undefined,
  view: EditorViewSession | null | undefined,
): string {
  if (!buffer || !view) return ''

  return `${bufferIdentity(buffer)}:${viewIdentity(view)}`
}

function bufferIdentity(buffer: EditorTextBuffer): string {
  const existing = bufferKeys.get(buffer)
  if (existing !== undefined) return `${existing}`

  const key = nextBufferKey
  nextBufferKey += 1
  bufferKeys.set(buffer, key)
  return `${key}`
}

function viewIdentity(view: EditorViewSession): string {
  const existing = viewKeys.get(view)
  if (existing !== undefined) return `${existing}`

  const key = nextViewKey
  nextViewKey += 1
  viewKeys.set(view, key)
  return `${key}`
}

function documentHasLiveSession(
  document: Readonly<{ readonly session?: DocumentSession | null }> & object,
): boolean {
  return 'session' in document && document.session !== null && document.session !== undefined
}

function documentHasLiveBuffer(
  document: Readonly<{
    readonly buffer?: EditorTextBuffer | null
    readonly view?: EditorViewSession | null
  }> &
    object,
): boolean {
  return (
    'buffer' in document &&
    'view' in document &&
    document.buffer !== null &&
    document.buffer !== undefined &&
    document.view !== null &&
    document.view !== undefined
  )
}

function reactEditorDocumentSession(
  document: ReactEditorDocument,
): DocumentSession | EditorBufferSession | null {
  if (document.buffer && document.view) {
    return bufferViewSession(document.buffer, document.view)
  }

  return document.session ?? null
}

function reactEditorDocumentScrollPosition(
  document: ReactEditorDocument,
): EditorScrollPosition | undefined {
  return document.scrollPosition ?? document.view?.getScrollPosition()
}

function bufferViewSession(buffer: EditorTextBuffer, view: EditorViewSession): EditorBufferSession {
  const existingViews = bufferViewSessions.get(buffer)
  const existing = existingViews?.get(view)
  if (existing) return existing

  const session = createEditorBufferSession(buffer, view)
  if (existingViews) {
    existingViews.set(view, session)
    return session
  }

  const views = new WeakMap<EditorViewSession, EditorBufferSession>()
  views.set(view, session)
  bufferViewSessions.set(buffer, views)
  return session
}

function createEmptyStoreSnapshot(): ReactEditorStoreSnapshot {
  return {
    editor: null,
    state: null,
    snapshot: null,
    textSnapshot: null,
    lastChange: null,
    updateKind: null,
  }
}

/** Reads the captured revision whole, once per revision, keeping only the latest pair. */
function createFullTextSelector(): ReactEditorSelector<string> {
  let source: TextReadSnapshot | null = null
  let text = ''
  return (snapshot) => {
    if (snapshot.textSnapshot === source) return text

    source = snapshot.textSnapshot
    text = source ? source.readRange(0, source.length) : ''
    return text
  }
}

function mergeStorePatch(
  snapshot: ReactEditorStoreSnapshot,
  patch: ReactEditorStorePatch,
): ReactEditorStoreSnapshot {
  return {
    editor: patchValue(snapshot, patch, 'editor'),
    state: patchValue(snapshot, patch, 'state'),
    snapshot: patchValue(snapshot, patch, 'snapshot'),
    textSnapshot: patchValue(snapshot, patch, 'textSnapshot'),
    lastChange: patchValue(snapshot, patch, 'lastChange'),
    updateKind: patchValue(snapshot, patch, 'updateKind'),
  }
}

function patchValue<K extends keyof ReactEditorStoreSnapshot>(
  snapshot: ReactEditorStoreSnapshot,
  patch: ReactEditorStorePatch,
  key: K,
): ReactEditorStoreSnapshot[K] {
  if (Object.prototype.hasOwnProperty.call(patch, key)) {
    return patch[key] as ReactEditorStoreSnapshot[K]
  }
  return snapshot[key]
}

function hasStorePatchChange(
  snapshot: ReactEditorStoreSnapshot,
  patch: ReactEditorStorePatch,
): boolean {
  for (const key of Object.keys(patch) as (keyof ReactEditorStoreSnapshot)[]) {
    if (!Object.is(snapshot[key], patch[key])) return true
  }

  return false
}

function internalController(
  controller: ReactEditorController,
): ReactEditorControllerImplementation {
  return (controller as ReactEditorControllerPrivate)[CONTROLLER_PRIVATE]
}
