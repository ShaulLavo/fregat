import { createChordRuntime } from '../chords/runtime'
import { detectPlatform } from '../platform'
import { keyInputFromKeyboardEvent } from './browser'
import type {
  ChordOutcome,
  KeymapBinding,
  KeymapPlatform,
  KeymapSequenceEvent,
  PendingChordLabel,
} from '../chords/types'

export type KeymapRuntimeOptions<Payload, Context> = {
  /** Idle keys are matched only inside this root; a pending chord listens document-wide. */
  readonly root: HTMLElement | Document
  readonly bindings: readonly KeymapBinding<Payload>[]
  readonly platform?: KeymapPlatform
  readonly enabled?: boolean
  readonly captureContext: (event: KeyboardEvent) => Context
  readonly isAvailable: (
    binding: KeymapBinding<Payload>,
    context: Context,
    event: KeyboardEvent,
  ) => boolean
  /** Returns false to decline; the next available candidate then gets the key. */
  readonly dispatch: (
    binding: KeymapBinding<Payload>,
    context: Context,
    event: KeyboardEvent,
  ) => boolean
  readonly onPendingChange?: (pending: PendingChordLabel | null) => void
  readonly onSequence?: (event: KeymapSequenceEvent<Payload>) => void
}
export type KeymapRuntime<Payload> = {
  /** Offers a key event; idempotent per event, so a host may forward it before DOM dispatch. */
  readonly claimKeybinding: (event: KeyboardEvent) => boolean
  readonly updateBindings: (bindings: readonly KeymapBinding<Payload>[]) => void
  readonly setEnabled: (enabled: boolean) => void
  readonly cancel: (outcome?: ChordOutcome) => void
  readonly dispose: () => void
}

const BROWSER_EFFECTS = {
  preventDefault: (event: KeyboardEvent) => event.preventDefault(),
  stopPropagation: (event: KeyboardEvent) => event.stopPropagation(),
  swallow: (event: KeyboardEvent) => {
    event.preventDefault()
    event.stopImmediatePropagation()
  },
}

/** Attaches a chord runtime to a DOM root and cancels pending chords on blur, hidden tab, pointer and focus loss. */
export function createKeymapRuntime<Payload, Context>(
  options: KeymapRuntimeOptions<Payload, Context>,
): KeymapRuntime<Payload> {
  const { root } = options
  const document = 'defaultView' in root ? root : root.ownerDocument
  const window = document.defaultView
  const platform = options.platform ?? detectPlatform()
  const processed = new WeakMap<KeyboardEvent, boolean>()
  let disposed = false
  const runtime = createChordRuntime<Payload, Context, KeyboardEvent>({
    ...options,
    platform,
    effects: BROWSER_EFFECTS,
    onCaptureChange: syncCapture,
  })

  function syncCapture() {
    if (!disposed && runtime.wantsCapture()) document.addEventListener('keydown', onCapture, true)
    else document.removeEventListener('keydown', onCapture, true)
  }
  function claimKeybinding(event: KeyboardEvent): boolean {
    if (disposed) return false
    const prior = processed.get(event)
    if (prior !== undefined) return prior
    const input = keyInputFromKeyboardEvent(event, platform)
    const owned = runtime.handleKey(input, event, input.type === 'keyup' || inRoot(event))
    processed.set(event, owned)
    return owned
  }
  function inRoot(event: Event) {
    if (root === document && event.target === null) return true
    return event.composedPath().includes(root)
  }
  function onCapture(event: KeyboardEvent) {
    if (runtime.capturesKey(keyInputFromKeyboardEvent(event, platform))) claimKeybinding(event)
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
    runtime.releaseAll()
    runtime.cancel('blur')
  }
  function onVisibilityChange() {
    if (document.visibilityState !== 'hidden') return
    runtime.releaseAll()
    runtime.cancel('hidden')
  }
  function onPointerDown() {
    runtime.cancel('pointer')
  }
  function onFocusOut(event: Event) {
    if (root === document) return
    if (!(event instanceof FocusEvent)) return
    const target = event.relatedTarget
    if (target instanceof Node && root.contains(target)) return
    runtime.cancel('superseded')
  }
  function dispose() {
    if (disposed) return
    runtime.dispose()
    disposed = true
    syncCapture()
    root.removeEventListener('keydown', onKeyDown)
    root.removeEventListener('focusout', onFocusOut)
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
  return {
    claimKeybinding,
    updateBindings: runtime.updateBindings,
    setEnabled: runtime.setEnabled,
    cancel: runtime.cancel,
    dispose,
  }
}
