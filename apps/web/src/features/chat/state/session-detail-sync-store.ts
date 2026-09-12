import { scopedSessionKey, type ScopedSessionRef } from '@workspace/contracts'
import { create } from 'zustand'

/**
 * Per-session transport health, written by the session detail subscription cache.
 * The global shell status only says whether *some* frame arrived; a session whose
 * own stream died mid-turn needs its own signal so the UI can say so.
 */
export type SessionDetailSyncStatus = 'blocked' | 'connecting' | 'idle' | 'live' | 'reconnecting'

export type SessionDetailSyncState = {
  /** Consecutive failed attempts. Zero while live. */
  attempt: number
  error: string | null
  status: SessionDetailSyncStatus
}

/** Shared identity so selectors for unsubscribed sessions never re-render. */
const IDLE_SESSION_DETAIL_SYNC: SessionDetailSyncState = {
  attempt: 0,
  error: null,
  status: 'idle',
}

type SessionDetailSyncStore = {
  clearSessionDetailSync: (ref: ScopedSessionRef) => void
  setSessionDetailSync: (ref: ScopedSessionRef, sync: SessionDetailSyncState) => void
  syncBySessionId: Record<string, SessionDetailSyncState>
}

export const useSessionDetailSyncStore = create<SessionDetailSyncStore>((set) => ({
  clearSessionDetailSync: (ref) =>
    set((state) => {
      const sessionId = scopedSessionKey(ref)
      if (state.syncBySessionId[sessionId] === undefined) return state

      const { [sessionId]: _removed, ...rest } = state.syncBySessionId

      return { syncBySessionId: rest }
    }),
  setSessionDetailSync: (ref, sync) =>
    set((state) => {
      const sessionId = scopedSessionKey(ref)
      const current = state.syncBySessionId[sessionId]
      if (isSameSessionDetailSync(current, sync)) return state

      return { syncBySessionId: { ...state.syncBySessionId, [sessionId]: sync } }
    }),
  syncBySessionId: {},
}))

export function selectSessionDetailSync(
  state: Pick<SessionDetailSyncStore, 'syncBySessionId'>,
  ref: ScopedSessionRef | null | undefined,
): SessionDetailSyncState {
  if (!ref) return IDLE_SESSION_DETAIL_SYNC

  return state.syncBySessionId[scopedSessionKey(ref)] ?? IDLE_SESSION_DETAIL_SYNC
}

function isSameSessionDetailSync(
  current: SessionDetailSyncState | undefined,
  next: SessionDetailSyncState,
) {
  if (!current) return false

  return (
    current.attempt === next.attempt &&
    current.error === next.error &&
    current.status === next.status
  )
}
