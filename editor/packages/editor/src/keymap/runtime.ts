import { detectPlatform, isModifierKey, normalizeKeyName } from '@tanstack/hotkeys'
import { buildKeymapTrie, trieStep, type KeymapNode } from './trie'
import type { ChordOutcome, KeymapBinding, KeymapRuntime, KeymapRuntimeOptions } from './types'

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
const TIMEOUT_MS = 5_000

export function createKeymapRuntime<Payload, Context>(
  options: KeymapRuntimeOptions<Payload, Context>,
): KeymapRuntime<Payload> {
  const { root } = options
  const document = 'defaultView' in root ? root : root.ownerDocument
  const window = document.defaultView
  const platform = options.platform ?? detectPlatform()
  let trie = buildKeymapTrie(options.bindings, platform)
  let enabled = options.enabled !== false
  let disposed = false
  let activeDispatch: { cancellation: ChordOutcome | null } | null = null
  let pending: Pending<Payload> | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  const processed = new WeakMap<KeyboardEvent, boolean>()
  const claimedKeys = new Map<string, Ownership>()

  function hasChordOwnership() {
    for (const owner of claimedKeys.values()) {
      if (owner === 'chord') return true
    }
    return false
  }
  function syncCapture() {
    if (disposed) {
      document.removeEventListener('keydown', onCapture, true)
      return
    }
    const needed = pending || hasChordOwnership() || (!enabled && claimedKeys.size > 0)
    if (needed) document.addEventListener('keydown', onCapture, true)
    else document.removeEventListener('keydown', onCapture, true)
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
    timer = setTimeout(() => cancel('timeout'), TIMEOUT_MS)
    syncCapture()
    options.onPendingChange?.({ keys, candidateCount: count })
  }
  function execute(
    candidates: readonly KeymapBinding<Payload>[],
    context: Context,
    event: KeyboardEvent,
  ): DispatchResult<Payload> {
    let eligible = false
    let handled = false
    for (const binding of candidates) {
      if (!options.isAvailable(binding, context, event)) continue
      eligible = true
      const result = dispatchBinding(binding, context, event)
      const claimed = result.kind === 'claimed'
      if (binding.preventDefault === true || (claimed && binding.preventDefault !== false))
        event.preventDefault()
      if (binding.stopPropagation === true || (claimed && binding.stopPropagation !== false))
        event.stopPropagation()
      if (binding.preventDefault === true || binding.stopPropagation === true) handled = true
      if (result.kind !== 'declined') return result
    }
    if (!eligible) return { kind: 'unavailable' }
    return { kind: handled ? 'handled' : 'declined' }
  }
  function dispatchBinding(
    binding: KeymapBinding<Payload>,
    context: Context,
    event: KeyboardEvent,
  ): DispatchResult<Payload> {
    const operation: { cancellation: ChordOutcome | null } = { cancellation: null }
    activeDispatch = operation
    let claimed: boolean
    try {
      claimed = options.dispatch(binding, context, event)
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
    event: KeyboardEvent,
  ) {
    let count = 0
    for (const binding of candidates) {
      if (options.isAvailable(binding, context, event)) count += 1
    }
    return count
  }
  function match(event: KeyboardEvent): Ownership | null {
    if (!enabled || event.isComposing || event.keyCode === 229) return null
    if (isModifierKey(normalizeKeyName(event.key))) return pending ? ownChord(event) : null
    if (pending && event.repeat) return ownChord(event)
    const fromChord = pending !== null
    const edge = trieStep(pending?.node ?? trie, event)
    if (!edge) return failContinuation(event, 'unmatched')
    const context = options.captureContext(event)
    if (fromChord) swallow(event)
    const result = execute(edge.node.candidates, context, event)
    if (result.kind === 'claimed') {
      cancel('completed', result.binding)
      return fromChord ? 'chord' : 'binding'
    }
    if (result.kind === 'handled')
      return fromChord ? failContinuation(event, 'unavailable', true) : 'binding'
    if (result.kind === 'cancelled') return failContinuation(event, result.outcome, fromChord)
    if (result.kind === 'declined') return failContinuation(event, 'unavailable', fromChord)
    const count = availableCount(edge.node.descendants, context, event)
    if (!count) return failContinuation(event, 'unavailable')
    if (event.repeat) return null
    const keys = pending ? `${pending.keys} ${edge.keys}` : edge.keys
    swallow(event)
    arm(edge.node, keys, count)
    return 'chord'
  }
  function failContinuation(
    event: KeyboardEvent,
    outcome: ChordOutcome,
    fromChord = pending !== null,
  ): Ownership | null {
    if (!fromChord) return null
    swallow(event)
    cancel(outcome)
    return 'chord'
  }
  function claimKeybinding(event: KeyboardEvent): boolean {
    if (disposed) return false
    const prior = processed.get(event)
    if (prior !== undefined) return prior
    const code = event.code || event.key
    if (event.type === 'keyup') return release(event, code)
    if (!event.repeat) claimedKeys.delete(code)
    const previous = claimedKeys.get(code)
    const composing = event.isComposing || event.keyCode === 229
    if (event.repeat && previous && (previous === 'chord' || !enabled) && !composing)
      return retain(event)
    if (!pending && !inRoot(event)) {
      processed.set(event, false)
      return false
    }
    let ownership = match(event)
    if (!ownership && event.repeat && previous && !composing) ownership = ownChord(event)
    if (ownership && !disposed) claimedKeys.set(code, ownership)
    syncCapture()
    processed.set(event, ownership !== null)
    return ownership !== null
  }
  function release(event: KeyboardEvent, code: string) {
    const claimed = claimedKeys.delete(code)
    if (claimed) swallow(event)
    syncCapture()
    processed.set(event, claimed)
    return claimed
  }
  function retain(event: KeyboardEvent) {
    swallow(event)
    processed.set(event, true)
    return true
  }
  function inRoot(event: Event) {
    if (root === document && event.target === null) return true
    return event.composedPath().includes(root)
  }
  function onCapture(event: KeyboardEvent) {
    const owner = claimedKeys.get(event.code || event.key)
    if (pending || (event.repeat && owner && (owner === 'chord' || !enabled)))
      claimKeybinding(event)
  }
  function onKeyDown(event: Event) {
    if (event.defaultPrevented || !('code' in event)) return
    if (!(event instanceof KeyboardEvent)) return
    claimKeybinding(event)
  }
  function onKeyUp(event: KeyboardEvent) {
    claimKeybinding(event)
  }
  function onBlur() {
    claimedKeys.clear()
    cancel('blur')
    syncCapture()
  }
  function onVisibilityChange() {
    if (document.visibilityState !== 'hidden') return
    claimedKeys.clear()
    cancel('hidden')
    syncCapture()
  }
  function onPointerDown() {
    cancel('pointer')
  }
  function onFocusOut(event: Event) {
    if (root === document) return
    if (!(event instanceof FocusEvent)) return
    const target = event.relatedTarget
    if (target instanceof Node && root.contains(target)) return
    cancel('superseded')
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
    root.removeEventListener('keydown', onKeyDown)
    root.removeEventListener('focusout', onFocusOut)
    document.removeEventListener('keydown', onCapture, true)
    document.removeEventListener('keyup', onKeyUp, true)
    document.removeEventListener('visibilitychange', onVisibilityChange)
    document.removeEventListener('pointerdown', onPointerDown, true)
    window?.removeEventListener('blur', onBlur)
  }
  root.addEventListener('keydown', onKeyDown)
  root.addEventListener('focusout', onFocusOut)
  document.addEventListener('keyup', onKeyUp, true)
  document.addEventListener('visibilitychange', onVisibilityChange)
  document.addEventListener('pointerdown', onPointerDown, true)
  window?.addEventListener('blur', onBlur)
  return { claimKeybinding, updateBindings, setEnabled, cancel, dispose }
}
function swallow(event: KeyboardEvent) {
  event.preventDefault()
  event.stopImmediatePropagation()
}
function ownChord(event: KeyboardEvent): Ownership {
  swallow(event)
  return 'chord'
}
