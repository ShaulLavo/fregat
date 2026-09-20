import { selectChatSessions } from '@workspace/client-core/chat/selectors'
import { compareSessionsByActivity } from '@workspace/client-core/chat/rail/session-order'
import { scopedPaletteFilter } from '@workspace/client-core/commands/palette'
import type { ChatProjectionSlice } from '@workspace/client-core/chat/types'

export function sessionAccessRows(
  projection: ChatProjectionSlice,
  query: string,
  sortOrder: 'updated_at' | 'created_at',
) {
  return selectChatSessions(projection)
    .map((session) => ({
      session,
      score: scopedPaletteFilter(session.id, query, [
        session.title,
        session.worktree.path,
        session.project.title,
        session.worktree.branch ?? '',
      ]),
    }))
    .filter((row) => row.score > 0)
    .toSorted(
      (left, right) =>
        right.score - left.score ||
        compareSessionsByActivity(
          projection.sessionById[left.session.id]!,
          projection.sessionById[right.session.id]!,
          sortOrder,
        ),
    )
    .map(({ session }) => ({
      name: session.title,
      description: [
        session.project.title,
        session.attentionState,
        session.archivedAt && 'archived',
        session.origin === 'discovered' && 'imported',
        session.worktree.branch ?? session.worktree.path,
      ]
        .filter(Boolean)
        .join(' · '),
      value: { action: { kind: 'session' as const, sessionId: session.id }, reason: null },
    }))
}
