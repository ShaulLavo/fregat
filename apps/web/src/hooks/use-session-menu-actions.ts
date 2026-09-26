import { useIsMutating } from '@tanstack/react-query'
import { useShallow } from 'zustand/react/shallow'
import { effectiveSnoozed } from '@workspace/client-core/chat/rail/snooze'
import type { SessionRailItem } from '@workspace/client-core/chat/rail/model'

import { useSessionActions } from '@/features/chat-mode/hooks/use-session-actions'
import { useSessionTitleActions } from '@/features/chat-mode/hooks/use-session-title-actions'
import { useSessionWake } from '@/features/chat-mode/hooks/use-session-wake'
import {
  useSessionRailStore,
  type SessionRenameSurface,
} from '@/features/chat-mode/state/session-rail-store'
import { sessionLifecyclePolicy } from '@/features/chat-mode/utils/session-lifecycle'
import { chatModeMutationKeys } from '@/features/chat-mode/utils/mutation-keys'
import { primaryQueryClient } from '@/lib/environments/state/query-clients'
import { sessionTitlePolicy } from '@/features/chat-mode/utils/session-title'
import {
  selectChatProjectionSlice,
  useChatProjectionStore,
} from '@/features/chat/state/chat-projection-store'
import {
  copySessionTranscript,
  downloadSessionTranscript,
} from '@/features/chat/state/transcript-export'
import { useCompactSession } from '@/features/chat/hooks/use-compact-session'
import { chatMutationKeys } from '@/features/chat/utils/mutation-keys'
import { copyTextToClipboard } from '@/lib/clipboard'
import { useEnvironmentsStore } from '@/lib/environments/state/store'
import {
  canStopAgentSession,
  type SessionActionsMenuContext,
} from '@/keymap/menus/utils/session-actions-menu'

/**
 * The session actions every surface offers, with one eligibility policy. `surface`
 * names the place that swaps its title for a rename field, so opening Rename from
 * one header never turns another into an input.
 */
export function useSessionMenuActions(
  session: SessionRailItem,
  surface: SessionRenameSurface,
): SessionActionsMenuContext {
  const actions = useSessionActions()
  const titleActions = useSessionTitleActions()
  const requestingTitle =
    useIsMutating({ mutationKey: chatModeMutationKeys.regenerateTitle() }, primaryQueryClient()) > 0
  const pending =
    useIsMutating({ mutationKey: chatModeMutationKeys.lifecycle() }, primaryQueryClient()) > 0
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
  const compact = useCompactSession(session.ref)
  const compacting =
    useIsMutating({ mutationKey: chatMutationKeys.compact(session.environmentId, session.id) }) > 0
  const compactModes = useChatProjectionStore(
    useShallow((state) => {
      const summary = selectChatProjectionSlice(state, session.environmentId).sessionById[
        session.id
      ]
      return {
        interactionMode: summary?.interactionMode ?? null,
        running: summary?.latestTurn?.state === 'running',
        runtimeMode: summary?.runtimeMode ?? null,
      }
    }),
  )
  const hasMessages = useChatProjectionStore((state) =>
    Boolean(
      selectChatProjectionSlice(state, session.environmentId).sessionById[session.id]
        ?.latestUserMessageAt,
    ),
  )
  const { interactionMode, runtimeMode } = compactModes
  // Nothing to compact before the first prompt, and never over a running turn.
  const compactable =
    hasMessages && !compactModes.running && interactionMode && runtimeMode
      ? { interactionMode, runtimeMode }
      : null

  const completedAt = useChatProjectionStore(
    (state) =>
      selectChatProjectionSlice(state, session.environmentId).sessionById[session.id]?.latestTurn
        ?.completedAt,
  )
  const startRename = useSessionRailStore((state) => state.startRename)
  // The rail item is a view model and carries no provider session; that comes from
  // the summary the projection already holds.
  const agentSession = useChatProjectionStore(
    (state) =>
      selectChatProjectionSlice(state, session.environmentId).sessionById[session.id]?.runtime,
  )

  const branch = session.branch
  return {
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
    hasMessages,
    copyTranscript: () => void copySessionTranscript(session.ref),
    exportTranscript: (format) => void downloadSessionTranscript(session.ref, format),
    compact: compactable ? () => compact.mutate(compactable) : null,
    compactPending: compacting,
    canMarkUnread: Boolean(completedAt) && !session.unread,
    woke: wokeAt !== null,
    markUnread: () => actions.markUnread(session.ref),
    acknowledgeWake: () => actions.acknowledgeWake(session.ref),
    archive: () => actions.archive(session.ref),
    archived: session.archived,
    canStopAgent: canStopAgentSession(agentSession),
    deleteSession: () => actions.deleteSession(session.ref, session.title),
    rename: () => startRename({ surface, ref: session.ref }),
    stopAgent: () => actions.stopAgent(session.ref),
    unarchive: () => actions.unarchive(session.ref),
  }
}
