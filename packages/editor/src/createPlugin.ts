import {
  isEditorCommandId,
  type EditorAnyCommandId,
  type EditorContributedCommandDeclaration,
} from './editor/commandCatalog'
import type { Editor } from './editor/Editor'
import { EditorDisposableStore } from './editor/disposables'
import { createError } from './logging/evlog'
import type {
  EditorCommandHandler,
  EditorDisposable,
  EditorInternalPluginContext,
  EditorInternalViewContributionContext,
  EditorPlugin,
  EditorResolvedSelection,
  EditorSelectionRange,
  EditorViewContribution,
  EditorViewContributionContext,
  EditorViewContributionInput,
  EditorViewContributionUpdateKind,
  EditorViewportSnapshot,
  EditorViewSnapshot,
  EditorVisibleRowSnapshot,
} from './plugins'
import type { EditorTheme } from './theme'
import type { EditorTokenStore } from './syntax/tokenStore'
import type { TextReadSnapshot } from './documentTextSnapshot'
import type { TextEdit } from './tokens'

/**
 * A value the editor publishes, read from a view snapshot. `kinds` are the update kinds that can
 * change it: a scope watching it is updated for those and nothing else.
 */
export type EditorInput<T> = {
  readonly id: string
  readonly kinds: readonly EditorViewContributionInput[]
  /** `editor` identifies the editor asking, for values kept per editor (channels). */
  read(snapshot: EditorViewSnapshot, editor: object): T
  // A method, so an input of a narrower value still counts as an input of `unknown` among sources.
  equals?(left: T, right: T): boolean
  /** Set on a derived input: recomputed only when one of these changed. */
  readonly sources?: readonly EditorInput<unknown>[]
  /** Set on inputs that change outside any view pass (state, channels). */
  subscribe?(listener: () => void, editor: object): EditorDisposable
}

export const selectionInput: EditorInput<readonly EditorResolvedSelection[]> = {
  id: 'selection',
  kinds: ['selection', 'content'],
  read: (snapshot) => snapshot.selections,
  equals: sameSelections,
}

export const textInput: EditorInput<TextReadSnapshot> = {
  id: 'text',
  kinds: ['content'],
  read: (snapshot) => snapshot.textSnapshot,
}

export const visibleRowsInput: EditorInput<readonly EditorVisibleRowSnapshot[]> = {
  id: 'visibleRows',
  kinds: ['content', 'tokens', 'viewport', 'layout'],
  read: (snapshot) => snapshot.visibleRows,
}

export const viewportInput: EditorInput<EditorViewportSnapshot> = {
  id: 'viewport',
  kinds: ['viewport', 'layout'],
  read: (snapshot) => snapshot.viewport,
}

export const tokensInput: EditorInput<EditorTokenStore> = {
  id: 'tokens',
  kinds: ['tokens'],
  read: (snapshot) => snapshot.tokens,
}

export const themeInput: EditorInput<EditorTheme | null> = {
  id: 'theme',
  kinds: ['tokens'],
  read: (snapshot) => snapshot.theme ?? null,
}

/** The open document's id. It changes only with a document, which reaches every scope. */
export const documentInput: EditorInput<string | null> = {
  id: 'document',
  kinds: [],
  read: (snapshot) => snapshot.documentId,
}

/** A value computed from other inputs, recomputed when one of them changes and quiet while `equals` holds. */
export function derive<const Sources extends readonly EditorInput<unknown>[], T>(
  sources: Sources,
  compute: (...values: { [Index in keyof Sources]: InputValue<Sources[Index]> }) => T,
  equals?: (left: T, right: T) => boolean,
): EditorInput<T> {
  const kinds = new Set<EditorViewContributionInput>()
  for (const source of sources) for (const kind of source.kinds) kinds.add(kind)
  return {
    id: `derive(${sources.map((source) => source.id).join(',')})`,
    kinds: [...kinds],
    read: (snapshot, editor) =>
      compute(...(sources.map((source) => source.read(snapshot, editor)) as InputValues<Sources>)),
    equals,
    sources,
    subscribe: sources.some((source) => source.subscribe)
      ? (listener, editor) => {
          const subscriptions = sources.map((source) => source.subscribe?.(listener, editor))
          return { dispose: () => subscriptions.forEach((subscription) => subscription?.dispose()) }
        }
      : undefined,
  }
}

