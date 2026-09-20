import { createContext, use } from 'react'
import { useStore } from 'zustand'
import { createStore, type StoreApi as ZustandStoreApi } from 'zustand/vanilla'

import { clientErrors } from '@/lib/structured-errors'

type StoreState = {
  activeChangeId: string | null
  commitMessage: string
  commitMessageRevision: number
}

type StoreActions = {
  selectChange: (id: string) => void
  applyGeneratedCommitMessage: (message: string, expectedRevision: number) => boolean
  resetCommitMessage: () => void
  setCommitMessage: (message: string) => void
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

export function createGitStore() {
  return createStore<GitStore>()((set, get) => ({
    applyGeneratedCommitMessage: (commitMessage, expectedRevision) => {
      const state = get()
      if (state.commitMessageRevision !== expectedRevision) return false

      set(nextCommitMessageState(state, commitMessage))
      return true
    },
    activeChangeId: null,
    selectChange: (activeChangeId) => set({ activeChangeId }),
    commitMessage: '',
    commitMessageRevision: 0,
    resetCommitMessage: () => set(nextCommitMessageState(get(), '')),
    setCommitMessage: (commitMessage) => set(nextCommitMessageState(get(), commitMessage)),
  }))
}

function nextCommitMessageState(state: StoreState, commitMessage: string) {
  return {
    commitMessage,
    commitMessageRevision: state.commitMessageRevision + 1,
  }
}
