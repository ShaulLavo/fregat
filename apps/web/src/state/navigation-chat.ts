import { editorDocumentToken } from '@workspace/client-core/address/grammar'
import type { ChatReference } from '@workspace/client-core/address/references'
import {
  selectCurrentWorktree,
  selectSessionOwnership,
  selectWorktreeAtPath,
} from '@workspace/client-core/chat/selectors'
import { workspaceToken } from '@workspace/client-core/address/workspace'
import { registerWorkspaceAddress } from '@workspace/client-core/files/workspace-address'
import { syncChatProjectionShellSnapshot } from '@workspace/client-core/chat/writers'
import type { ChatProjectionSlice } from '@workspace/client-core/chat/types'
import type {
  EnvironmentId,
  OrchestrationShellSnapshot,
  OrchestrationWorktreeShell,
  ProjectId,
  SessionId,
  WorktreeId,
} from '@workspace/contracts'
import { useSessionSelectionStore } from '@/features/chat-mode/state/session-selection-store'
import {
  useChatProjectionStore,
  selectChatProjectionSlice,
} from '@/features/chat/state/chat-projection-store'
import { confirmedEnvironmentId, confirmedEnvironmentOrigin } from '@/lib/environments/state/domain'
import { clientForQueryClient, queryClientFor } from '@/lib/environments/state/query-clients'
import { createClientInvariantError } from '@/lib/structured-errors'
import type { ApplicationRuntime } from '@/state/application-runtime'
import type { createNavigationCoordinator, NavigationResult } from '@/state/navigation-coordinator'
import { workspaceAddressFor } from '@/state/navigation-workspace'
import { fetchOrchestrationShellSnapshotHttp } from '@/features/chat/transport/orchestration-http-snapshots'

export function createChatNavigation(coordinator: ReturnType<typeof createNavigationCoordinator>) {
  function openChat({
    environmentId,
    sessionId,
    projectId,
    worktreeId,
    surface,
    replace = false,
    newDraft = false,
  }: {
    readonly environmentId: EnvironmentId
    readonly sessionId: SessionId | null
    readonly projectId?: ProjectId
    readonly worktreeId?: WorktreeId
    readonly surface: 'main' | 'sidebar'
    readonly replace?: boolean
    readonly newDraft?: boolean
  }) {
    if (
      surface === 'sidebar' &&
      !sidebarOwnerMatches(coordinator.getApplication(), environmentId, projectId)
    )
      return supersededNavigation()
    return coordinator.request(async ({ application, address, signal, isCurrent }) => {
      const token = sessionId ? `t/${sessionId}` : 't/new'
      const origin = confirmedEnvironmentOrigin(environmentId)
      if (surface === 'sidebar') {
        if (confirmedEnvironmentId(application.getSnapshot().origin) !== environmentId)
          throw createClientInvariantError(
            'A sidebar conversation must belong to the active environment.',
          )
        const sidebarChat: ChatReference = sessionId
          ? { kind: 'session', sessionId }
          : { kind: 'draft' }
        return {
          address: { ...address, chat: token, side: 'chat' },
          replace,
          historyTarget: { kind: 'sidebar-chat', chat: sidebarChat },
        }
      }
      const { slice, snapshot } = await chatProjectionForNavigation(
        environmentId,
        sessionId,
        signal,
      )
      if (!isCurrent()) return { address, replace }
      const ownership = sessionId ? selectSessionOwnership(slice, sessionId) : null
      if (sessionId && !ownership)
        throw createClientInvariantError('The conversation is unavailable.')
      const worktree =
        ownership?.worktree ??
        (worktreeId ? slice.worktreeById[worktreeId] : null) ??
        (projectId ? selectCurrentWorktree(slice, projectId) : null)
      if (!worktree) throw createClientInvariantError('The conversation workspace is unavailable.')
      if (projectId && worktree.projectId !== projectId)
        throw createClientInvariantError('The conversation does not belong to this project.')
      const editorWorktree = availableEditorWorktree(slice, worktree)
      const workspace = await registerWorkspaceAddress({
        client: clientForQueryClient(queryClientFor(origin)),
        path: editorWorktree.path,
        signal,
      })
      if (!isCurrent()) return { address, replace }
      const sameRoot =
        application.getSnapshot().origin === origin &&
        application.getSnapshot().editor.workspaceStore.getState().rootFolder?.path ===
          workspace.path
      const next = sameRoot
        ? address
        : await workspaceAddressFor(application, environmentId, workspace, address)
      return {
        address: {
          ...next,
          environmentId,
          workspace: workspaceToken(workspace),
          mode: 'chat',
          editor: editorDocumentToken(next),
          document: token,
          rail: newDraft ? null : next.rail,
        },
        replace,
        historyTarget: null,
        draftWorktreeId: sessionId === null ? worktree.id : undefined,
        beforeApply: () =>
          applyPreparedChat({
            snapshot,
            environmentId,
            worktree,
            restartDraft: newDraft && sameRoot,
          }),
      }
    })
  }

  return openChat
}

function applyPreparedChat({
  snapshot,
  environmentId,
  worktree,
  restartDraft,
}: {
  readonly snapshot: OrchestrationShellSnapshot | null
  readonly environmentId: EnvironmentId
  readonly worktree: OrchestrationWorktreeShell
  readonly restartDraft: boolean
}) {
  if (snapshot) useChatProjectionStore.getState().syncShellSnapshot(environmentId, snapshot)
  if (!restartDraft || !sameDraft(environmentId, worktree.projectId)) return
  useSessionSelectionStore.getState().startDraft(environmentId, worktree.projectId, worktree.id)
}

async function chatProjectionForNavigation(
  environmentId: EnvironmentId,
  sessionId: SessionId | null,
  signal: AbortSignal,
) {
  const slice = selectChatProjectionSlice(useChatProjectionStore.getState(), environmentId)
  if (!sessionId || selectSessionOwnership(slice, sessionId)) return { slice, snapshot: null }
  const client = clientForQueryClient(queryClientFor(confirmedEnvironmentOrigin(environmentId)))
  const snapshot = await fetchOrchestrationShellSnapshotHttp(client, signal)
  return { slice: syncChatProjectionShellSnapshot(slice, snapshot), snapshot }
}

function availableEditorWorktree(slice: ChatProjectionSlice, worktree: OrchestrationWorktreeShell) {
  if (worktree.lifecycle.state === 'ready') return worktree
  const current = selectCurrentWorktree(slice, worktree.projectId)
  if (current?.lifecycle.state === 'ready') return current
  throw createClientInvariantError('The conversation has no available project checkout.')
}

function sidebarOwnerMatches(
  application: ApplicationRuntime | null,
  environmentId: EnvironmentId,
  projectId?: ProjectId,
) {
  const current = application?.getSnapshot()
  if (!current || confirmedEnvironmentId(current.origin) !== environmentId) return false
  if (!projectId) return true
  const root = current.editor.workspaceStore.getState().rootFolder?.path
  if (root === undefined) return false
  const slice = selectChatProjectionSlice(useChatProjectionStore.getState(), environmentId)
  return selectWorktreeAtPath(slice, root)?.projectId === projectId
}

function sameDraft(environmentId: EnvironmentId, projectId: ProjectId) {
  const selection = useSessionSelectionStore.getState().selection
  return (
    selection.kind === 'draft' &&
    selection.environmentId === environmentId &&
    selection.projectId === projectId
  )
}

function supersededNavigation(): Promise<NavigationResult> {
  return Promise.resolve({ status: 'superseded' })
}
