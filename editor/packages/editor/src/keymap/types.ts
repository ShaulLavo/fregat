import type { RegisterableHotkey, detectPlatform } from '@tanstack/hotkeys'

export type KeyChord = readonly [RegisterableHotkey, ...RegisterableHotkey[]]
export type KeymapPlatform = ReturnType<typeof detectPlatform>
export type KeymapBinding<Payload> = {
  readonly chord: KeyChord
  readonly payload: Payload
  readonly preventDefault?: boolean
  readonly stopPropagation?: boolean
}
export type ChordOutcome =
  | 'completed'
  | 'unmatched'
  | 'unavailable'
  | 'timeout'
  | 'blur'
  | 'hidden'
  | 'pointer'
  | 'superseded'
  | 'disabled'
  | 'disposed'
export type PendingChordLabel = { readonly keys: string; readonly candidateCount: number }
export type KeymapSequenceEvent<Payload> = PendingChordLabel & {
  readonly outcome: ChordOutcome
  readonly elapsedMs: number
  readonly strokeCount: number
  readonly binding: KeymapBinding<Payload> | null
}
export type KeymapRuntimeOptions<Payload, Context> = {
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
  readonly dispatch: (
    binding: KeymapBinding<Payload>,
    context: Context,
    event: KeyboardEvent,
  ) => boolean
  readonly onPendingChange?: (pending: PendingChordLabel | null) => void
  readonly onSequence?: (event: KeymapSequenceEvent<Payload>) => void
}
export type KeymapRuntime<Payload> = {
  readonly claimKeybinding: (event: KeyboardEvent) => boolean
  readonly updateBindings: (bindings: readonly KeymapBinding<Payload>[]) => void
  readonly setEnabled: (enabled: boolean) => void
  readonly cancel: (outcome?: ChordOutcome) => void
  readonly dispose: () => void
}
