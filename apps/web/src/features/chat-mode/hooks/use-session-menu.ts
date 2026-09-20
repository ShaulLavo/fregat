import { useSessionTitleActions } from '@/features/chat-mode/hooks/use-session-title-actions'
import { sessionTitlePolicy } from '@/features/chat-mode/utils/session-title'
import { copyTextToClipboard } from '@/lib/clipboard'
import { useShallow } from 'zustand/react/shallow'
import { useIsMutating } from '@tanstack/react-query'
import { useEnvironmentsStore } from '@/lib/environments/state/store'
import { sessionLifecyclePolicy } from '@/features/chat-mode/utils/session-lifecycle'
import { chatModeMutationKeys } from '@/features/chat-mode/utils/mutation-keys'
import { effectiveSnoozed } from '@workspace/client-core/chat/rail/snooze'
import { useSessionWake } from '@/features/chat-mode/hooks/use-session-wake'
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
  const titleActions = useSessionTitleActions()
  const requestingTitle = useIsMutating({ mutationKey: chatModeMutationKeys.regenerateTitle() }) > 0
  const pending = useIsMutating({ mutationKey: chatModeMutationKeys.lifecycle() }) > 0
  const owner = useEnvironmentsStore((state) =>
    Object.values(state.entries).find((entry) => entry.environmentId === session.environmentId),
  )
  const policy = useChatProjectionStore(
    useShallow((state) => {
      const slice = selectChatProjectionSlice(state, session.environmentId)
      const summary = slice.sessionById[session.id]
      return {
        ...sessionLifecyclePolicy(
          summary,
          owner,
          Object.values(slice.activityBySessionId[session.id] ?? {}),
        ),
        titleSupported: sessionTitlePolicy(summary, owner).supported,
        titlePending: Boolean(summary?.titleRegeneration),
        titleError: summary?.titleGenerationError ?? null,
        settled: summary?.settledOverride === 'settled',
        snoozed: summary ? effectiveSnoozed(summary, Date.now()) : false,
        pinned: Boolean(summary?.pinnedAt),
      }
    }),
  )
  const wokeAt = useSessionWake(session.ref)
  const completedAt = useChatProjectionStore(
    (state) =>
      selectChatProjectionSlice(state, session.environmentId).sessionById[session.id]?.latestTurn
        ?.completedAt,
  )
  const scope = useSessionRailStore((state) => state.scope)
  const startRename = useSessionRailStore((state) => state.startRename)
  const setScope = useSessionRailStore((state) => state.setScope)
  // The rail item is a view model and carries no provider session; that comes from
  // the summary the projection already holds.
  const agentSession = useChatProjectionStore(
    (state) =>
      selectChatProjectionSlice(state, session.environmentId).sessionById[session.id]?.runtime,
  )

  const branch = session.branch
  return sessionMenu({
    titleGeneration: {
      supported: policy.titleSupported,
      pending: policy.titlePending,
      requesting: requestingTitle,
      error: policy.titleError,
      regenerate: () => titleActions.mutate([session.ref]),
    },
    lifecycle: {
      ...policy,
      pending,
      settle: () => void actions.applyLifecycle(session.ref, { type: 'settle' }),
      unsettle: () => void actions.applyLifecycle(session.ref, { type: 'unsettle' }),
      requestSnooze: () => actions.requestSnooze([session.ref], session.title),
      unsnooze: () => void actions.applyLifecycle(session.ref, { type: 'unsnooze' }),
      pin: () => void actions.applyLifecycle(session.ref, { type: 'pin' }),
      unpin: () => void actions.applyLifecycle(session.ref, { type: 'unpin' }),
    },
    copyPath: () => void copyTextToClipboard(session.worktreePath, 'path'),
    copyBranch: branch ? () => void copyTextToClipboard(branch, 'branch') : null,
    copySessionId: () => void copyTextToClipboard(session.id, 'session ID'),
    canMarkUnread: Boolean(completedAt) && !session.unread,
    woke: wokeAt !== null,
    markUnread: () => actions.markUnread(session.ref),
    acknowledgeWake: () => actions.acknowledgeWake(session.ref),
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
    scopedToProject: scope === session.projectGroupKey,
    scopeToProject: () => setScope(session.projectGroupKey),
    stopAgent: () => actions.stopAgent(session.ref),
    unarchive: () => actions.unarchive(session.ref),
  })
}
