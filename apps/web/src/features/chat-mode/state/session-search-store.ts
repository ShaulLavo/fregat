import { create } from 'zustand'
import type { SessionSearchMatches } from '@workspace/client-core/chat/rail/model'

export type SessionSearchResult = {
  readonly matchBySessionKey: SessionSearchMatches
  readonly searching: boolean
  readonly unavailable: readonly string[]
}

type SessionSearchStore = SessionSearchResult & {
  readonly matchedQuery: string
  readonly generation: number
  readonly begin: (query: string, searching: boolean) => number
  readonly publish: (generation: number, result: SessionSearchResult) => void
}

export const useSessionSearchStore = create<SessionSearchStore>()((set, get) => ({
  matchBySessionKey: {},
  matchedQuery: '',
  searching: false,
  unavailable: [],
  generation: 0,
  begin: (query, searching) => {
    const generation = get().generation + 1
    set({ generation, matchedQuery: query, searching, matchBySessionKey: {}, unavailable: [] })
    return generation
  },
  publish: (generation, result) => {
    if (get().generation !== generation) return
    set(result)
  },
}))
