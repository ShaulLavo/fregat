import { isModifierKey } from '../parse'
import { isPrintableKey } from '../_keyboard-event'
import { buildKeymapTrie, trieStep } from './trie'
import type { KeyInput } from '../key-input'
import type { KeymapEdge, KeymapNode } from './trie'
import type {
  ChordOutcome,
  KeymapBinding,
  KeymapPlatform,
  KeymapSequenceEvent,
  PendingChordLabel,
} from './types'

/** How the host applies the runtime's decisions to its own event. */
export type KeyEffects<Source> = {
  readonly preventDefault: (source: Source) => void
  readonly stopPropagation: (source: Source) => void
  /** Keeps the key from every later listener and from default input handling. */
  readonly swallow: (source: Source) => void
}
export type ChordRuntimeOptions<Payload, Context, Source> = {
  readonly bindings: readonly KeymapBinding<Payload>[]
  readonly platform: KeymapPlatform
  readonly enabled?: boolean
  readonly effects: KeyEffects<Source>
  readonly captureContext: (source: Source) => Context
  /** Filters candidates for the default {@link ChordRuntimeOptions.select}. */
  readonly isAvailable?: (
    binding: KeymapBinding<Payload>,
    context: Context,
    source: Source,
  ) => boolean
  /**
   * Chooses what a trie node offers for this key: the bindings to run, in order, and how many
   * longer bindings keep a chord pending. Defaults to available candidates in table order.
   */
  readonly select?: (
    node: KeymapNode<Payload>,
    context: Context,
    source: Source,
  ) => KeymapSelection<Payload>
  /** Returns false to decline; the next available candidate then gets the key. */
  readonly dispatch: (binding: KeymapBinding<Payload>, context: Context, source: Source) => boolean
  readonly onPendingChange?: (pending: PendingChordLabel | null) => void
  readonly onSequence?: (event: KeymapSequenceEvent<Payload>) => void
  /** Called whenever {@link ChordRuntime.wantsCapture} may have changed. */
  readonly onCaptureChange?: () => void
  /**
   * Receives a buffered key that no binding took when a chord mismatches or times out, so the
   * host can give it to default input handling (a terminal re-encodes it for the shell).
   */
  readonly replay?: (input: KeyInput, source: Source) => void
  /**
   * True when the focused target takes typed text. A printable prefix then pends with a timeout,
   * and `replay` receives the character when no chord follows.
   */
  readonly acceptsTextInput?: (source: Source) => boolean
  /** Identifies the focus; a pending chord ends without replay when it changes. */
  readonly currentFocus?: () => unknown
  /** How long a prefix that is itself bound waits for its continuation. Other prefixes wait until the next key. */
  readonly timeoutMs?: number
}
export type ChordRuntime<Payload, Source> = {
  /**
   * Offers one key to the runtime; true means the runtime owns it. `inScope` says whether an
   * idle runtime may start matching this key (a pending chord or a held claimed key always may).
   */
  readonly handleKey: (input: KeyInput, source: Source, inScope?: boolean) => boolean
  /** True while a chord is pending or a claimed key is held, so a host listens ahead of others. */
  readonly wantsCapture: () => boolean
  /** True when a capturing host listener should offer this key before anyone else. */
  readonly capturesKey: (input: KeyInput) => boolean
  /** Forgets held keys, for blur and hidden tabs where their release never arrives. */
  readonly releaseAll: () => void
  readonly updateBindings: (bindings: readonly KeymapBinding<Payload>[]) => void
  readonly setEnabled: (enabled: boolean) => void
  readonly cancel: (outcome?: ChordOutcome) => void
  readonly dispose: () => void
  readonly pending: () => PendingChordLabel | null
}

export type KeymapSelection<Payload> = {
  readonly bindings: readonly KeymapBinding<Payload>[]
  /** Count of longer bindings still reachable; nonzero keeps the chord pending. */
  readonly pending: number
}
type Ownership = 'binding' | 'chord'
type DispatchResult<Payload> =
  | { readonly kind: 'claimed'; readonly binding: KeymapBinding<Payload> }
  | { readonly kind: 'declined' | 'unavailable' | 'handled' }
  | { readonly kind: 'cancelled'; readonly outcome: ChordOutcome }