type InputValue<Input> = Input extends EditorInput<infer T> ? T : never
type InputValues<Sources extends readonly EditorInput<unknown>[]> = {
  [Index in keyof Sources]: InputValue<Sources[Index]>
}

export type EditorViewState<T> = {
  get(): T
  set(value: T): void
  readonly input: EditorInput<T>
}

/**
 * Everything one plugin does in one editor view. What it registers here is owned by the scope and
 * released with the view or the plugin.
 */
export type EditorViewScope = {
  /** The live editor. Unstable: calling setPlugins, dispose or openDocument from a listener is unsupported. */
  readonly editor: Editor
  /** The view's DOM, geometry and highlight surface, for what the scope does not wrap. */
  readonly view: EditorViewContributionContext
  read<T>(input: EditorInput<T>): T
  /** Calls `listener` now and whenever the value changes; returns what stops it. */
  watch<T>(
    input: EditorInput<T>,
    listener: (value: T, snapshot: EditorViewSnapshot) => void,
  ): EditorDisposable
  state<T>(initial: T): EditorViewState<T>
  /** Adds a value to a channel in this editor, for as long as the scope lives. */
  provide<T>(channel: EditorChannel<T, unknown>, value: T | EditorInput<T>): void
  /** Runs a built-in command's handler for this view, or one of the plugin's own commands. */
  handle(
    command: EditorAnyCommandId | EditorContributedCommandDeclaration,
    run: EditorCommandHandler,
  ): void
  getSelections(): readonly EditorResolvedSelection[]
  applyEdits(edits: readonly TextEdit[], selection?: EditorSelectionRange): void
  onDispose(cleanup: () => void): void
  own(disposable: EditorDisposable): void
}

export type EditorPluginDefinition = {
  /** Identity for dedup and the namespace a plugin's commands will live under. */
  readonly name: string
  /**
   * Plugins this one builds on. Each is installed once per editor however many plugins use it,
   * stays while any does, and is set up before the plugin that uses it.
   */
  readonly uses?: readonly EditorPlugin[]
  /** The plugin's own commands; each id starts with the plugin's name and a dot. */
  readonly commands?: readonly EditorContributedCommandDeclaration[]
  /** Once per editor view the plugin is installed in. */
  view?(scope: EditorViewScope): void
}

/** The one way to author a plugin; experimental. It lowers onto `EditorPlugin`. */
export function createPlugin(definition: EditorPluginDefinition): EditorPlugin {
  for (const command of definition.commands ?? []) assertOwnCommand(definition.name, command.id)
  return {
    name: definition.name,
    commands: definition.commands,
    activate(context) {
      const internal = context as EditorInternalPluginContext
      const registrations = (definition.uses ?? []).map((used) => internal.usePlugin(used))
      const view = definition.view
      if (!view) return registrations
      registrations.push(
        context.registerViewContribution({
          createContribution: (viewContext) =>
            createScopeContribution(viewContext as EditorInternalViewContributionContext, view),
        }),
      )
      return registrations
    },
  }
}

// A contributed id lives under its plugin's name, so two plugins cannot claim one id, and a
// built-in id is never contributed.
function assertOwnCommand(plugin: string, command: string): void {
  if (command.startsWith(`${plugin}.`) && !isEditorCommandId(command)) return
  throw createError({
    code: 'EDITOR_PLUGIN_COMMAND_NAMESPACE',
    message: `Plugin ${plugin} declares command ${command} outside its namespace`,
    why: 'A contributed command id starts with its plugin name and a dot, and never names a built-in command.',
    fix: `Rename the command to ${plugin}.<name>.`,
    internal: { plugin, command },
  })
}

/**
 * How a channel turns the values its providers gave into the one value its readers see: `one`
 * takes a single provider, `many` keeps them all in order, a combine function folds them.
 */
export type EditorChannelPolicy<T, Value> =
  | { readonly kind: 'one' }
  | { readonly kind: 'many' }
  | { readonly kind: 'combine'; readonly combine: (values: readonly T[]) => Value }

