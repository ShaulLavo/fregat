import { createContext, use } from 'react'
import { useStore } from 'zustand'
import { createStore, type StoreApi as ZustandStoreApi } from 'zustand/vanilla'

import { clientErrors } from '@/lib/structured-errors'

export type PendingMessageFile = {
  readonly path: string
  /** False until the tab exists: the path is recorded a moment before it opens. */
  readonly seenOpen: boolean
}

type StoreState = {
  activeChangeId: string | null
  commitMessage: string
  commitMessageRevision: number
  /** COMMIT_EDITMSG awaiting its commit; closing its tab, once seen open, commits. */
  pendingMessageFile: PendingMessageFile | null
}

type StoreActions = {
  selectChange: (id: string) => void
  applyGeneratedCommitMessage: (message: string, expectedRevision: number) => boolean
  resetCommitMessage: () => void
  setCommitMessage: (message: string) => void
  setPendingMessageFile: (pending: PendingMessageFile | null) => void
}

export type GitStore = StoreState & StoreActions

export type GitStoreApi = ZustandStoreApi<GitStore>

export const StateContext = createContext<GitStoreApi | null>(null)

export function useGitState<T>(selector: (state: GitStore) => T): T {
  const store = useGitStoreApi()

  return useStore(store, selector)
}

export function useGitStoreApi(): GitStoreApi {
  const store = use(StateContext)
  if (!store) {
    throw clientErrors.CONTEXT_MISSING({
      message: 'Git state must be used within GitStateProvider',
    })
  }

  return store
}

export type CommitMessageDraft = {
  readonly read: () => string
  readonly write: (message: string) => void
}

/** `draft` keeps the unsent commit message across reloads; omit it for a throwaway store. */
export function createGitStore(draft?: CommitMessageDraft) {
  const store = createStore<GitStore>()((set, get) => ({
    applyGeneratedCommitMessage: (commitMessage, expectedRevision) => {
      const state = get()
      if (state.commitMessageRevision !== expectedRevision) return false

      set(nextCommitMessageState(state, commitMessage))
      return true
    },
    activeChangeId: null,
    selectChange: (activeChangeId) => set({ activeChangeId }),
    commitMessage: draft?.read() ?? '',
    commitMessageRevision: 0,
    pendingMessageFile: null,
    setPendingMessageFile: (pendingMessageFile) => set({ pendingMessageFile }),
    resetCommitMessage: () => set(nextCommitMessageState(get(), '')),
    setCommitMessage: (commitMessage) => set(nextCommitMessageState(get(), commitMessage)),
  }))
  if (!draft) return store

  store.subscribe((state, previous) => {
    if (state.commitMessage !== previous.commitMessage) draft.write(state.commitMessage)
  })
  return store
}

function nextCommitMessageState(state: StoreState, commitMessage: string) {
  return {
    commitMessage,
    commitMessageRevision: state.commitMessageRevision + 1,
  }
}
