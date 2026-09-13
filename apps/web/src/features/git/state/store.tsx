import { createContext, use } from 'react'
import { useStore } from 'zustand'
import { createStore, type StoreApi as ZustandStoreApi } from 'zustand/vanilla'

import { clientErrors } from '@/lib/structured-errors'
import type { PanelSection } from '@/features/git/utils/types'

type StoreState = {
  commitMessage: string
  commitMessageRevision: number
  sectionOpen: Record<PanelSection, boolean>
}

type StoreActions = {
  applyGeneratedCommitMessage: (message: string, expectedRevision: number) => boolean
  resetCommitMessage: () => void
  setCommitMessage: (message: string) => void
  setSectionOpen: (section: PanelSection, open: boolean) => void
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
    commitMessage: '',
    commitMessageRevision: 0,
    sectionOpen: {
      staged: true,
      worktree: true,
    },
    resetCommitMessage: () => set(nextCommitMessageState(get(), '')),
    setCommitMessage: (commitMessage) => set(nextCommitMessageState(get(), commitMessage)),
    setSectionOpen: (section, open) =>
      set((state) => ({
        sectionOpen: {
          ...state.sectionOpen,
          [section]: open,
        },
      })),
  }))
}

function nextCommitMessageState(state: StoreState, commitMessage: string) {
  return {
    commitMessage,
    commitMessageRevision: state.commitMessageRevision + 1,
  }
}