/** An extension point any library can define; others provide to it and watch its value. */
export type EditorChannel<T, Value> = {
  readonly id: string
  readonly policy: EditorChannelPolicy<T, Value>
  /** The channel's value in the editor that reads it. */
  readonly input: EditorInput<Value>
}

export function createChannel<T>(
  id: string,
  policy: { readonly kind: 'one' },
): EditorChannel<T, T | null>
export function createChannel<T>(
  id: string,
  policy: { readonly kind: 'many' },
): EditorChannel<T, readonly T[]>
export function createChannel<T, Value>(
  id: string,
  policy: { readonly kind: 'combine'; readonly combine: (values: readonly T[]) => Value },
): EditorChannel<T, Value>
export function createChannel<T, Value>(
  id: string,
  policy: EditorChannelPolicy<T, Value>,
): EditorChannel<T, Value> {
  const channel: EditorChannel<T, Value> = {
    id,
    policy,
    input: {
      id: `channel(${id})`,
      kinds: [],
      read: (_snapshot, editor) => channelValue(channel, editor),
      subscribe: (listener, editor) => channelEntries(channel, editor).subscribe(listener),
    },
  }
  return channel
}

type ChannelEntries = {
  readonly values: { current: unknown }[]
  subscribe(listener: () => void): EditorDisposable
  changed(): void
}

// Channel values are per editor: two editors with the same plugin never see each other's values.
const channelsByEditor = new WeakMap<object, Map<string, ChannelEntries>>()

type ChannelIdentity = { readonly id: string; readonly policy: { readonly kind: string } }

function channelEntries(channel: ChannelIdentity, editor: object): ChannelEntries {
  const channels = channelsByEditor.get(editor) ?? new Map<string, ChannelEntries>()
  channelsByEditor.set(editor, channels)
  const existing = channels.get(channel.id)
  if (existing) return existing

  const listeners = new Set<() => void>()
  const entries: ChannelEntries = {
    values: [],
    subscribe: (listener) => {
      listeners.add(listener)
      return { dispose: () => void listeners.delete(listener) }
    },
    changed: () => {
      for (const listener of [...listeners]) listener()
    },
  }
  channels.set(channel.id, entries)
  return entries
}

function channelValue<T, Value>(channel: EditorChannel<T, Value>, editor: object): Value {
  const values = channelEntries(channel, editor).values.map((entry) => entry.current as T)
  const policy = channel.policy
  if (policy.kind === 'combine') return policy.combine(values)
  if (policy.kind === 'many') return values as Value
  return (values[0] ?? null) as Value
}

function provideToChannel(
  channel: ChannelIdentity,
  editor: object,
  value: unknown,
): { set(value: unknown): void; dispose(): void } {
  const entries = channelEntries(channel, editor)
  if (channel.policy.kind === 'one' && entries.values.length > 0) {
    throw createError({
      code: 'EDITOR_CHANNEL_ALREADY_PROVIDED',
      message: `Editor channel ${channel.id} takes one provider and already has one`,
      why: 'A channel with the one policy stands for a single owner in each editor.',
      fix: 'Give the channel the many or combine policy, or provide it from one plugin only.',
      internal: { channel: channel.id },
    })
  }
  const entry = { current: value }
  entries.values.push(entry)
  entries.changed()
  return {
    set: (next) => {
      if (Object.is(next, entry.current)) return
      entry.current = next
      entries.changed()
    },
    dispose: () => {
      const index = entries.values.indexOf(entry)
      if (index === -1) return
      entries.values.splice(index, 1)
      entries.changed()
    },
  }
}

type Watcher = {
  readonly input: EditorInput<unknown>
  readonly listener: (value: unknown, snapshot: EditorViewSnapshot) => void
  sources: readonly unknown[] | null
  value: { readonly current: unknown } | null
}

