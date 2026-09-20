import { createEnvironmentRecordPersistence } from '@/lib/environments/state/record-persistence'
import type { ScopedStorage } from '@/lib/environments/state/scoped-storage'
import { scopedSessionKey, type ScopedSessionRef } from '@workspace/contracts'
import { Debouncer } from '@tanstack/react-pacer/debouncer'
import { create } from 'zustand'

import {
  readPersistedSessionReads,
  writePersistedSessionReads,
} from '@/features/chat-mode/utils/session-read-storage'
import {
  advanceSessionVisit,
  unreadSessionVisit,
  type SessionSeenStamps,
} from '@workspace/client-core/chat/rail/unread'

const SESSION_READ_PERSIST_DEBOUNCE_MS = 300

type SessionReadStore = {
  readonly seenBySessionKey: SessionSeenStamps
  readonly markSeen: (ref: ScopedSessionRef, visitedAt: string) => void
  readonly markUnread: (ref: ScopedSessionRef, completedAt: string | null) => void
}

const readPersist = new Debouncer(() => flushSessionReadStorage(), {
  wait: SESSION_READ_PERSIST_DEBOUNCE_MS,
})

const sessionReadPersistence = createEnvironmentRecordPersistence<string>({
  read: (storage) => readPersistedSessionReads(storage),
  write: writePersistedSessionReads,
})

export const useSessionReadStore = create<SessionReadStore>()((set, get) => ({
  markSeen: (ref, visitedAt) => {
    const sessionId = scopedSessionKey(ref)
    const previous = get().seenBySessionKey[sessionId]
    const next = advanceSessionVisit(previous, visitedAt)
    if (!next || next === previous) return

    set((state) => ({
      seenBySessionKey: { ...state.seenBySessionKey, [sessionId]: next },
    }))
    readPersist.maybeExecute()
  },
  markUnread: (ref, completedAt) => {
    const key = scopedSessionKey(ref)
    const stamp = unreadSessionVisit(completedAt)
    if (!stamp || stamp === get().seenBySessionKey[key]) return
    set((state) => ({ seenBySessionKey: { ...state.seenBySessionKey, [key]: stamp } }))
    readPersist.maybeExecute()
  },
  seenBySessionKey: {},
}))

function flushSessionReadStorage() {
  readPersist.cancel()
  sessionReadPersistence.persist(useSessionReadStore.getState().seenBySessionKey)
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('beforeunload', () => {
    flushSessionReadStorage()
  })
}

export function hydrateSessionReadStore(storage: ScopedStorage) {
  const seenBySessionKey = sessionReadPersistence.hydrate(
    storage,
    useSessionReadStore.getState().seenBySessionKey,
  )
  useSessionReadStore.setState({ seenBySessionKey })
}
