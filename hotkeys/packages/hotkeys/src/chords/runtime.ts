import { isModifierKey } from '../parse'
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
  readonly isAvailable: (
    binding: KeymapBinding<Payload>,
    context: Context,
    source: Source,
  ) => boolean
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

type Ownership = 'binding' | 'chord'
type DispatchResult<Payload> =
  | { readonly kind: 'claimed'; readonly binding: KeymapBinding<Payload> }
  | { readonly kind: 'declined' | 'unavailable' | 'handled' }
  | { readonly kind: 'cancelled'; readonly outcome: ChordOutcome }
type Buffered<Source> = { readonly input: KeyInput; readonly source: Source }
type Pending<Payload, Source> = {
  readonly node: KeymapNode<Payload>
  readonly keys: string
  readonly count: number
  readonly buffer: readonly Buffered<Source>[]
  readonly started: number
  readonly focus: unknown
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
    const keys = pending ? `${pending.keys} ${edge.keys}` : edge.keys
    const buffer = [...(pending?.buffer ?? []), entry]
    const started = pending?.started ?? Date.now()
    const focus = pending ? pending.focus : options.currentFocus?.()
    pending = { node: edge.node, keys, count, buffer, started, focus }
    clearTimeout(timer)
    // Zed waits only when the prefix is itself bound; otherwise the next key decides.
    if (bound) timer = setTimeout(timeout, timeoutMs)
    syncCapture()
    options.onPendingChange?.({ keys, candidateCount: count })
  }
  function timeout() {
    if (!pending) return
    const ended = endPending()
    report(ended, 'timeout', flush(ended.buffer))
  }
  /**
   * Runs the longest buffered prefix that has an available binding, replays unbound keys to the
   * host, and repeats on the rest, so no buffered key is dropped. Returns the first claiming binding.
   */
  function flush(buffer: readonly Buffered<Source>[]): KeymapBinding<Payload> | null {
    let claimed: KeymapBinding<Payload> | null = null
    let start = 0
    while (start < buffer.length) {
      const first = buffer[start]!
      const context = options.captureContext(first.source)
      const end = longestBoundPrefix(buffer, start, context)
      if (!end) {
        options.replay?.(first.input, first.source)
        start += 1
        continue
      }
      const last = buffer[end.index]!
      const result = execute(end.node.candidates, context, last.source)
      if (result.kind === 'claimed') claimed ??= result.binding
      if (result.kind === 'declined' || result.kind === 'unavailable')
        options.replay?.(last.input, last.source)
      start = end.index + 1
    }
    return claimed
  }
  function longestBoundPrefix(
    buffer: readonly Buffered<Source>[],
    start: number,
    context: Context,
  ): { index: number; node: KeymapNode<Payload> } | null {
    let node = trie
    let found: { index: number; node: KeymapNode<Payload> } | null = null
    for (let index = start; index < buffer.length; index += 1) {
      const entry = buffer[index]!
      const edge = trieStep(node, entry.input)
      if (!edge) break
      node = edge.node
      if (availableCount(node.candidates, context, entry.source)) found = { index, node }
    }
    return found
  }
  function execute(
    candidates: readonly KeymapBinding<Payload>[],
    context: Context,
    source: Source,
  ): DispatchResult<Payload> {
    let eligible = false
    let handled = false
    for (const binding of candidates) {
      if (!options.isAvailable(binding, context, source)) continue
      eligible = true
      const result = dispatchBinding(binding, context, source)
      const claimed = result.kind === 'claimed'
      if (binding.preventDefault === true || (claimed && binding.preventDefault !== false))
        effects.preventDefault(source)
      if (binding.stopPropagation === true || (claimed && binding.stopPropagation !== false))
        effects.stopPropagation(source)
      if (binding.preventDefault === true || binding.stopPropagation === true) handled = true
      if (result.kind !== 'declined') return result
    }
    if (!eligible) return { kind: 'unavailable' }
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
  function availableCount(
    candidates: readonly KeymapBinding<Payload>[],
    context: Context,
    source: Source,
  ) {
    let count = 0
    for (const binding of candidates) {
      if (options.isAvailable(binding, context, source)) count += 1
    }
    return count
  }
  function ownChord(source: Source): Ownership {
    effects.swallow(source)
    return 'chord'
  }
  function match(input: KeyInput, source: Source): Ownership | null {
    if (!enabled || input.composing) return null
    if (isModifierKey(input.key)) return pending ? ownChord(source) : null
    if (pending && input.repeat) return ownChord(source)
    if (pending && options.currentFocus && options.currentFocus() !== pending.focus)
      cancel('superseded')
    if (pending) {
      const continued = continueChord(input, source)
      if (continued !== undefined) return continued
    }
    const edge = trieStep(trie, input)
    if (!edge) return null
    return resolve(edge, input, source, options.captureContext(source), false)
  }
  /** Returns undefined when the key does not continue the chord; the chord then replays. */
  function continueChord(input: KeyInput, source: Source): Ownership | null | undefined {
    const edge = trieStep(pending!.node, input)
    if (edge) {
      const context = options.captureContext(source)
      const reachable =
        availableCount(edge.node.candidates, context, source) ||
        availableCount(edge.node.descendants, context, source)
      if (reachable) return resolve(edge, input, source, context, true)
    }
    const ended = endPending()
    report(ended, 'unmatched', flush(ended.buffer))
    return undefined
  }
  function resolve(
    edge: KeymapEdge<Payload>,
    input: KeyInput,
    source: Source,
    context: Context,
    fromChord: boolean,
  ): Ownership | null {
    const deeper = availableCount(edge.node.descendants, context, source)
    if (deeper) {
      if (input.repeat) return null
      effects.swallow(source)
      const bound = availableCount(edge.node.candidates, context, source) > 0
      arm(edge, { input, source }, deeper, bound)
      return 'chord'
    }
    const result = execute(edge.node.candidates, context, source)
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
