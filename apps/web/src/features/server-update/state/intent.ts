import type { BusySession, StagedRelease } from '@workspace/contracts'
import { createStore } from 'zustand/vanilla'

export type UpdateTarget = StagedRelease | { readonly release: string; readonly stagedAt: null }

export type UpdateIntent =
  | { readonly kind: 'idle' }
  | {
      readonly kind: 'confirm'
      readonly target: UpdateTarget
      readonly busy: readonly BusySession[]
    }
  | {
      readonly kind: 'waiting'
      readonly target: UpdateTarget
      readonly busy: readonly BusySession[]
      readonly gateReadAt: number
    }
  | {
      readonly kind: 'restarting'
      readonly target: UpdateTarget
      readonly confirmed: boolean
      readonly instance: string | null
      readonly fromRelease: string | null
    }
  | { readonly kind: 'reload'; readonly target: UpdateTarget }
  | { readonly kind: 'failed'; readonly target: UpdateTarget }

export const updateIntentStore = createStore<{
  intent: UpdateIntent
  setIntent: (intent: UpdateIntent) => void
}>((set) => ({ intent: { kind: 'idle' }, setIntent: (intent) => set({ intent }) }))
