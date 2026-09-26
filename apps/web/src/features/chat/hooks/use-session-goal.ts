import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { ScopedSessionRef } from '@workspace/contracts'

import {
  selectChatProjectionSlice,
  useChatProjectionStore,
} from '@/features/chat/state/chat-projection-store'
import { fetchSessionGoal } from '@/features/chat/transport/session-goal'
import { sessionGoalKeys } from '@/features/chat/utils/query-keys'

/** Tokens and time move while a goal runs; a slow re-read keeps them near. */
const ACTIVE_GOAL_REFRESH_MS = 30_000

export function useSessionGoal(ref: ScopedSessionRef) {
  const turnStamp = useChatProjectionStore((state) => {
    const turn = selectChatProjectionSlice(state, ref.environmentId).sessionById[ref.sessionId]
      ?.latestTurn
    return turn ? `${turn.turnId}:${turn.state}` : 'none'
  })
  return useQuery({
    queryKey: sessionGoalKeys.state(ref.environmentId, ref.sessionId, turnStamp),
    queryFn: ({ signal }) => fetchSessionGoal(ref, signal),
    placeholderData: keepPreviousData,
    refetchInterval: (query) =>
      query.state.data?.goal?.status === 'active' ? ACTIVE_GOAL_REFRESH_MS : false,
  })
}
