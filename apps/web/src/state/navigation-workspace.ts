import { selectSessionOwnership, selectWorktreeAtPath } from '@workspace/client-core/chat/selectors'
import { scopedSessionKey, type EnvironmentId, type WorkspaceAddress } from '@workspace/contracts'
import type { Address } from '@workspace/client-core/address/grammar'
import {
  completeAddressFromSnapshot,
  emptyAddressSnapshot,
} from '@/features/address/utils/snapshot'
import { sessionTokenFor } from '@/features/address/utils/session-token'
import { searchParamsFor } from '@/features/address/utils/search-params'
import { diffScopeParam } from '@/features/address/utils/diff-scope'
import { useSessionSelectionStore } from '@/features/chat-mode/state/session-selection-store'
import type { ChatSelection } from '@/lib/chat-selection'
import {
  useChatProjectionStore,
  selectChatProjectionSlice,
} from '@/features/chat/state/chat-projection-store'
import { useSessionDiffScopeStore } from '@/features/chat/state/session-diff-scope-store'
import { readPersistedSessionDiffScopes } from '@/features/chat/utils/session-diff-scope-storage'
import { fetchOrchestrationShellSnapshotHttp } from '@/features/chat/transport/orchestration-http-snapshots'
import {
  activeEditorTabForWorkbenchPanels,
  editorOpenContentsForWorkbenchPanels,
} from '@/features/workbench/utils/panels'
import { readSessionSelectionCache, readWorkspaceCache } from '@/features/workspace/state/cache'
import { confirmedEnvironmentId, confirmedEnvironmentOrigin } from '@/lib/environments/state/domain'
import { environmentScopedStorage } from '@/lib/environments/state/scoped-storage'
import { clientForQueryClient, queryClientFor } from '@/lib/environments/state/query-clients'
import type { ApplicationRuntime } from '@/state/application-runtime'

export function scopedMainSelection(
  environmentId: EnvironmentId,
  rootPath: string | undefined,
): ChatSelection {
  const selection = useSessionSelectionStore.getState().selection
  if (
    selection.kind === 'auto' ||
    selection.environmentId !== environmentId ||
    rootPath === undefined
  )
    return { kind: 'auto' }
  const slice = selectChatProjectionSlice(useChatProjectionStore.getState(), environmentId)
  return selectWorktreeAtPath(slice, rootPath)?.projectId === selection.projectId
    ? selection
    : { kind: 'auto' }
}

export async function workspaceAddressFor(
  application: ApplicationRuntime,
  environmentId: EnvironmentId,
  workspace: WorkspaceAddress,
  previous: Address,
) {
  const runtime = application.getEnvironment(environmentId)?.editor
  const state = runtime?.workspaceStore.getState()
  const storage = environmentScopedStorage(environmentId)
  const cache = readWorkspaceCache(storage)
  const panels =
    state?.rootFolder?.path === workspace.path
      ? state.workbenchPanels
      : (state?.parkedWorkspaces.get(workspace.path)?.workbenchPanels ??
        cache.workspaces[workspace.path]?.workbenchPanels)
  const searchState = runtime?.searchBufferStore.getState()
  const search =
    searchState?.active?.rootPath === workspace.path
      ? searchState.active
      : (searchState?.parked.get(workspace.path) ?? cache.searchBuffers[workspace.path] ?? null)
  const mode = state?.uiMode ?? cache.uiMode
  const selection =
    confirmedEnvironmentId(application.getSnapshot().origin) === environmentId
      ? useSessionSelectionStore.getState().selection
      : readSessionSelectionCache(storage)
  const sessionToken =
    mode === 'chat' ? await rememberedSessionToken(selection, environmentId, workspace.path) : null
  return completeAddressFromSnapshot({
    ...emptyAddressSnapshot(),
    environmentId,
    workspaceAddress: workspace,
    rootPath: workspace.path,
    mode,
    passthrough: previous.passthrough,
    activeTabContent: panels ? (activeEditorTabForWorkbenchPanels(panels)?.content ?? null) : null,
    editorTabContents: panels ? editorOpenContentsForWorkbenchPanels(panels) : [],
    sidebarTab: panels?.activeSidebarTab ?? null,
    bottomTab: panels?.activeBottomTab ?? null,
    toolTab: state?.chatModePanels.activeToolTab ?? cache.chatModePanels.activeToolTab,
    search: searchParamsFor(search),
    logs: previous.logs,
    railView: previous.rail,
    settingsCategory: previous.settings,
    sessionToken,
    sessionDiffScope: sessionToken ? rememberedDiffScope(selection) : null,
  })
}

async function rememberedSessionToken(
  selection: ChatSelection,
  environmentId: EnvironmentId,
  rootPath: string,
) {
  if (selection.kind === 'auto' || selection.environmentId !== environmentId) return null
  const slice = selectChatProjectionSlice(useChatProjectionStore.getState(), environmentId)
  const root = selectWorktreeAtPath(slice, rootPath)
  const ownership =
    selection.kind === 'session' ? selectSessionOwnership(slice, selection.sessionId) : null
  if (root && (selection.kind === 'draft' || ownership))
    return root.projectId === selection.projectId ? sessionTokenFor(selection) : null
  const client = clientForQueryClient(queryClientFor(confirmedEnvironmentOrigin(environmentId)))
  const snapshot = await fetchOrchestrationShellSnapshotHttp(client)
  const worktree = snapshot.worktrees.find(
    (entry) => entry.path === rootPath || entry.canonicalPath === rootPath,
  )
  if (worktree?.projectId !== selection.projectId) return null
  if (
    selection.kind === 'session' &&
    !snapshot.sessions.some((entry) => entry.id === selection.sessionId)
  )
    return null
  return sessionTokenFor(selection)
}

function rememberedDiffScope(selection: ChatSelection) {
  if (selection.kind !== 'session') return null
  const key = scopedSessionKey(selection)
  const scope =
    useSessionDiffScopeStore.getState().scopeBySessionKey[key]?.scope ??
    readPersistedSessionDiffScopes(environmentScopedStorage(selection.environmentId))
      .scopeBySessionKey[key]?.scope
  return scope ? diffScopeParam(scope) : null
}
