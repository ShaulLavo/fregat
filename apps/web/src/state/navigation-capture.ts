import type { EditorTabRecord } from '@/lib/documents/utils/types'
import { selectWorktreeAtPath } from '@workspace/client-core/chat/selectors'
import { activeProjectSession } from '@/features/chat-mode/utils/active-session'
import { confirmedEnvironmentId } from '@/lib/environments/state/domain'
import {
  useChatProjectionStore,
  selectChatProjectionSlice,
} from '@/features/chat/state/chat-projection-store'
import { scopedSessionKey, type EnvironmentId, type ProjectId } from '@workspace/contracts'
import { useEnvironmentsStore } from '@/lib/environments/state/store'
import {
  emptyAddressSnapshot,
  completeAddressFromSnapshot,
} from '@/features/address/utils/snapshot'
import { useSessionSelectionStore } from '@/features/chat-mode/state/session-selection-store'
import { useSessionRailStore } from '@/features/chat-mode/state/session-rail-store'
import { useSessionDiffScopeStore } from '@/features/chat/state/session-diff-scope-store'
import { useSidebarSelectionStore } from '@/features/chat/state/sidebar-selection-store'
import { diffScopeParam } from '@/features/address/utils/diff-scope'
import { sessionTokenFor } from '@/features/address/utils/session-token'
import { searchParamsFor } from '@/features/address/utils/search-params'
import type { SearchBufferStoreApi } from '@/features/search/state/buffer-state'
import { readLogsFilters } from '@/features/logs/state/filter-store'
import { defaultLogsFilterState } from '@/features/logs/utils/filter-params'
import { logsParamsFor } from '@/features/address/utils/logs-params'
import { createDefaultChatModePanels } from '@/features/chat-mode/utils/panels'
import {
  createDefaultWorkbenchPanels,
  activeEditorTabForWorkbenchPanels,
  editorOpenContentsForWorkbenchPanels,
} from '@/features/workbench/utils/panels'
import { readSettingsCategory } from '@/features/settings/state/category-store'
import { settingsCategorySlug } from '@/features/address/utils/settings-category'
import type { EditorUiStoreApi } from '@/features/editor/state/ui-state'
import type { EditorWorkspaceStoreApi } from '@/features/editor/state/workspace-state'
import type { ApplicationRuntime } from '@/state/application-runtime'
import { documentTokenForContent } from '@/features/address/utils/document-token'
import type { Address } from '@workspace/client-core/address/grammar'

function snapshotFromStore(
  storeApi: EditorWorkspaceStoreApi,
  uiStoreApi: EditorUiStoreApi,
  searchStoreApi: SearchBufferStoreApi,
  passthrough: Record<string, string>,
) {
  const state = storeApi.getState()
  const rootPath = state.rootFolder?.path ?? null

  const environments = useEnvironmentsStore.getState()
  const entry = environments.entries[environments.activeOrigin]
  const environmentId = entry?.kind === 'primary' ? null : (entry?.environmentId ?? null)
  const panels = state.workbenchPanels
  const defaults = createDefaultWorkbenchPanels()

  return {
    ...emptyAddressSnapshot(),
    environmentId,
    sidebarSessionToken: sidebarSessionToken(rootPath),
    activeTabContent: activeEditorTabForWorkbenchPanels(panels)?.content ?? null,
    focus: focusFor(uiStoreApi, activeEditorTabForWorkbenchPanels(panels)),
    bottomTab: orAbsent(panels.activeBottomTab, defaults.activeBottomTab),
    editorTabContents: editorOpenContentsForWorkbenchPanels(panels),
    workspaceAddress: state.rootFolder?.workspaceAddress ?? null,
    passthrough,
    mode: state.uiMode === 'chat' ? ('chat' as const) : ('workbench' as const),
    rootPath,
    railView: useSessionRailStore.getState().view === 'archived' ? ('archived' as const) : null,
    logs: logsParamsFor(readLogsFilters(), defaultLogsFilterState()),
    search: searchParamsFor(searchStoreApi.getState().active),
    sessionToken: mainSessionToken(rootPath),
    sessionDiffScope: sessionDiffScopeParam(rootPath),
    settingsCategory: settingsCategoryOrNull(),
    sidebarTab: orAbsent(panels.activeSidebarTab, defaults.activeSidebarTab),
    toolTab: orAbsent(
      state.chatModePanels?.activeToolTab ?? null,
      createDefaultChatModePanels().activeToolTab,
    ),
  }
}

