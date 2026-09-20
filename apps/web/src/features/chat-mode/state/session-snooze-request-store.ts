import { create } from 'zustand'
import type { ScopedSessionRef } from '@workspace/contracts'

type SnoozeRequest = { readonly refs: readonly ScopedSessionRef[]; readonly title: string }
export const useSessionSnoozeRequestStore = create<{
  readonly request: SnoozeRequest | null
  readonly requestSnooze: (request: SnoozeRequest) => void
  readonly dismiss: () => void
}>()((set) => ({
  request: null,
  requestSnooze: (request) => set({ request }),
  dismiss: () => set({ request: null }),
}))
