import type { ChatProjectionSlice } from '@workspace/client-core/chat/types'

/** A socket change asks the server to reread its gate; streamed text leaves the signature alone. */
export function restartGateSignature(slice: ChatProjectionSlice | undefined): string {
  return (
    JSON.stringify(
      slice?.sessionIds.map((id) => {
        const session = slice.sessionById[id]
        return [
          id,
          session?.runtime?.status,
          session?.runtime?.activeTurnId,
          session?.latestTurn?.state,
          session?.latestTurn?.providerStartState,
          session?.pendingApprovalCount,
          session?.pendingUserInputCount,
        ]
      }),
    ) ?? ''
  )
}
