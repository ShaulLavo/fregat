import {
  scopedSessionKey,
  type EnvironmentId,
  type OrchestrationSessionSearchMatch,
} from '@workspace/contracts'
import { create } from 'zustand'
import type { SessionSearchMatches } from '@workspace/client-core/chat/rail/model'
type SessionSearchStore = {
  readonly matchBySessionKey: SessionSearchMatches
  readonly matchedQuery: string
  readonly searching: boolean
  readonly sync: (input: {
    environmentId: EnvironmentId
    matches: readonly OrchestrationSessionSearchMatch[]
    query: string
    searching: boolean
  }) => void
}
export const useSessionSearchStore = create<SessionSearchStore>()((set) => ({
  matchBySessionKey: {},
  matchedQuery: '',
  searching: false,
  sync: ({ environmentId, matches, query, searching }) =>
    set((state) => {
      const kept =
        state.matchedQuery === query
          ? Object.fromEntries(
              Object.entries(state.matchBySessionKey).filter(
                ([key]) => !key.startsWith(`${environmentId}:`),
              ),
            )
          : {}
      const own = Object.fromEntries(
        matches.map((match) => [
          scopedSessionKey({ environmentId, sessionId: match.sessionId }),
          match,
        ]),
      )
      return { matchBySessionKey: { ...kept, ...own }, matchedQuery: query, searching }
    }),
}))
