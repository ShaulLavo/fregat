import { createContext } from 'react'

import type { ChatTurnDiffSummary } from '@workspace/client-core/chat/types'

export type ChatTimelineActions = {
  readonly openCheckpointDiff: (
    summary: ChatTurnDiffSummary,
    path?: string,
  ) => Promise<unknown> | unknown
  readonly openSessionCheckpointDiff: (summary: ChatTurnDiffSummary) => Promise<unknown> | unknown
  readonly revertToCheckpoint: (turnCount: number, messageId: string) => void
}

export const ChatTimelineActionsContext = createContext<ChatTimelineActions | null>(null)
