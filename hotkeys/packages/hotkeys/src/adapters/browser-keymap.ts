import { createChordRuntime } from '../chords/runtime'
import { detectPlatform } from '../platform'
import { attachKeyListeners, browserKeyEffects } from './browser-listeners'
import type { KeyInput } from '../key-input'
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
  /** Receives a buffered key no binding took after a chord mismatch or timeout. */
  readonly replay?: (input: KeyInput, event: KeyboardEvent) => void
  /** How long a prefix that is itself bound waits for its continuation. */
  readonly timeoutMs?: number
}
export type KeymapRuntime<Payload> = {
  /** Offers a key event; idempotent per event, so a host may forward it before DOM dispatch. */
  readonly claimKeybinding: (event: KeyboardEvent) => boolean
  readonly updateBindings: (bindings: readonly KeymapBinding<Payload>[]) => void
  readonly setEnabled: (enabled: boolean) => void
  readonly cancel: (outcome?: ChordOutcome) => void
  readonly dispose: () => void
}

/** Attaches a chord runtime to a DOM root and cancels pending chords on blur, hidden tab, pointer and focus loss. */
export function createKeymapRuntime<Payload, Context>(
  options: KeymapRuntimeOptions<Payload, Context>,
): KeymapRuntime<Payload> {
  const { root } = options
  const document = 'defaultView' in root ? root : root.ownerDocument
  const platform = options.platform ?? detectPlatform()
  const runtime = createChordRuntime<Payload, Context, KeyboardEvent>({
    ...options,
    platform,
    effects: browserKeyEffects,
    onCaptureChange: () => listeners.syncCapture(),
    currentFocus: () => document.activeElement,
  })
  const listeners = attachKeyListeners(root, platform, () => runtime)
  return {
    claimKeybinding: listeners.claim,
    updateBindings: runtime.updateBindings,
    setEnabled: runtime.setEnabled,
    cancel: runtime.cancel,
    dispose: () => {
      runtime.dispose()
      listeners.dispose()
    },
  }
}