function createScopeContribution(
  context: EditorInternalViewContributionContext,
  setup: (scope: EditorViewScope) => void,
): EditorViewContribution {
  const owned = new EditorDisposableStore()
  const watchers = new Set<Watcher>()
  let settingUp = true

  const editor = context.unstableEditor as object
  const deliver = (watcher: Watcher, snapshot: EditorViewSnapshot, force: boolean) => {
    const sources = watcher.input.sources?.map((source) => source.read(snapshot, editor)) ?? null
    if (!force && sources && watcher.sources && sameValues(watcher.input, sources, watcher.sources))
      return
    watcher.sources = sources
    const next = watcher.input.read(snapshot, editor)
    const previous = watcher.value
    if (!force && previous && sameValue(watcher.input, previous.current, next)) return
    watcher.value = { current: next }
    watcher.listener(next, snapshot)
  }

  const scope: EditorViewScope = {
    editor: context.unstableEditor as Editor,
    view: context,
    read: (input) => input.read(context.getSnapshot(), editor),
    watch: (input, listener) => {
      const watcher: Watcher = {
        input: input as EditorInput<unknown>,
        listener: listener as Watcher['listener'],
        sources: null,
        value: null,
      }
      const local = input.subscribe?.(() => deliver(watcher, context.getSnapshot(), false), editor)
      watchers.add(watcher)
      if (!settingUp) context.refreshInputs()
      deliver(watcher, context.getSnapshot(), true)
      const registration = owned.add({
        dispose: () => {
          local?.dispose()
          watchers.delete(watcher)
          owned.delete(registration)
        },
      })
      return registration
    },
    state: (initial) => createState(initial),
    provide: (channel, value) => {
      const input = isInput(value) ? value : null
      const provided = provideToChannel(
        channel,
        editor,
        input ? input.read(context.getSnapshot(), editor) : value,
      )
      owned.add(provided)
      if (input) scope.watch(input, (next) => provided.set(next))
    },
    handle: (command, run) =>
      void owned.add(
        context.registerCommand(typeof command === 'string' ? command : command.id, run),
      ),
    getSelections: () => context.getSelections(),
    applyEdits: (edits, selection) =>
      context.applyEdits(edits, 'editor.plugin.applyEdits', selection),
    onDispose: (cleanup) => void owned.add({ dispose: cleanup }),
    own: (disposable) => void owned.add(disposable),
  }

  try {
    setup(scope)
  } catch (error) {
    owned.dispose()
    throw error
  } finally {
    settingUp = false
  }

  return {
    get inputs() {
      const kinds = new Set<EditorViewContributionInput>()
      for (const watcher of watchers) for (const kind of watcher.input.kinds) kinds.add(kind)
      return [...kinds]
    },
    update(snapshot: EditorViewSnapshot, kind: EditorViewContributionUpdateKind) {
      const every = kind === 'document' || kind === 'clear'
      for (const watcher of [...watchers]) {
        if (!every && !watcher.input.kinds.includes(kind)) continue
        deliver(watcher, snapshot, false)
      }
    },
    dispose: () => owned.dispose(),
  }
}

function isInput(value: unknown): value is EditorInput<unknown> {
  if (typeof value !== 'object' || value === null) return false
  return (
    'kinds' in value &&
    'read' in value &&
    typeof (value as EditorInput<unknown>).read === 'function'
  )
}

function createState<T>(initial: T): EditorViewState<T> {
  let current = initial
  const listeners = new Set<() => void>()
  return {
    get: () => current,
    set: (value) => {
      if (Object.is(value, current)) return
      current = value
      for (const listener of [...listeners]) listener()
    },
    input: {
      id: 'state',
      kinds: [],
      read: () => current,
      subscribe: (listener) => {
        listeners.add(listener)
        return { dispose: () => void listeners.delete(listener) }
      },
    },
  }
}

function sameValue(input: EditorInput<unknown>, left: unknown, right: unknown): boolean {
  return input.equals ? input.equals(left, right) : Object.is(left, right)
}

function sameValues(
  input: EditorInput<unknown>,
  next: readonly unknown[],
  previous: readonly unknown[],
): boolean {
  const sources = input.sources ?? []
  return next.every((value, index) => sameValue(sources[index]!, value, previous[index]))
}

function sameSelections(
  left: readonly EditorResolvedSelection[],
  right: readonly EditorResolvedSelection[],
): boolean {
  if (left === right) return true
  if (left.length !== right.length) return false
  return left.every((selection, index) => {
    const other = right[index]!
    return (
      selection.anchorOffset === other.anchorOffset &&
      selection.headOffset === other.headOffset &&
      selection.affinity === other.affinity
    )
  })
}
