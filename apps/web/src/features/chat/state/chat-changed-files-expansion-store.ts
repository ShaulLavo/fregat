import { pruneScopedRecord } from '@/features/chat/utils/scoped-record'
import type { EnvironmentId } from '@workspace/contracts'
import { createEnvironmentRecordPersistence } from '@/lib/environments/state/record-persistence'
import type { ScopedStorage } from '@/lib/environments/state/scoped-storage'
import { create } from 'zustand'

import {
  nextChatChangedFilesExpansionStamp,
  pruneChatChangedFilesExpansion,
  readPersistedChatChangedFilesExpansion,
  writePersistedChatChangedFilesExpansion,
  type PersistedChatChangedFilesExpansion,
} from '@/features/chat/utils/changed-files-expansion-storage'
import type { ChatTurnDiffSummary } from '@workspace/client-core/chat/types'

export type ChatChangedFilesExpansion = PersistedChatChangedFilesExpansion

type ChatChangedFilesExpansionChanges = Partial<
  Pick<ChatChangedFilesExpansion, 'cardExpanded' | 'directoriesExpanded'>
>

/**
 * Changed-files cards render inside the virtualized timeline, so a card that
 * scrolls out of overscan unmounts — expansion cannot be component state. It
 * also has to survive a reload: reopening a session to find every card back at
 * its default is the same lost place as scrolling back to the top.
 */
type ChatChangedFilesExpansionStore = {
  expansionByKey: Record<string, ChatChangedFilesExpansion>
  setCardExpanded: (expansionKey: string, expanded: boolean) => void
  setDirectoriesExpanded: (expansionKey: string, expanded: boolean) => void
}

const UNSET_EXPANSION: ChatChangedFilesExpansion = {
  cardExpanded: null,
  directoriesExpanded: null,
  updatedAt: 0,
}

const expansionPersistence = createEnvironmentRecordPersistence<ChatChangedFilesExpansion>({
  read: (storage) => readPersistedChatChangedFilesExpansion(storage).expansionByKey,
  write: writePersistedChatChangedFilesExpansion,
})

export const useChatChangedFilesExpansionStore = create<ChatChangedFilesExpansionStore>((set) => ({
  expansionByKey: {},
  setCardExpanded: (expansionKey, cardExpanded) => {
    set((state) => withExpansion(state, expansionKey, { cardExpanded }))
    persistChatChangedFilesExpansion()
  },
  setDirectoriesExpanded: (expansionKey, directoriesExpanded) => {
    set((state) => withExpansion(state, expansionKey, { directoriesExpanded }))
    persistChatChangedFilesExpansion()
  },
}))

export function chatChangedFilesExpansionKey(
  environmentId: EnvironmentId,
  summary: ChatTurnDiffSummary,
) {
  return `${environmentId}:${summary.sessionId}:${summary.turnId}`
}

export function hydrateChatChangedFilesExpansionStoreFromStorage(storage: ScopedStorage) {
  const expansionByKey = expansionPersistence.hydrate(
    storage,
    useChatChangedFilesExpansionStore.getState().expansionByKey,
  )
  useChatChangedFilesExpansionStore.setState({ expansionByKey })
}

export function resetChatChangedFilesExpansionStore() {
  useChatChangedFilesExpansionStore.setState({ expansionByKey: {} })
}

function persistChatChangedFilesExpansion() {
  expansionPersistence.persist(useChatChangedFilesExpansionStore.getState().expansionByKey)
}

function withExpansion(
  state: ChatChangedFilesExpansionStore,
  expansionKey: string,
  changes: ChatChangedFilesExpansionChanges,
) {
  const current = state.expansionByKey[expansionKey] ?? UNSET_EXPANSION

  return {
    expansionByKey: pruneScopedRecord(
      {
        ...state.expansionByKey,
        [expansionKey]: {
          ...current,
          ...changes,
          updatedAt: nextChatChangedFilesExpansionStamp(state.expansionByKey),
        },
      },
      pruneChatChangedFilesExpansion,
    ),
  }
}
