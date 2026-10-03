import { createChordRuntime } from '../chords/runtime'
import { detectPlatform } from '../platform'
import { createKeyContext, parseKeyContext } from '../context/key-context'
import { compileKeymap, resolveKeymapNode } from './keymap'
import type { KeyInput } from '../key-input'
import type { KeyContext, KeyContextInit } from '../context/key-context'
import type { KeyEffects } from '../chords/runtime'
import type {
  ChordOutcome,
  KeymapBinding,
  KeymapPlatform,
  KeymapSequenceEvent,
  PendingChordLabel,
} from '../chords/types'
import type { CompiledBinding, KeymapEntry } from './keymap'

export type CommandEvent<Source> = {
  readonly command: string
  readonly args: unknown
  /** The node that handles the command; the focused node or one of its ancestors. */
  readonly node: FocusNode<Source>
  /** The key that triggered the command, or null for {@link Dispatcher.dispatchCommand}. */
  readonly input: KeyInput | null
  readonly source: Source | null
}
/** Returns false to decline, passing the command to the next ancestor and then the next binding. */
export type CommandHandler<Source> = (event: CommandEvent<Source>) => boolean | void

export type FocusNodeContext = KeyContext | KeyContextInit | string
export type FocusNodeOptions<Source> = {
  readonly parent?: FocusNode<Source> | null
  readonly context?: FocusNodeContext
  /** Samples live context for each capture, overriding the static context. */
  readonly readContext?: () => FocusNodeContext
  readonly commands?: Readonly<Record<string, CommandHandler<Source>>>
}
/** A place focus can be. Its context joins the stack while focus is on it or inside it. */
export type FocusNode<Source> = {
  readonly id: number
  readonly parent: FocusNode<Source> | null
  readonly context: () => KeyContext
  readonly setContext: (context: FocusNodeContext) => void
  /** Adds a handler; returns its removal. */
  readonly handle: (command: string, handler: CommandHandler<Source>) => () => void
  readonly focus: () => void
  /** Detaches the node; focus inside it moves to its parent. */
  readonly remove: () => void
}

export type DispatcherOptions<Source> = {
  readonly keymap?: readonly KeymapEntry[]
  readonly platform?: KeymapPlatform
  readonly effects?: KeyEffects<Source>
  readonly replay?: (input: KeyInput, source: Source) => void
  readonly acceptsTextInput?: (source: Source) => boolean
  /**
   * Filters bindings for this key before resolution, so an unavailable chord neither pends nor
   * swallows its prefix.
   */
  readonly isAvailable?: (binding: CompiledBinding, source: Source) => boolean
  /**
   * Focus the host tracks beside the focused node (the DOM's active element). A pending chord
   * ends when either changes.
   */
  readonly currentFocus?: () => unknown
  readonly timeoutMs?: number
  readonly onPendingChange?: (pending: PendingChordLabel | null) => void
  readonly onSequence?: (event: KeymapSequenceEvent<CompiledBinding>) => void
  readonly onCaptureChange?: () => void
}
export type Dispatcher<Source> = {
  readonly createNode: (options?: FocusNodeOptions<Source>) => FocusNode<Source>
  readonly focus: (node: FocusNode<Source> | null) => void
  readonly focused: () => FocusNode<Source> | null
  /** Contexts from the outermost node to the focused one. */
  readonly contextStack: () => readonly KeyContext[]
  readonly setKeymap: (entries: readonly KeymapEntry[]) => void
  /** Offers a key; true means a binding took it. False leaves it to default input handling. */
  readonly handleKey: (input: KeyInput, source: Source, inScope?: boolean) => boolean
  /** Runs a command along the focus path without a key. */
  readonly dispatchCommand: (command: string, args?: unknown) => boolean
  readonly pending: () => PendingChordLabel | null
  readonly wantsCapture: () => boolean
  readonly capturesKey: (input: KeyInput) => boolean
  readonly releaseAll: () => void
  readonly cancel: (outcome?: ChordOutcome) => void
  readonly dispose: () => void
}

type NodeState<Source> = {
  node: FocusNode<Source>
  context: KeyContext
  handlers: Map<string, Set<CommandHandler<Source>>>
  removed: boolean
}
type Captured<Source> = {
  readonly path: readonly NodeState<Source>[]
  readonly stack: readonly KeyContext[]
}

const NO_EFFECTS: KeyEffects<unknown> = {
  preventDefault: () => {},
  stopPropagation: () => {},
  swallow: () => {},
}

/**
 * A focus tree over one keymap. Keys resolve against the focus path's contexts the way Zed does:
 * deepest context first, then source, then table order; a declined command falls through.
 */