type Buffered<Source> = { readonly input: KeyInput; readonly source: Source }
type Replayed<Payload, Source> = {
  readonly claimed: KeymapBinding<Payload> | null
  readonly rest: readonly Buffered<Source>[]
}
/** Buffered keys plus a new key that match again from the root after a mismatch. */
type Sequence<Payload, Context, Source> = {
  readonly node: KeymapNode<Payload>
  readonly keys: string
  readonly buffer: readonly Buffered<Source>[]
  readonly context: Context
  readonly selection: KeymapSelection<Payload>
}
type Pending<Payload, Source> = {
  readonly node: KeymapNode<Payload>
  readonly keys: string
  readonly count: number
  readonly buffer: readonly Buffered<Source>[]
  readonly started: number
  readonly focus: unknown
  readonly timed: boolean
}
const DEFAULT_TIMEOUT_MS = 1_000

/** The chord state machine over {@link KeyInput}. Hosts adapt their events and apply {@link KeyEffects}. */
export function createChordRuntime<Payload, Context, Source>(
  options: ChordRuntimeOptions<Payload, Context, Source>,
): ChordRuntime<Payload, Source> {
  const { effects, platform } = options
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  let trie = buildKeymapTrie(options.bindings, platform)
  let enabled = options.enabled !== false
  let disposed = false
  let activeDispatch: { cancellation: ChordOutcome | null } | null = null
  let pending: Pending<Payload, Source> | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  const claimedKeys = new Map<string, Ownership>()
  const isAvailable = options.isAvailable ?? (() => true)
  const select = options.select ?? selectAvailable

  function selectAvailable(
    node: KeymapNode<Payload>,
    context: Context,
    source: Source,
  ): KeymapSelection<Payload> {
    const bindings = node.candidates.filter((binding) => isAvailable(binding, context, source))
    let count = 0
    for (const binding of node.descendants) {
      if (isAvailable(binding, context, source)) count += 1
    }
    return { bindings, pending: count }
  }

  function hasChordOwnership() {
    for (const owner of claimedKeys.values()) {
      if (owner === 'chord') return true
    }
    return false
  }
  function wantsCapture() {
    if (disposed) return false
    return pending !== null || hasChordOwnership() || (!enabled && claimedKeys.size > 0)
  }
  function syncCapture() {
    options.onCaptureChange?.()
  }
  function cancel(
    outcome: ChordOutcome = 'superseded',
    binding: KeymapBinding<Payload> | null = null,
  ) {
    if (!pending) return
    if (activeDispatch && outcome !== 'disposed') {
      activeDispatch.cancellation = outcome
      return
    }
    report(endPending(), outcome, binding)
  }
  function endPending(): Pending<Payload, Source> {
    const ended = pending!
    pending = null
    clearTimeout(timer)
    syncCapture()
    options.onPendingChange?.(null)
    return ended
  }
  function report(
    ended: Pending<Payload, Source>,
    outcome: ChordOutcome,
    binding: KeymapBinding<Payload> | null,
  ) {
    options.onSequence?.({
      outcome,
      keys: ended.keys,
      candidateCount: ended.count,
      strokeCount: binding?.chord.length ?? ended.buffer.length,
      elapsedMs: Date.now() - ended.started,
      binding,
    })
  }
  function arm(edge: KeymapEdge<Payload>, entry: Buffered<Source>, count: number, bound: boolean) {
    setPending({
      node: edge.node,
      keys: pending ? `${pending.keys} ${edge.keys}` : edge.keys,
      count,
      buffer: (pending?.buffer ?? []).concat([entry]),
      started: pending?.started ?? Date.now(),
      focus: pending ? pending.focus : options.currentFocus?.(),
      // Zed times out a bound prefix or typed text; once running, the timeout restarts per stroke.
      timed: bound || pending?.timed === true || typesText(entry),
    })
  }
  function setPending(next: Pending<Payload, Source>) {
    pending = next
    clearTimeout(timer)
    if (next.timed) timer = setTimeout(timeout, timeoutMs)
    syncCapture()
    options.onPendingChange?.({ keys: next.keys, candidateCount: next.count })
  }
  function typesText({ input, source }: Buffered<Source>) {
    const { ctrl, meta } = input.modifiers
    if (ctrl || meta || !(isPrintableKey(input.key) || input.key === 'Space')) return false
    return options.acceptsTextInput?.(source) === true
  }
  function timeout() {
    if (!pending) return
    // Zed flushes only while focus is where the chord started; elsewhere the prefix is dropped.
    if (focusMoved()) return report(endPending(), 'superseded', null)
    const ended = endPending()
    report(ended, 'timeout', flush(ended.buffer))
  }
  function focusMoved() {
    return options.currentFocus !== undefined && options.currentFocus() !== pending!.focus
  }
  /** Zed's `flush_dispatch`: replays prefixes until no buffered key is left. Returns the first claim. */
  function flush(buffer: readonly Buffered<Source>[]): KeymapBinding<Payload> | null {
    let claimed: KeymapBinding<Payload> | null = null
    let rest = buffer
    while (rest.length) {
      const step = replayPrefix(rest)
      claimed ??= step.claimed
      rest = step.rest
    }
    return claimed
  }
  /**
   * Zed's `replay_prefix`: runs the longest buffered prefix that has an available binding, or
   * hands the first key to the host's `replay`. Returns the keys after it.
   */
  function replayPrefix(buffer: readonly Buffered<Source>[]): Replayed<Payload, Source> {
    const first = buffer[0]!
    const context = options.captureContext(first.source)
    const end = longestBoundPrefix(buffer, context)
    if (!end) {
      options.replay?.(first.input, first.source)
      return { claimed: null, rest: buffer.slice(1) }
    }
    const last = buffer[end.index]!
    const result = execute(end.bindings, context, last.source)
    if (result.kind === 'declined' || result.kind === 'unavailable')
      options.replay?.(last.input, last.source)
    const claimed = result.kind === 'claimed' ? result.binding : null
    return { claimed, rest: buffer.slice(end.index + 1) }
  }
  function longestBoundPrefix(
    buffer: readonly Buffered<Source>[],
    context: Context,
  ): { index: number; bindings: readonly KeymapBinding<Payload>[] } | null {
    let node = trie
    let found: { index: number; bindings: readonly KeymapBinding<Payload>[] } | null = null
    for (let index = 0; index < buffer.length; index += 1) {
      const entry = buffer[index]!
      const edge = trieStep(node, entry.input)
      if (!edge) break
      node = edge.node
      const { bindings } = select(node, context, entry.source)
      if (bindings.length) found = { index, bindings }
    }
    return found
  }
  function execute(
    bindings: readonly KeymapBinding<Payload>[],
    context: Context,
    source: Source,
  ): DispatchResult<Payload> {
    let handled = false
    for (const binding of bindings) {
      const result = dispatchBinding(binding, context, source)
      const claimed = result.kind === 'claimed'
      if (binding.preventDefault === true || (claimed && binding.preventDefault !== false))
        effects.preventDefault(source)
      if (binding.stopPropagation === true || (claimed && binding.stopPropagation !== false))
        effects.stopPropagation(source)
      if (binding.preventDefault === true || binding.stopPropagation === true) handled = true
      if (result.kind !== 'declined') return result
    }
    if (!bindings.length) return { kind: 'unavailable' }
    return { kind: handled ? 'handled' : 'declined' }
  }
  function dispatchBinding(
    binding: KeymapBinding<Payload>,
    context: Context,
    source: Source,
  ): DispatchResult<Payload> {
    const operation: { cancellation: ChordOutcome | null } = { cancellation: null }
    activeDispatch = operation
    let claimed: boolean
    try {
      claimed = options.dispatch(binding, context, source)
    } finally {
      activeDispatch = null
    }
    if (claimed) return { kind: 'claimed', binding }
    if (operation.cancellation) return { kind: 'cancelled', outcome: operation.cancellation }
    return { kind: 'declined' }
  }
  function ownChord(source: Source): Ownership {
    effects.swallow(source)
    return 'chord'
  }
  function match(input: KeyInput, source: Source): Ownership | null {
    if (!enabled || input.composing) return null
    if (isModifierKey(input.key)) return pending ? ownChord(source) : null
    if (pending && input.repeat) return ownChord(source)
    if (pending && focusMoved()) cancel('superseded')
    if (pending) {
      const continued = continueChord(input, source)
      if (continued !== undefined) return continued
    }
    const edge = trieStep(trie, input)
    if (!edge) return null
    const context = options.captureContext(source)
    return resolve(edge, input, source, context, select(edge.node, context, source), false)
  }
  /** Returns undefined when the key matches from the root after the chord replayed. */
  function continueChord(input: KeyInput, source: Source): Ownership | null | undefined {
    const edge = trieStep(pending!.node, input)
    if (edge) {
      const context = options.captureContext(source)
      const selection = select(edge.node, context, source)
      if (selection.bindings.length || selection.pending)
        return resolve(edge, input, source, context, selection, true)
    }
    const ended = endPending()
    const entry = { input, source }
    let claimed: KeymapBinding<Payload> | null = null
    let rest = ended.buffer
    let sequence: Sequence<Payload, Context, Source> | null = null
    // Zed's `dispatch_key`: replay a prefix, then match the leftover keys and this one again.
    while (rest.length && !sequence) {
      const step = replayPrefix(rest)
      claimed ??= step.claimed
      rest = step.rest
      if (rest.length) sequence = lookupSequence(rest.concat([entry]))
    }
    report(ended, 'unmatched', claimed)
    return sequence ? resumeSequence(sequence) : undefined
  }
  function lookupSequence(
    buffer: readonly Buffered<Source>[],
  ): Sequence<Payload, Context, Source> | null {
    let node = trie
    const keys: string[] = []
    for (const { input } of buffer) {
      const edge = trieStep(node, input)
      if (!edge) return null
      node = edge.node
      keys.push(edge.keys)
    }
    const { source } = buffer.at(-1)!
    const context = options.captureContext(source)
    const selection = select(node, context, source)
    if (!selection.pending && !selection.bindings.length) return null
    return { node, keys: keys.join(' '), buffer, context, selection }
  }
  function resumeSequence(sequence: Sequence<Payload, Context, Source>): Ownership | null {
    const { buffer, selection } = sequence
    const { source } = buffer.at(-1)!
    if (selection.pending) {
      effects.swallow(source)
      setPending({
        node: sequence.node,
        keys: sequence.keys,
        count: selection.pending,
        buffer,
        started: Date.now(),
        focus: options.currentFocus?.(),
        timed: selection.bindings.length > 0 || buffer.some(typesText),
      })
      return 'chord'
    }
    const result = execute(selection.bindings, sequence.context, source)
    if (result.kind === 'claimed' || result.kind === 'handled' || result.kind === 'cancelled') {
      effects.swallow(source)
      return 'chord'
    }
    // Nothing took the new chord: its earlier keys go back to the host, the new key passes on.
    for (const earlier of buffer.slice(0, -1)) options.replay?.(earlier.input, earlier.source)
    return null
  }
  function resolve(
    edge: KeymapEdge<Payload>,
    input: KeyInput,
    source: Source,
    context: Context,
    selection: KeymapSelection<Payload>,
    fromChord: boolean,
  ): Ownership | null {
    if (selection.pending) {
      if (input.repeat) return null
      effects.swallow(source)
      arm(edge, { input, source }, selection.pending, selection.bindings.length > 0)
      return 'chord'
    }
    const result = execute(selection.bindings, context, source)
    const owned =
      result.kind === 'claimed' || result.kind === 'handled' || result.kind === 'cancelled'
    if (fromChord && owned) effects.swallow(source)
    if (fromChord) {
      if (result.kind === 'claimed') cancel('completed', result.binding)
      else cancel(result.kind === 'cancelled' ? result.outcome : 'unavailable')
    }
    if (!owned) return null
    return fromChord ? 'chord' : 'binding'
  }
  function handleKey(input: KeyInput, source: Source, inScope = true): boolean {
    if (disposed) return false
    const code = input.code || input.key
    if (input.type === 'keyup') return release(source, code)
    if (!input.repeat) claimedKeys.delete(code)
    const previous = claimedKeys.get(code)
    if (input.repeat && previous && (previous === 'chord' || !enabled) && !input.composing) {
      effects.swallow(source)
      return true
    }
    if (!pending && !inScope) return false
    let ownership = match(input, source)
    if (!ownership && input.repeat && previous && !input.composing) ownership = ownChord(source)
    if (ownership && !disposed) claimedKeys.set(code, ownership)
    syncCapture()
    return ownership !== null
  }
  function release(source: Source, code: string) {
    const claimed = claimedKeys.delete(code)
    if (claimed) effects.swallow(source)
    syncCapture()
    return claimed
  }
  function capturesKey(input: KeyInput) {
    if (pending) return true
    const owner = claimedKeys.get(input.code || input.key)
    return input.repeat && owner !== undefined && (owner === 'chord' || !enabled)
  }
  function releaseAll() {
    claimedKeys.clear()
    syncCapture()
  }
  function updateBindings(bindings: readonly KeymapBinding<Payload>[]) {
    cancel('superseded')
    trie = buildKeymapTrie(bindings, platform)
  }
  function setEnabled(next: boolean) {
    enabled = next
    if (!enabled) cancel('disabled')
    syncCapture()
  }
  function dispose() {
    if (disposed) return
    disposed = true
    cancel('disposed')
    claimedKeys.clear()
    syncCapture()
  }
  function currentPending(): PendingChordLabel | null {
    return pending && { keys: pending.keys, candidateCount: pending.count }
  }
  return {
    handleKey,
    wantsCapture,
    capturesKey,
    releaseAll,
    updateBindings,
    setEnabled,
    cancel,
    dispose,
    pending: currentPending,
  }
}
