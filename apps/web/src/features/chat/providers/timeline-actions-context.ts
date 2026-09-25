import { createContext } from 'react'

import type { ChatTurnDiffSummary } from '@workspace/client-core/chat/types'

export type ChatTimelineActions = {
  readonly openCheckpointDiff: (
    summary: ChatTurnDiffSummary,
    path?: string,
  ) => Promise<unknown> | unknown
  readonly openSessionCheckpointDiff: (summary: ChatTurnDiffSummary) => Promise<unknown> | unknown
  readonly revertToCheckpoint: (turnCount: number, messageId: string) => void
  /** Carry on and Try again for the latest turn that stopped short. */
  readonly retry: TurnRetryActions
}

export type TurnRetryActions = {
  readonly blocked: boolean
  readonly carryOn: () => void
  /** Null when the stopped turn has no user message to send again. */
  readonly tryAgain: (() => void) | null
}

export const ChatTimelineActionsContext = createContext<ChatTimelineActions | null>(null)