export function createDispatcher<Source = unknown>(
  options: DispatcherOptions<Source> = {},
): Dispatcher<Source> {
  const platform = options.platform ?? detectPlatform()
  const states = new Map<FocusNode<Source>, NodeState<Source>>()
  let focusedNode: FocusNode<Source> | null = null
  let nextId = 1
  let keymap = compileKeymap(options.keymap ?? [], platform)
  const { isAvailable } = options

  const runtime = createChordRuntime<CompiledBinding, Captured<Source>, Source>({
    bindings: keymap.bindings,
    platform,
    effects: options.effects ?? (NO_EFFECTS as KeyEffects<Source>),
    captureContext: capture,
    select: (node, captured, source) =>
      resolveKeymapNode(
        node,
        captured.stack,
        isAvailable && ((binding) => isAvailable(binding, source)),
      ),
    dispatch: (binding, captured, source) => runBinding(binding, captured, source),
    currentFocus,
    ...(options.replay && { replay: options.replay }),
    ...(options.acceptsTextInput && { acceptsTextInput: options.acceptsTextInput }),
    ...(options.timeoutMs !== undefined && { timeoutMs: options.timeoutMs }),
    ...(options.onPendingChange && { onPendingChange: options.onPendingChange }),
    ...(options.onSequence && { onSequence: options.onSequence }),
    ...(options.onCaptureChange && { onCaptureChange: options.onCaptureChange }),
  })
  let currentInput: KeyInput | null = null
  // One object per focus pair, so the runtime compares focus by identity.
  let focusIdentity: { readonly node: FocusNode<Source> | null; readonly host: unknown } = {
    node: null,
    host: undefined,
  }

  function currentFocus() {
    const host = options.currentFocus?.()
    if (focusIdentity.node !== focusedNode || focusIdentity.host !== host)
      focusIdentity = { node: focusedNode, host }
    return focusIdentity
  }

  function focusPath(): NodeState<Source>[] {
    const path: NodeState<Source>[] = []
    for (let node = focusedNode; node; node = node.parent) path.push(states.get(node)!)
    return path.reverse()
  }
  function capture(): Captured<Source> {
    const path = focusPath()
    const stack: KeyContext[] = []
    for (const state of path) {
      const context = state.node.context()
      if (context.identifiers.size || context.values.size) stack.push(context)
    }
    return { path, stack }
  }
  function runBinding(
    binding: KeymapBinding<CompiledBinding>,
    captured: Captured<Source>,
    source: Source,
  ): boolean {
    const { command, entry } = binding.payload
    if (command === null) return false
    const args = 'args' in entry ? entry.args : undefined
    return runCommand(captured.path, command, args, currentInput, source)
  }
  function runCommand(
    path: readonly NodeState<Source>[],
    command: string,
    args: unknown,
    input: KeyInput | null,
    source: Source | null,
  ): boolean {
    for (let index = path.length - 1; index >= 0; index -= 1) {
      const state = path[index]!
      const handlers = state.handlers.get(command)
      if (!handlers || state.removed) continue
      for (const handler of handlers) {
        if (handler({ command, args, node: state.node, input, source }) !== false) return true
      }
    }
    return false
  }
  function createNode(nodeOptions: FocusNodeOptions<Source> = {}): FocusNode<Source> {
    const parent = nodeOptions.parent ?? null
    const node: FocusNode<Source> = {
      id: nextId++,
      parent,
      context: () =>
        nodeOptions.readContext ? toKeyContext(nodeOptions.readContext()) : state.context,
      setContext: (context) => {
        state.context = toKeyContext(context)
      },
      handle: (command, handler) => addHandler(state, command, handler),
      focus: () => focus(node),
      remove: () => removeNode(state),
    }
    const state: NodeState<Source> = {
      node,
      context: toKeyContext(nodeOptions.context),
      handlers: new Map(),
      removed: false,
    }
    states.set(node, state)
    for (const [command, handler] of Object.entries(nodeOptions.commands ?? {}))
      addHandler(state, command, handler)
    return node
  }
  function addHandler(state: NodeState<Source>, command: string, handler: CommandHandler<Source>) {
    let handlers = state.handlers.get(command)
    if (!handlers) state.handlers.set(command, (handlers = new Set()))
    handlers.add(handler)
    return () => {
      handlers.delete(handler)
    }
  }
  function removeNode(state: NodeState<Source>) {
    if (state.removed) return
    state.removed = true
    if (isInside(focusedNode, state.node)) focus(nearestLive(state.node.parent))
    states.delete(state.node)
  }
  function nearestLive(node: FocusNode<Source> | null): FocusNode<Source> | null {
    while (node && states.get(node)?.removed !== false) node = node.parent
    return node
  }
  function focus(node: FocusNode<Source> | null) {
    if (node && !states.has(node)) return
    focusedNode = node
  }
  function handleKey(input: KeyInput, source: Source, inScope = true): boolean {
    currentInput = input
    try {
      return runtime.handleKey(input, source, inScope)
    } finally {
      currentInput = null
    }
  }
  function setKeymap(entries: readonly KeymapEntry[]) {
    keymap = compileKeymap(entries, platform)
    runtime.updateBindings(keymap.bindings)
  }
  return {
    createNode,
    focus,
    focused: () => focusedNode,
    contextStack: () => capture().stack,
    setKeymap,
    handleKey,
    dispatchCommand: (command, args) => runCommand(focusPath(), command, args, null, null),
    pending: runtime.pending,
    wantsCapture: runtime.wantsCapture,
    capturesKey: runtime.capturesKey,
    releaseAll: runtime.releaseAll,
    cancel: runtime.cancel,
    dispose: runtime.dispose,
  }
}

function isInside<Source>(node: FocusNode<Source> | null, ancestor: FocusNode<Source>): boolean {
  for (let current = node; current; current = current.parent) {
    if (current === ancestor) return true
  }
  return false
}

function toKeyContext(context: FocusNodeContext | undefined): KeyContext {
  if (context === undefined) return createKeyContext()
  if (typeof context === 'string') return parseKeyContext(context)
  if (context.identifiers instanceof Set && context.values instanceof Map)
    return context as KeyContext
  return createKeyContext(context as KeyContextInit)
}
