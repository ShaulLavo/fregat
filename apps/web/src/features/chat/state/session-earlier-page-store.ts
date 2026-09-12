import { scopedSessionKey, type ScopedSessionRef } from '@workspace/contracts'
import { create } from 'zustand'

/**
 * Per-session state of the "load earlier" walk. Separate from the projection
 * store because it is request state, not projected truth: a failed page must be
 * reportable and retryable without ever touching the transcript.
 */
export type SessionEarlierPageState = {
  error: string | null
  pending: boolean
}

/** Shared identity so a session that has never paged never re-renders on this. */
const IDLE_SESSION_EARLIER_PAGE: SessionEarlierPageState = {
  error: null,
  pending: false,
}

type SessionEarlierPageStore = {
  clearSessionEarlierPage: (ref: ScopedSessionRef) => void
  setSessionEarlierPage: (ref: ScopedSessionRef, next: SessionEarlierPageState) => void
  stateBySessionId: Record<string, SessionEarlierPageState>
}

export const useSessionEarlierPageStore = create<SessionEarlierPageStore>((set) => ({
  clearSessionEarlierPage: (ref) =>
    set((state) => {
      const sessionId = scopedSessionKey(ref)
      if (state.stateBySessionId[sessionId] === undefined) return state

      const { [sessionId]: _removed, ...rest } = state.stateBySessionId

      return { stateBySessionId: rest }
    }),
  setSessionEarlierPage: (ref, next) =>
    set((state) => {
      const sessionId = scopedSessionKey(ref)
      const current = state.stateBySessionId[sessionId]
      if (current?.error === next.error && current?.pending === next.pending) return state

      return { stateBySessionId: { ...state.stateBySessionId, [sessionId]: next } }
    }),
  stateBySessionId: {},
}))

export function selectSessionEarlierPage(
  state: Pick<SessionEarlierPageStore, 'stateBySessionId'>,
  ref: ScopedSessionRef | null | undefined,
): SessionEarlierPageState {
  if (!ref) return IDLE_SESSION_EARLIER_PAGE

  return state.stateBySessionId[scopedSessionKey(ref)] ?? IDLE_SESSION_EARLIER_PAGE
}

export function resetSessionEarlierPageStore() {
  useSessionEarlierPageStore.setState({ stateBySessionId: {} })
}
