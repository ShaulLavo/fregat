import {
  useChatProjectionStore,
  selectChatProjectionSlice,
} from '@/features/chat/state/chat-projection-store'
import { useSessionActions } from '@/features/chat-mode/hooks/use-session-actions'
import { openSessionRow, startSessionDraft } from '@/features/chat-mode/state/session-commands'
import {
  useSessionRailStore,
  type SessionRenameSurface,
} from '@/features/chat-mode/state/session-rail-store'
import { canStopAgentSession, sessionMenu } from '@/features/chat-mode/utils/session-menu'
import type { SessionRailItem } from '@workspace/client-core/chat/rail/model'

/** `surface` decides which of the two places swaps for a rename field. */
export function useSessionMenu(session: SessionRailItem, surface: SessionRenameSurface) {
  const actions = useSessionActions()
  const scope = useSessionRailStore((state) => state.scope)
  const startRename = useSessionRailStore((state) => state.startRename)
  const setScope = useSessionRailStore((state) => state.setScope)
  // The rail item is a view model and carries no provider session; that comes from
  // the summary the projection already holds.
  const agentSession = useChatProjectionStore(
    (state) =>
      selectChatProjectionSlice(state, session.environmentId).sessionById[session.id]?.runtime,
  )

  return sessionMenu({
    archive: () => actions.archive(session.ref),
    archived: session.archived,
    canStopAgent: canStopAgentSession(agentSession),
    deleteSession: () => actions.deleteSession(session.ref, session.title),
    newSession: () =>
      startSessionDraft(
        { environmentId: session.environmentId, projectId: session.projectId },
        { baseWorktree: { environmentId: session.environmentId, worktreeId: session.worktree.id } },
      ),
    open: () => openSessionRow(session),
    rename: () => startRename({ surface, ref: session.ref }),
    scopedToProject: scope === session.projectId,
    scopeToProject: () => setScope(session.projectId),
    stopAgent: () => actions.stopAgent(session.ref),
    unarchive: () => actions.unarchive(session.ref),
  })
}
