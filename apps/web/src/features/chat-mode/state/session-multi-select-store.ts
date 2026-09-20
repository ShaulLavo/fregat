import { scopedSessionKey, type ScopedSessionRef } from '@workspace/contracts'
import { create } from 'zustand'
type SessionMultiSelectStore = {
  readonly anchor: ScopedSessionRef | null
  readonly refs: readonly ScopedSessionRef[]
  readonly clear: () => void
  readonly extendTo: (ref: ScopedSessionRef, ordered: readonly ScopedSessionRef[]) => void
  readonly markOnly: (ref: ScopedSessionRef) => void
  readonly toggle: (ref: ScopedSessionRef) => void
}
export const useSessionMultiSelectStore = create<SessionMultiSelectStore>()((set) => ({
  anchor: null,
  refs: [],
  clear: () => set({ anchor: null, refs: [] }),
  markOnly: (ref) => set({ anchor: ref, refs: [ref] }),
  toggle: (ref) =>
    set((state) => ({
      anchor: ref,
      refs: state.refs.some((entry) => scopedSessionKey(entry) === scopedSessionKey(ref))
        ? state.refs.filter((entry) => scopedSessionKey(entry) !== scopedSessionKey(ref))
        : [...state.refs, ref],
    })),
  extendTo: (ref, ordered) =>
    set((state) => {
      const target = ordered.findIndex((entry) => scopedSessionKey(entry) === scopedSessionKey(ref))
      if (target < 0) return {}
      const anchorKey = state.anchor ? scopedSessionKey(state.anchor) : null
      const anchor = ordered.findIndex((entry) => scopedSessionKey(entry) === anchorKey)
      return {
        anchor: state.anchor ?? ref,
        refs:
          anchor < 0
            ? [ref]
            : ordered.slice(Math.min(anchor, target), Math.max(anchor, target) + 1),
      }
    }),
}))
export function isSessionBulkSelection(refs: readonly ScopedSessionRef[]) {
  return refs.length > 1
}

export function removeSuccessfulSelection(refs: readonly ScopedSessionRef[]) {
  const removed = new Set(refs.map(scopedSessionKey))
  useSessionMultiSelectStore.setState((state) => {
    const remaining = state.refs.filter((ref) => !removed.has(scopedSessionKey(ref)))
    return { refs: remaining, anchor: remaining[0] ?? null }
  })
}