function focusFor(uiStoreApi: EditorUiStoreApi, activeTab: EditorTabRecord | null) {
  const owned = uiStoreApi.getState().definitionTarget
  if (!owned || owned.tabId !== activeTab?.id) return null
  const target = owned.target
  const activeContent = activeTab.content
  if (!target || activeContent?.kind !== 'document' || activeContent.document.kind !== 'file')
    return null
  if (target.path !== activeContent.document.resource.path) return null

  const line = target.range.start.line + 1
  const endLine = target.range.end.line + 1

  return {
    column: target.range.start.character > 0 ? target.range.start.character + 1 : null,
    endLine: endLine > line ? endLine : null,
    line,
  }
}

function settingsCategoryOrNull() {
  const category = readSettingsCategory()

  return category ? settingsCategorySlug(category) : null
}

function orAbsent<T>(value: T | null, fallback: T) {
  return value === fallback ? null : value
}

function sessionDiffScopeParam(rootPath: string | null) {
  const selection = useSessionSelectionStore.getState().selection
  if (selection.kind !== 'session' || !selectionBelongsToWorkspace(selection, rootPath)) return null

  const entry = useSessionDiffScopeStore.getState().scopeBySessionKey[scopedSessionKey(selection)]

  return entry ? diffScopeParam(entry.scope) : null
}

function sidebarSessionToken(rootPath: string | null) {
  const selection = useSidebarSelectionStore.getState().selection
  if (selection.kind === 'auto' || !selectionBelongsToWorkspace(selection, rootPath)) return null
  if (selection.kind === 'draft') return 't/new'
  return `t/${selection.sessionId}`
}

export function captureMainSession(application: ApplicationRuntime) {
  const owner = application.getSnapshot()
  const rootPath = owner.editor.workspaceStore.getState().rootFolder?.path
  if (rootPath === undefined) return null
  const environmentId = confirmedEnvironmentId(owner.origin)
  const slice = selectChatProjectionSlice(useChatProjectionStore.getState(), environmentId)
  const projectId = selectWorktreeAtPath(slice, rootPath)?.projectId ?? null
  if (!projectId) return null
  const { selection, restored } = useSessionSelectionStore.getState()
  const resolved = activeProjectSession({
    slice,
    environmentId,
    projectId,
    selection,
    restored,
  })
  return resolved.sessionId ? { environmentId, sessionId: resolved.sessionId } : null
}

export function captureAddress(application: ApplicationRuntime, accepted: Address): Address {
  const editor = application.getSnapshot().editor
  const snapshot = snapshotFromStore(
    editor.workspaceStore,
    editor.uiStore,
    editor.searchBufferStore,
    accepted.passthrough,
  )
  const address = completeAddressFromSnapshot(snapshot)
  const selected = snapshot.activeTabContent
  const transient =
    selected !== null && documentTokenForContent(snapshot.rootPath, selected).kind !== 'token'
  if (!transient) return address
  return { ...address, document: accepted.document, editor: accepted.editor, focus: accepted.focus }
}

function mainSessionToken(rootPath: string | null) {
  const selection = useSessionSelectionStore.getState().selection
  if (selection.kind === 'auto' || !selectionBelongsToWorkspace(selection, rootPath)) return null
  return sessionTokenFor(selection)
}

function selectionBelongsToWorkspace(
  selection: { readonly environmentId: EnvironmentId; readonly projectId: ProjectId },
  rootPath: string | null,
) {
  const environments = useEnvironmentsStore.getState()
  const environmentId = environments.entries[environments.activeOrigin]?.environmentId
  if (rootPath === null || selection.environmentId !== environmentId) return false
  const slice = selectChatProjectionSlice(useChatProjectionStore.getState(), environmentId)
  return selectWorktreeAtPath(slice, rootPath)?.projectId === selection.projectId
}
