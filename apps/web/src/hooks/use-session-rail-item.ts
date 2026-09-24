import type { EnvironmentId } from '@workspace/contracts'
import { scopedSessionKey } from '@workspace/contracts'
import type { ChatSession } from '@workspace/client-core/chat/types'
import { deriveProjectGroupKey } from '@workspace/client-core/chat/rail/project-grouping'
import { sessionRailItem, type SessionRailItem } from '@workspace/client-core/chat/rail/model'
import {
  sessionSortTimestamp,
  settledSessionTimestamp,
} from '@workspace/client-core/chat/rail/session-order'

import { useSessionReadStore } from '@/features/chat-mode/state/session-read-store'
import { useSettingValue } from '@/hooks/use-setting-value'

/**
 * The rail's view of one session, for a surface that shows it outside the rail:
 * the stage header and the sidebar chat header act on the same item a row does.
 */
export function useSessionRailItem(
  summary: ChatSession | null,
  environmentId: EnvironmentId,
): SessionRailItem | null {
  const groupingMode = useSettingValue('chat.projectGrouping')
  const groupingOverrides = useSettingValue('chat.projectGroupingOverrides')
  const seenBySessionKey = useSessionReadStore((state) => state.seenBySessionKey)
  if (!summary) return null

  const row = sessionRailItem(
    {
      ...summary,
      activityAt: summary.updatedAt,
      settledOrderAt: settledSessionTimestamp(summary),
      createdSortAt: sessionSortTimestamp(summary, 'created_at'),
      updatedSortAt: sessionSortTimestamp(summary, 'updated_at'),
    },
    environmentId,
    null,
    seenBySessionKey[scopedSessionKey({ environmentId, sessionId: summary.id })],
  )
  return {
    ...row,
    projectGroupKey: deriveProjectGroupKey(
      { environmentId, projectId: summary.project.id },
      summary.project.repositoryIdentity,
      { mode: groupingMode, overrides: groupingOverrides },
    ),
  }
}
