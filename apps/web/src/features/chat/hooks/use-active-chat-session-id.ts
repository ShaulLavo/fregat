import { useApplicationRuntime } from '@/hooks/use-application-runtime'
import { selectWorktreeAtPath } from '@workspace/client-core/chat/selectors'
import {
  selectChatProjectionSlice,
  useChatProjectionStore,
} from '@/features/chat/state/chat-projection-store'
import { confirmedEnvironmentOrigin } from '@/lib/environments/state/domain'
import {
  scopedSessionKey,
  type EnvironmentId,
  type ProjectId,
  type SessionId,
} from '@workspace/contracts'
import { useEffect, useRef } from 'react'
import { useNavigation } from '@/hooks/use-navigation'
import { useSidebarSelectionStore } from '@/features/chat/state/sidebar-selection-store'

export function useActiveChatSessionId({
  sessionIds,
  environmentId,
  projectId,
}: {
  readonly sessionIds: readonly SessionId[]
  readonly environmentId: EnvironmentId
  readonly projectId: ProjectId | undefined
}) {
  const navigation = useNavigation()
  const application = useApplicationRuntime()
  const selection = useSidebarSelectionStore((state) => state.selection)
  const selectedWasAvailable = useRef<string | null>(null)
  const scoped =
    selection.kind !== 'auto' &&
    selection.environmentId === environmentId &&
    selection.projectId === projectId
  const selectedSessionId = scoped && selection.kind === 'session' ? selection.sessionId : null
  const selectedKey = selectedSessionId
    ? scopedSessionKey({ environmentId, sessionId: selectedSessionId })
    : null
  const draft = scoped && selection.kind === 'draft'
  const activeSessionId = draft ? null : (selectedSessionId ?? sessionIds[0] ?? null)

  useEffect(() => {
    if (!selectedSessionId || !projectId) return
    if (sessionIds.includes(selectedSessionId)) {
      selectedWasAvailable.current = selectedKey
      return
    }
    if (selectedWasAvailable.current !== selectedKey) return
    selectedWasAvailable.current = null
    void navigation.reconcileSessions({
      environmentId,
      projectId,
      removedSessionIds: [selectedSessionId],
      successorSessionId: sessionIds[0] ?? null,
    })
  }, [environmentId, navigation, projectId, selectedKey, selectedSessionId, sessionIds])

  function selectSession(sessionId: SessionId, replace = false) {
    if (!projectId) return
    void navigation.openChat({ environmentId, projectId, sessionId, surface: 'sidebar', replace })
  }

  function promoteDraftSession(sessionId: SessionId) {
    const current = useSidebarSelectionStore.getState().selection
    if (
      current.kind !== 'auto' &&
      (current.kind !== 'draft' ||
        current.environmentId !== environmentId ||
        current.projectId !== projectId)
    )
      return
    if (activeSessionId !== null) return
    const owner = application.getSnapshot()
    if (!owner || owner.origin !== confirmedEnvironmentOrigin(environmentId)) return
    const root = owner.editor.workspaceStore.getState().rootFolder?.path
    const slice = selectChatProjectionSlice(useChatProjectionStore.getState(), environmentId)
    if (root === undefined || selectWorktreeAtPath(slice, root)?.projectId !== projectId) return
    selectSession(sessionId, true)
  }

  return {
    activeSessionId,
    promoteDraftSession,
    selectDraftSession: () => {
      if (!projectId) return
      void navigation.openChat({
        environmentId,
        projectId,
        sessionId: null,
        surface: 'sidebar',
        newDraft: true,
      })
    },
    setActiveSessionId: (sessionId: SessionId) => selectSession(sessionId),
  }
}
