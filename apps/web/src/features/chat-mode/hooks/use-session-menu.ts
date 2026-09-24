import type { SessionRailItem } from '@workspace/client-core/chat/rail/model'

import { useSessionMenuActions } from '@/hooks/use-session-menu-actions'
import { openSessionRow, startSessionDraft } from '@/features/chat-mode/state/session-commands'
import { useSessionRailStore } from '@/features/chat-mode/state/session-rail-store'
import { sessionMenu } from '@/features/chat-mode/utils/session-menu'

/** The rail row's menu: the shared session actions plus open, draft and project filter. */
export function useSessionMenu(session: SessionRailItem) {
  const actions = useSessionMenuActions(session, 'rail')
  const scope = useSessionRailStore((state) => state.scope)
  const setScope = useSessionRailStore((state) => state.setScope)

  return sessionMenu({
    ...actions,
    newSession: () =>
      startSessionDraft(
        { environmentId: session.environmentId, projectId: session.projectId },
        { baseWorktree: { environmentId: session.environmentId, worktreeId: session.worktree.id } },
      ),
    open: () => openSessionRow(session),
    scopedToProject: scope === session.projectGroupKey,
    scopeToProject: () => setScope(session.projectGroupKey),
  })
}
