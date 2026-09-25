import { type ReactNode } from 'react'

import { useOpenCheckpointDiffDocument } from '@/features/chat/hooks/use-open-checkpoint-diff-document'
import {
  ChatTimelineActionsContext,
  type ChatTimelineActions,
  type TurnRetryActions,
} from '@/features/chat/providers/timeline-actions-context'

export function ChatTimelineActionsProvider({
  children,
  retry,
  revertToCheckpoint,
}: {
  readonly children: ReactNode
  readonly retry: TurnRetryActions
  readonly revertToCheckpoint: (turnCount: number, messageId: string) => void
}) {
  const { openCheckpointDiff, openFullSessionCheckpointDiff } = useOpenCheckpointDiffDocument()
  // Context value stability keeps message rows from repainting on unrelated chat chrome changes.
  const value: ChatTimelineActions = {
    openCheckpointDiff,
    openSessionCheckpointDiff: openFullSessionCheckpointDiff,
    retry,
    revertToCheckpoint,
  }

  return <ChatTimelineActionsContext value={value}>{children}</ChatTimelineActionsContext>
}
