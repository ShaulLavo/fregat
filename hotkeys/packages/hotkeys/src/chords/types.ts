import type { RegisterableHotkey } from '../hotkey.types'

export type KeyChord = readonly [RegisterableHotkey, ...RegisterableHotkey[]]
export type KeymapPlatform = 'mac' | 'windows' | 'linux'
export type KeymapBinding<Payload> = {
  readonly chord: KeyChord
  readonly payload: Payload
  readonly preventDefault?: boolean
  readonly stopPropagation?: boolean
}
/** Why a pending chord ended. */
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
