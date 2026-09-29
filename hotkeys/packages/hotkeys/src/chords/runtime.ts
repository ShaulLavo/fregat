import { isModifierKey } from '../parse'
import { buildKeymapTrie, trieStep } from './trie'
import type { KeyInput } from '../key-input'
import type { KeymapNode } from './trie'
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
type Pending<Payload> = {
  readonly node: KeymapNode<Payload>
  readonly keys: string
  readonly count: number
  readonly strokes: number
  readonly started: number
}
const DEFAULT_TIMEOUT_MS = 5_000

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
  let pending: Pending<Payload> | null = null
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
    const ended = pending
    pending = null
    clearTimeout(timer)
    syncCapture()
    options.onPendingChange?.(null)
    options.onSequence?.({
      outcome,
      keys: ended.keys,
      candidateCount: ended.count,
      strokeCount: binding?.chord.length ?? ended.strokes,
      elapsedMs: Date.now() - ended.started,
      binding,
    })
  }
  function arm(node: KeymapNode<Payload>, keys: string, count: number) {
    const started = pending?.started ?? Date.now()
    const strokes = (pending?.strokes ?? 0) + 1
    pending = { node, keys, count, started, strokes }
    clearTimeout(timer)
    timer = setTimeout(() => cancel('timeout'), timeoutMs)
    syncCapture()
    options.onPendingChange?.({ keys, candidateCount: count })
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
    const fromChord = pending !== null
    const edge = trieStep(pending?.node ?? trie, input)
    if (!edge) return failContinuation(source, 'unmatched')
    const context = options.captureContext(source)
    if (fromChord) effects.swallow(source)
    const result = execute(edge.node.candidates, context, source)
    if (result.kind === 'claimed') {
      cancel('completed', result.binding)
      return fromChord ? 'chord' : 'binding'
    }
    if (result.kind === 'handled')
      return fromChord ? failContinuation(source, 'unavailable', true) : 'binding'
    if (result.kind === 'cancelled') return failContinuation(source, result.outcome, fromChord)
    if (result.kind === 'declined') return failContinuation(source, 'unavailable', fromChord)
    const count = availableCount(edge.node.descendants, context, source)
    if (!count) return failContinuation(source, 'unavailable')
    if (input.repeat) return null
    const keys = pending ? `${pending.keys} ${edge.keys}` : edge.keys
    effects.swallow(source)
    arm(edge.node, keys, count)
    return 'chord'
  }
  function failContinuation(
    source: Source,
    outcome: ChordOutcome,
    fromChord = pending !== null,
  ): Ownership | null {
    if (!fromChord) return null
    effects.swallow(source)
    cancel(outcome)
    return 'chord'
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
