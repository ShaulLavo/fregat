import { supersededNavigation } from '@/state/navigation-result'
import { captureEditorScrollPositions } from '@/features/editor/state/scroll-persistence'
import { createChatNavigation } from '@/state/navigation-chat'
import { retainedTextBudgetFromSettings } from '@/features/editor/utils/retained-text-budget'
import { captureMainSession } from '@/state/navigation-capture'
import {
  historyTargetAfterSessionRemoval,
  historyTargetForEditorChange,
} from '@/features/address/utils/history'
import { useSidebarSelectionStore } from '@/features/chat/state/sidebar-selection-store'
import { scopedMainSelection, workspaceAddressFor } from '@/state/navigation-workspace'
import { fetchDiff, fetchGitFile } from '@/features/git/utils/api'
import { snapshotDocument } from '@/lib/documents/utils/comparisons'
import {
  createTabId,
  fileDocument,
  fileResource,
  filesystemPath,
} from '@/lib/documents/utils/identity'
import { documentTab, settingsTab } from '@/lib/documents/utils/tabs'
import type { DocumentRef, FilesystemPath, TabContent, TabId } from '@/lib/documents/utils/types'
import type { ChangeRow } from '@/features/git/utils/types'
import { gitKeys } from '@/lib/query-keys'
import { emptySearchBuffer, searchHistoryQuerySnapshot } from '@/features/search/state/buffer-state'
import { readWorkspaceCache } from '@/features/workspace/state/cache'
import {
  activateWorkspaceRoot,
  useActiveProjectStore,
} from '@/features/workspace/state/active-project'
import { environmentScopedStorage } from '@/lib/environments/state/scoped-storage'
import { selectWorktreeAtPath } from '@workspace/client-core/chat/selectors'
import type {
  EnvironmentId,
  ProjectId,
  SessionId,
  ScopedProjectRef,
  WorktreeId,
  ScopedSessionRef,
} from '@workspace/contracts'
import {
  emptyAddress,
  editorDocumentToken,
  type Address,
} from '@workspace/client-core/address/grammar'
import { workspaceToken } from '@workspace/client-core/address/workspace'
import { registerWorkspaceAddress } from '@workspace/client-core/files/workspace-address'
import type { LanguageServerDefinitionTarget } from '@singapore-editor/lsp-plugin/websocket'
import { createNavigationCoordinator, type NavigationResult } from '@/state/navigation-coordinator'
import type { ApplicationRouter } from '@/state/router'
import type { AddressIntent } from '@/features/address/utils/intent'
import { documentTokenForContent } from '@/features/address/utils/document-token'
import { definitionTargetFor } from '@/features/address/utils/definition-target'
import {
  addressForDeletedFile,
  addressForRenamedFile,
} from '@/features/address/utils/resource-address'
import { confirmedEnvironmentId, confirmedEnvironmentOrigin } from '@/lib/environments/state/domain'
import { clientForQueryClient, queryClientFor } from '@/lib/environments/state/query-clients'
import {
  useChatProjectionStore,
  selectChatProjectionSlice,
} from '@/features/chat/state/chat-projection-store'
import type { EditorWorkspaceStoreApi } from '@/features/editor/state/workspace-state'
import {
  createEditorApplyActions,
  activateWorkbenchSelection,
} from '@/features/editor/state/apply-actions'
import {
  activeEditorTabForWorkbenchPanels,
  closeEditorTabInWorkbenchPanels,
  editorOpenContentsForWorkbenchPanels,
  type WorkbenchPanels,
  type WorkbenchSidebarTab,
  type WorkbenchBottomTab,
} from '@/features/workbench/utils/panels'
import {
  showChatModeToolTab,
  type ChatModePanels,
  type ChatModeToolTab,
} from '@/features/chat-mode/utils/panels'
import {
  editorHistoryForSelection,
  previousOpenTabContent,
  recentlyClosedTabsForReopen,
} from '@/features/editor/utils/tab-history'
import type { EditorRuntime } from '@/features/editor/state/runtime'
import type { SearchBufferOptionPatch } from '@/features/search/state/buffer-state'
import { searchParamsFor } from '@/features/address/utils/search-params'
import { logsParamsFor } from '@/features/address/utils/logs-params'
import { defaultLogsFilterState } from '@/features/logs/utils/filter-params'
import { type LogsFilterState } from '@workspace/client-core/logs/filters'
import { settingsCategorySlug } from '@/features/address/utils/settings-category'
import { shareableAddress } from '@/features/address/state/storage'
import { buildAddressLocation } from '@/features/address/utils/route-options'
import { budgetAddress } from '@/features/address/utils/snapshot'
import { createClientInvariantError } from '@/lib/structured-errors'
import type { ApplicationRuntime } from '@/state/application-runtime'
import { diffScopeParam } from '@/features/address/utils/diff-scope'
import type { SessionDiffScope } from '@/features/chat/utils/session-diff-scope-storage'

import {
  createGroupId,
  createSplitId,
  type EditorGroups,
  type GroupId,
  type GroupResize,
  type TabPlacement,
  type TabPlacementResult,
} from '@/lib/documents/utils/group-types'
import {
  allEditorTabs,
  groupById,
  groupForTab,
  placeTabInGroups,
  resizeEditorGroups,
  selectEditorGroup,
  selectEditorGroupTab,
} from '@/lib/documents/utils/groups'
import {
  placementMutationOptions,
  resizeMutationOptions,
} from '@/features/editor/state/group-mutations'
import { runMutation } from '@/lib/mutations/run'

export function createNavigation(
  router: ApplicationRouter,
  initial: AddressIntent,
  options: {
    readonly canPlaceTab?: (placement: TabPlacement, groups: EditorGroups) => boolean
  } = {},
) {
  const coordinator = createNavigationCoordinator(router, initial)
  const openChat = createChatNavigation(coordinator)
  const replaceFields = (
    fields: Partial<Address>,
    historyWriteMode: Parameters<typeof coordinator.request>[1] = 'immediate',
  ) =>
    coordinator.request(
      ({ address }) => ({
        address: { ...address, ...fields },
        replace: true,
        preserveTransient: true,
      }),
      historyWriteMode,
    )

  function actions(application: ApplicationRuntime) {
    return editorActions(application.getSnapshot().editor)
  }

  function editorActions(editor: EditorRuntime) {
    return createEditorApplyActions({
      retainedTextBudget: retainedTextBudgetFromSettings,
      activation: editor.editorActivation,
      documentStore: editor.documentStore,
      searchStore: editor.searchBufferStore,
      uiStore: editor.uiStore,
      workspaceStore: editor.workspaceStore,
    })
  }

  function revealEditor(application: ApplicationRuntime) {
    const state = application.getSnapshot().editor.workspaceStore.getState()
    if (state.uiMode === 'chat')
      state.setChatModePanels(showChatModeToolTab(state.chatModePanels, 'editor'))
  }

  function ownedRequest(
    owner: EditorWorkspaceStoreApi | undefined,
    prepare: Parameters<typeof coordinator.request>[0],
    rootPath?: string,
    historyWriteMode: Parameters<typeof coordinator.request>[1] = 'immediate',
  ) {
    const current = coordinator.getApplication()?.getSnapshot()
    if (
      !current ||
      (owner && current.editor.workspaceStore !== owner) ||
      (rootPath !== undefined &&
        current.editor.workspaceStore.getState().rootFolder?.path !== rootPath)
    )
      return Promise.resolve({ status: 'superseded' } satisfies NavigationResult)
    return coordinator.request(prepare, historyWriteMode)
  }

  function assertOwner(application: ApplicationRuntime, owner?: EditorWorkspaceStoreApi) {
    if (owner && owner !== application.getSnapshot().editor.workspaceStore)
      throw createClientInvariantError('The command belongs to a previous environment.')
  }

  function addressWithContent(
    address: Address,
    content: TabContent,
    rootPath: string | null,
    focus: Address['focus'] = null,
  ) {
    const token = documentTokenForContent(rootPath, content)
    if (token.kind !== 'token') return null
    const tabs = address.tabs?.includes(token.token)
      ? address.tabs
      : [...(address.tabs ?? []), token.token]
    const selected =
      address.mode === 'chat' ? { editor: token.token, tool: 'editor' } : { document: token.token }
    return { ...address, ...selected, tabs, focus }
  }

  function openContent({
    owner,
    content,
    focus = null,
    replace,
    settingsCategory,
  }: {
    readonly owner?: EditorWorkspaceStoreApi
    readonly content: TabContent
    readonly focus?: Address['focus']
    readonly replace?: boolean
    readonly settingsCategory?: string | null
  }): Promise<NavigationResult> {
    if (owner && coordinator.getApplication()?.getSnapshot().editor.workspaceStore !== owner)
      return Promise.resolve({ status: 'superseded' })
    const current = coordinator.currentAddress()
    const rootPath = owner?.getState().rootFolder?.path ?? null
    if (owner && !addressWithContent(current, content, rootPath, focus)) {
      return coordinator.transient((application) => {
        assertOwner(application, owner)
        revealEditor(application)
        const apply = actions(application)
        if (focus && content.kind === 'document' && content.document.kind === 'file') {
          apply.openDefinition(definitionTargetFor(content.document.resource.path, focus))
          return
        }
        apply.openTabContent(content)
      })
    }
    return ownedRequest(owner, ({ application, address }) => {
      assertOwner(application, owner)
      const root =
        application.getSnapshot().editor.workspaceStore.getState().rootFolder?.path ?? null
      const next = addressWithContent(address, content, root, focus)
      if (!next) throw createClientInvariantError('This document has no workspace address.')
      return {
        address: { ...next, settings: categoryForAddress(settingsCategory, next.settings) },
        replace: replace ?? editorDocumentToken(next) === editorDocumentToken(address),
        historyTarget: { kind: 'editor' },
        beforeApply: () => revealEditor(application),
      }
    })
  }

  function openFile({
    path,
    ...options
  }: {
    readonly owner?: EditorWorkspaceStoreApi
    readonly path: FilesystemPath
    readonly focus?: Address['focus']
    readonly replace?: boolean
  }): Promise<NavigationResult> {
    return openContent({ ...options, content: documentTab(fileDocument(fileResource(path))) })
  }

  function addressForPanels(
    address: Address,
    panels: WorkbenchPanels,
    rootPath: string | null,
    focus: Address['focus'] = null,
  ) {
    const selected = activeEditorTabForWorkbenchPanels(panels)
    if (selected) {
      const next = addressWithContent(address, selected.content, rootPath, focus)
      // A panel change records the selected document; only opening one reveals the editor tool.
      return next ? { ...next, tool: address.tool } : address
    }
    return {
      ...address,
      document: address.mode === 'chat' ? address.document : null,
      editor: null,
      focus: null,
    }
  }

  async function openWorkspace({
    environmentId,
    path,
    replace = false,
  }: {
    readonly environmentId: EnvironmentId
    readonly path: string
    readonly replace?: boolean
  }) {
    return coordinator.request(async ({ signal, application, address, isCurrent }) => {
      const origin = confirmedEnvironmentOrigin(environmentId)
      const workspace = await registerWorkspaceAddress({
        client: clientForQueryClient(queryClientFor(origin)),
        path,
        signal,
      })
      if (!isCurrent()) return { address, replace }
      const current = application.getSnapshot()
      const same =
        current.origin === origin &&
        current.editor.workspaceStore.getState().rootFolder?.path === workspace.path
      const next = same
        ? address
        : await workspaceAddressFor(application, environmentId, workspace, address)
      return {
        address: { ...next, environmentId, workspace: workspaceToken(workspace) },
        replace,
        historyTarget: null,
      }
    })
  }

  function setWorkbenchPanels(
    panels: WorkbenchPanels,
    owner?: EditorWorkspaceStoreApi,
    mode?: 'workbench',
  ) {
    return ownedRequest(owner, ({ application, address }) => {
      assertOwner(application, owner)
      const editor = application.getSnapshot().editor
      const rootPath = editor.workspaceStore.getState().rootFolder?.path ?? null
      const base = mode
        ? { ...address, mode, document: editorDocumentToken(address), editor: null }
        : address
      const next = addressForPanels(base, panels, rootPath, address.focus)
      const tabs = editorOpenContentsForWorkbenchPanels(panels).flatMap((content) => {
        const token = documentTokenForContent(rootPath, content)
        return token.kind === 'token' ? [token.token] : []
      })
      return {
        address: { ...next, tabs, side: panels.activeSidebarTab, bottom: panels.activeBottomTab },
        replace:
          next.mode === address.mode && editorDocumentToken(next) === editorDocumentToken(address),
        historyTarget: historyTargetForEditorChange(address, next),
        preserveTransient: true,
        editorOwner: { workspace: editor.workspaceStore, rootPath },
        commitEditorState: (currentOwner) => {
          if (
            currentOwner !== editor.workspaceStore ||
            currentOwner.getState().rootFolder?.path !== (rootPath ?? undefined)
          )
            return false
          currentOwner.getState().setWorkbenchPanels({
            ...panels,
            editorGroups: currentOwner.getState().workbenchPanels.editorGroups,
          })
          return true
        },
      }
    })
  }

  function closeTabs(tabIds: readonly TabId[], owner: EditorWorkspaceStoreApi, discard = false) {
    if (tabIds.length === 0)
      return Promise.resolve({ status: 'applied' } satisfies NavigationResult)
    return ownedRequest(owner, ({ application, address }) => {
      assertOwner(application, owner)
      const workspace = owner.getState()
      const panels = tabIds.reduce(closeEditorTabInWorkbenchPanels, workspace.workbenchPanels)
      const next = addressForPanels(address, panels, workspace.rootFolder?.path ?? null)
      const tabs = editorOpenContentsForWorkbenchPanels(panels).flatMap((content) => {
        const token = documentTokenForContent(workspace.rootFolder?.path ?? null, content)
        return token.kind === 'token' ? [token.token] : []
      })
      return {
        address: { ...next, tabs },
        replace: editorDocumentToken(next) === editorDocumentToken(address),
        historyTarget: historyTargetForEditorChange(address, next),
        preserveTransient: true,
        editorOwner: { workspace: owner, rootPath: workspace.rootFolder?.path ?? null },
        commitEditorState: (currentOwner) => {
          if (
            currentOwner !== owner ||
            currentOwner.getState().rootFolder?.path !== workspace.rootFolder?.path
          )
            return false
          const apply = actions(application)
          for (const tabId of tabIds) {
            if (discard) apply.discardAndCloseTab(tabId)
            if (!discard) apply.closeTab(tabId)
          }
          return true
        },
      }
    })
  }

  const mutationScopes = new WeakMap<EditorWorkspaceStoreApi, string>()

  function groupMutationScope(owner: EditorWorkspaceStoreApi) {
    let scope = mutationScopes.get(owner)
    if (!scope) {
      scope = `editor.groups.${crypto.randomUUID()}`
      mutationScopes.set(owner, scope)
    }
    return `${scope}.${owner.getState().rootFolder?.path ?? ''}`
  }

  function publishGroups(editor: EditorRuntime, editorGroups: EditorGroups) {
    const state = editor.workspaceStore.getState()
    if (editorGroups === state.workbenchPanels.editorGroups) return
    const panels = { ...state.workbenchPanels, editorGroups }
    editor.workspaceStore.getState().setWorkbenchPanels(panels)
    activateWorkbenchSelection(panels, editor.editorActivation)
    const selected = editor.workspaceStore.getState().selectedTabContent
    editor.workspaceStore.setState({
      editorHistory: editorHistoryForSelection(state.editorHistory, selected),
    })
  }

  function editGroups(
    owner: EditorWorkspaceStoreApi,
    transform: (
      groups: EditorGroups,
      editor: EditorRuntime,
      committing: boolean,
    ) => EditorGroups | null,
  ): Promise<NavigationResult> {
    const rootPath = owner.getState().rootFolder?.path
    return ownedRequest(
      owner,
      ({ application, address }) => {
        const editor = application.getSnapshot().editor
        const nextGroups = transform(owner.getState().workbenchPanels.editorGroups, editor, false)
        if (!nextGroups)
          return {
            address,
            replace: true,
            editorOwner: { workspace: owner, rootPath: rootPath ?? null },
            commitEditorState: () => false,
          }
        const panels = { ...owner.getState().workbenchPanels, editorGroups: nextGroups }
        const next = addressForPanels(address, panels, rootPath ?? null)
        let committed = false
        return {
          address: {
            ...next,
            tabs: editorOpenContentsForWorkbenchPanels(panels).flatMap((content) => {
              const token = documentTokenForContent(rootPath ?? null, content)
              return token.kind === 'token' ? [token.token] : []
            }),
          },
          replace: editorDocumentToken(next) === editorDocumentToken(address),
          historyTarget: historyTargetForEditorChange(address, next),
          preserveTransient: true,
          editorOwner: { workspace: owner, rootPath: rootPath ?? null },
          commitEditorState: (currentOwner) => {
            if (currentOwner !== owner || owner.getState().rootFolder?.path !== rootPath)
              return false
            if (committed) return true
            const current = transform(owner.getState().workbenchPanels.editorGroups, editor, true)
            if (!current) return false
            publishGroups(editor, current)
            const workspace = owner.getState()
            editor.uiStore
              .getState()
              .retainTabPresentation(
                new Set(
                  [
                    ...allEditorTabs(current),
                    ...Array.from(workspace.parkedWorkspaces.values()).flatMap((slice) =>
                      allEditorTabs(slice.workbenchPanels.editorGroups),
                    ),
                  ].map((tab) => tab.id),
                ),
              )
            captureEditorScrollPositions(owner, editor.documentStore)
            committed = true
            return true
          },
        }
      },
      rootPath,
    )
  }

  function placeTab(owner: EditorWorkspaceStoreApi, placement: TabPlacement) {
    const sourceGroup = groupForTab(
      owner.getState().workbenchPanels.editorGroups,
      placement.tabId,
    )?.id
    const ids = { groupId: createGroupId(), splitId: createSplitId(), tabId: createTabId() }
    return editGroups(owner, (groups, editor, committing) => {
      if (groupForTab(groups, placement.tabId)?.id !== sourceGroup) return null
      if (options.canPlaceTab && !options.canPlaceTab(placement, groups)) return null
      const result = placeTabInGroups(groups, placement, ids)
      if (result.status === 'unchanged') return groups
      if (result.status !== 'applied') return null
      if (committing) commitPlacementViews(editor, result)
      return result.groups
    })
  }

  function commitPlacementViews(
    editor: EditorRuntime,
    placement: Extract<TabPlacementResult, { status: 'applied' }>,
  ) {
    const owner = editor.workspaceStore
    captureEditorScrollPositions(owner, editor.documentStore)
    if (placement.copiedFromTabId) {
      const workspace = owner.getState()
      const sourcePosition = workspace.viewScrollPositions.find(
        (entry) => entry.tabId === placement.copiedFromTabId,
      )
      if (sourcePosition)
        workspace.setViewScrollPositions([
          ...workspace.viewScrollPositions,
          { tabId: placement.tabId, position: sourcePosition.position },
        ])
      editor.documentStore.getState().copyEditorView(placement.copiedFromTabId, placement.tabId)
      editor.uiStore.getState().copyTabPresentation(placement.copiedFromTabId, placement.tabId)
    }
    for (const tabId of placement.removedTabIds)
      editor.documentStore.getState().removeEditorView(tabId)
  }

  function editorCommands(owner: EditorWorkspaceStoreApi) {
    return {
      openTabContent: (content: TabContent) => openContent({ owner, content }),
      selectContent: (content: TabContent) => openContent({ owner, content }),
      openFileSurface: (path: FilesystemPath) => openFile({ owner, path }),
      selectFile: (path: FilesystemPath | null) =>
        path
          ? openFile({ owner, path })
          : Promise.resolve({ status: 'applied' } satisfies NavigationResult),
      openDefinition: (target: LanguageServerDefinitionTarget) => {
        if (coordinator.getApplication()?.getSnapshot().editor.workspaceStore !== owner)
          return supersededNavigation()
        if (
          documentTokenForContent(
            owner.getState().rootFolder?.path ?? null,
            documentTab(fileDocument(fileResource(filesystemPath(target.path)))),
          ).kind !== 'token'
        ) {
          return coordinator.transient((application) => {
            revealEditor(application)
            actions(application).openDefinition(target)
          })
        }
        return openFile({
          owner,
          path: filesystemPath(target.path),
          focus: {
            line: target.range.start.line + 1,
            column: target.range.start.character + 1,
            endLine:
              target.range.end.line > target.range.start.line ? target.range.end.line + 1 : null,
          },
        })
      },
      openSearchEditor: (rootPath: FilesystemPath) =>
        openContent({ owner, content: documentTab({ kind: 'search', root: rootPath }) }),
      openSettingsEditor: (category?: string | null) =>
        openContent({ owner, content: settingsTab(), settingsCategory: category }),
      selectTab: ({ groupId, tabId }: { groupId: GroupId; tabId: TabId }) =>
        editGroups(owner, (groups) =>
          groupForTab(groups, tabId)?.id === groupId
            ? selectEditorGroupTab(groups, groupId, tabId)
            : null,
        ),
      setActiveGroup: (groupId: GroupId) => {
        const editor = coordinator.getApplication()?.getSnapshot().editor
        if (!editor || editor.workspaceStore !== owner) return supersededNavigation()
        const panels = owner.getState().workbenchPanels
        if (!groupById(panels.editorGroups, groupId)) return supersededNavigation()
        const editorGroups = selectEditorGroup(panels.editorGroups, groupId)
        if (editorGroups === panels.editorGroups)
          return Promise.resolve({ status: 'applied' } satisfies NavigationResult)
        publishGroups(editor, editorGroups)
        return editGroups(owner, (current) => current)
      },
      placeTab: (placement: TabPlacement) => {
        const editor = coordinator.getApplication()?.getSnapshot().editor
        if (!editor || editor.workspaceStore !== owner) return supersededNavigation()
        const scope = groupMutationScope(owner)
        return runMutation(
          editor.queryClient,
          placementMutationOptions(scope, (request) => placeTab(owner, request)),
          placement,
        )
      },
      resizeEditorSplit: (request: GroupResize) => {
        const editor = coordinator.getApplication()?.getSnapshot().editor
        if (!editor || editor.workspaceStore !== owner) return supersededNavigation()
        return runMutation(
          editor.queryClient,
          resizeMutationOptions(groupMutationScope(owner), (resize) =>
            editGroups(owner, (groups) => resizeEditorGroups(groups, resize)),
          ),
          request,
        )
      },
      requestMoveTab: (tabId: TabId) => {
        const editor = coordinator.getApplication()?.getSnapshot().editor
        if (editor?.workspaceStore !== owner) return
        if (groupForTab(owner.getState().workbenchPanels.editorGroups, tabId))
          editor.uiStore.getState().setMoveTabId(tabId)
      },
      closeTab: (tabId: TabId) => closeTabs([tabId], owner),
      closeTabs: (tabIds: readonly TabId[]) => closeTabs(tabIds, owner),
      discardAndCloseTabs: (tabIds: readonly TabId[]) => closeTabs(tabIds, owner, true),
      discardAndCloseTab: (tabId: TabId) => closeTabs([tabId], owner, true),
      selectPreviousEditor: () => {
        const state = owner.getState()
        const content = previousOpenTabContent(
          state.editorHistory,
          state.openTabContents,
          state.selectedTabContent,
        )
        return content
          ? openContent({ owner, content })
          : Promise.resolve({ status: 'superseded' } satisfies NavigationResult)
      },
      reopenClosedEditor: async () => {
        const content = owner.getState().recentlyClosedTabs[0]
        if (!content) return { status: 'superseded' } satisfies NavigationResult
        const result = await openContent({ owner, content })
        if (result.status !== 'applied') return result
        const state = owner.getState()
        state.setRecentlyClosedTabs(recentlyClosedTabsForReopen(state.recentlyClosedTabs, content))
        return result
      },
      renameLiveEditorDocument: (from: FilesystemPath, to: FilesystemPath) => {
        const editor = coordinator.getApplication()?.getEditorForWorkspace(owner)
        if (!editor) return { wasDirty: false, settled: supersededNavigation() }
        const { wasDirty } = editorActions(editor).renameLiveEditorDocument(from, to)
        const settled = coordinator.reconcileAddress(owner, (address, root) =>
          addressForRenamedFile(address, root, from, to),
        )
        return { wasDirty, settled }
      },
      discardLiveEditorDocument: (document: DocumentRef) => {
        const editor = coordinator.getApplication()?.getEditorForWorkspace(owner)
        if (!editor) return { wasDirty: false, settled: supersededNavigation() }
        const { wasDirty } = editorActions(editor).discardLiveEditorDocument(document)
        const settled = coordinator.reconcileAddress(owner, (address, root) =>
          document.kind === 'file'
            ? addressForDeletedFile(address, root, document.resource.path)
            : address,
        )
        return { wasDirty, settled }
      },
    }
  }

  return {
    router,
    initial: coordinator.initial,
    attach: coordinator.attach,
    dispose: coordinator.dispose,
    subscribe: coordinator.subscribe,
    getSnapshot: coordinator.getSnapshot,
    currentAddress: coordinator.currentAddress,
    permitsRecentRoot: coordinator.permitsRecentRoot,
    openFile,
    openContent,
    openChat,
    openWorkspace,
    openDiff({ owner, row }: { readonly owner: EditorWorkspaceStoreApi; readonly row: ChangeRow }) {
      return ownedRequest(owner, async ({ application, address }) => {
        const staged = row.section === 'staged'
        // Query signal only: a fetch shared by key must not die with one caller's navigation.
        const diffs = await application.getSnapshot().queryClient.fetchQuery({
          queryFn: ({ signal, client }) =>
            fetchDiff(row.file.path, staged, signal, clientForQueryClient(client)),
          queryKey: gitKeys.diff(row.file.path, staged),
          staleTime: 1000,
        })
        const diff = diffs.find(
          (entry) => entry.path === row.file.path || entry.oldPath === row.file.path,
        )
        const document = diff ? snapshotDocument(diff) : null
        if (!document)
          throw createClientInvariantError('The requested change has no available file snapshot.')
        const next = addressWithContent(
          address,
          documentTab(document),
          owner.getState().rootFolder?.path ?? null,
        )
        if (!next)
          throw createClientInvariantError('The requested change has no workspace address.')
        return {
          address: next,
          historyTarget: { kind: 'editor' },
          replace: editorDocumentToken(next) === editorDocumentToken(address),
          beforeApply: () => revealEditor(application),
        }
      })
    },
    editorCommands,
    setWorkbenchPanels,
    ownsWorkspace: coordinator.ownsWorkspace,
    invalidateWorkspace(owner: EditorWorkspaceStoreApi, path: string, reason: string) {
      const current = coordinator.getApplication()?.getSnapshot()
      if (current?.editor.workspaceStore !== owner || owner.getState().rootFolder?.path !== path)
        return
      coordinator.invalidateWorkspace(owner, path, reason, () => {
        const activeRoot = useActiveProjectStore.getState().workspaceRoot
        editorActions(current.editor).clearRootFolder()
        if (activeRoot !== path) activateWorkspaceRoot(activeRoot)
      })
    },
    openFileAtRef({
      owner,
      path,
      ref,
    }: {
      readonly owner: EditorWorkspaceStoreApi
      readonly path: FilesystemPath
      readonly ref: string
    }) {
      return ownedRequest(owner, async ({ application, address, isCurrent }) => {
        const runtime = application.getSnapshot()
        // Query signal only: a fetch shared by key must not die with one caller's navigation.
        const file = await runtime.queryClient.fetchQuery({
          queryKey: gitKeys.file(path, ref),
          staleTime: Infinity,
          queryFn: ({ signal, client }) =>
            fetchGitFile(path, ref, signal, clientForQueryClient(client)),
        })
        const document = { kind: 'git-ref', source: { path, ref } } as const
        const next = addressWithContent(
          address,
          documentTab(document),
          owner.getState().rootFolder?.path ?? null,
        )
        if (!next) throw createClientInvariantError('The file reference has no workspace address.')
        return {
          address: next,
          replace: false,
          historyTarget: { kind: 'editor' },
          beforeApply: () => {
            revealEditor(application)
            if (isCurrent())
              runtime.editor.documentStore
                .getState()
                .ensureUnsyncedEditorDocument({ content: file.content, target: document })
          },
        }
      })
    },
    setMode(mode: 'workbench' | 'chat', owner?: EditorWorkspaceStoreApi) {
      const current = coordinator.getApplication()?.getSnapshot()
      if (!current || (owner && current.editor.workspaceStore !== owner))
        return supersededNavigation()
      const address = coordinator.currentAddress()
      if (mode === 'chat' && address.mode !== mode) {
        const environmentId = confirmedEnvironmentId(current.origin)
        const rootPath = current.editor.workspaceStore.getState().rootFolder?.path
        const remembered = scopedMainSelection(environmentId, rootPath)
        if (remembered.kind !== 'auto')
          return openChat({
            ...remembered,
            sessionId: remembered.kind === 'session' ? remembered.sessionId : null,
            surface: 'main',
          })
      }
      return ownedRequest(owner, ({ address }) => {
        if (address.mode === mode) return { address, replace: true, preserveTransient: true }
        return {
          address: {
            ...address,
            mode,
            document: mode === 'chat' ? null : address.editor,
            editor: mode === 'chat' ? address.document : null,
          },
          replace: false,
        }
      })
    },
    setSidePanel: (side: WorkbenchSidebarTab) =>
      replaceFields({ side, chat: side === 'chat' ? coordinator.currentAddress().chat : null }),
    setBottomPanel: (bottom: WorkbenchBottomTab) => replaceFields({ bottom }),
    setToolPanel: (tool: ChatModeToolTab) => replaceFields({ tool }),
    setRail: (rail: 'active' | 'archived') => replaceFields({ rail }),
    setChatModePanels(panels: ChatModePanels, owner?: EditorWorkspaceStoreApi) {
      return ownedRequest(owner, ({ application, address }) => {
        assertOwner(application, owner)
        return {
          address: { ...address, tool: panels.activeToolTab },
          replace: true,
          preserveTransient: true,
          beforeApply: () =>
            application.getSnapshot().editor.workspaceStore.getState().setChatModePanels(panels),
        }
      })
    },
    setSearchQuery(query: string, owner?: EditorWorkspaceStoreApi, rootPath?: string) {
      return ownedRequest(
        owner,
        ({ application, address }) => {
          assertOwner(application, owner)
          return {
            address: { ...address, search: { ...address.search, q: query } },
            replace: true,
            preserveTransient: true,
          }
        },
        rootPath,
        'continuous',
      )
    },
    selectSearchQueryHistory(direction: -1 | 1, owner: EditorWorkspaceStoreApi, rootPath?: string) {
      return ownedRequest(
        owner,
        ({ application, address }) => {
          assertOwner(application, owner)
          const store = application.getSnapshot().editor.searchBufferStore
          const next = searchHistoryQuerySnapshot(
            store.getState().active,
            rootPath ?? owner.getState().rootFolder?.path ?? '',
            direction,
          )
          return {
            address: { ...address, search: searchParamsFor(next) },
            replace: true,
            preserveTransient: true,
            beforeApply: () => store.setState({ active: next }),
          }
        },
        rootPath,
      )
    },
    setSearchOptions(
      options: SearchBufferOptionPatch,
      owner: EditorWorkspaceStoreApi,
      rootPath?: string,
    ) {
      const targetRoot = rootPath ?? owner.getState().rootFolder?.path
      if (targetRoot === undefined) return supersededNavigation()
      return ownedRequest(
        owner,
        ({ application, address }) => {
          assertOwner(application, owner)
          const store = application.getSnapshot().editor.searchBufferStore
          const prepared = store.getState().active
          const active =
            prepared?.rootPath === targetRoot ? prepared : emptySearchBuffer(targetRoot)
          return {
            address: {
              ...address,
              search: searchParamsFor({ ...active, ...options }),
            },
            replace: true,
            preserveTransient: true,
            beforeApply: () => store.getState().setSearchOptions(targetRoot, options),
          }
        },
        rootPath,
        'continuous',
      )
    },
    setLogsFilters: (filters: LogsFilterState) =>
      replaceFields({ logs: logsParamsFor(filters, defaultLogsFilterState()) }, 'continuous'),
    setSettingsCategory: (category: string | null) =>
      replaceFields({ settings: category ? settingsCategorySlug(category) : null }),
    setDiffScope(scope: SessionDiffScope, ref: ScopedSessionRef) {
      const application = coordinator.getApplication()
      if (!application || coordinator.getSnapshot().status === 'pending')
        return supersededNavigation()
      const address = coordinator.currentAddress()
      const session = captureMainSession(application)
      const token = `t/${ref.sessionId}`
      if (
        session?.environmentId !== ref.environmentId ||
        session.sessionId !== ref.sessionId ||
        address.mode !== 'chat' ||
        (address.document !== null && address.document !== token)
      )
        return supersededNavigation()
      return replaceFields({ document: token, diff: diffScopeParam(scope) })
    },
    reconcileSessions({
      environmentId,
      projectId,
      removedSessionIds,
      successorSessionId,
    }: {
      readonly environmentId: EnvironmentId
      readonly removedSessionIds: readonly SessionId[]
      readonly projectId: ProjectId
      readonly successorSessionId: SessionId | null
    }) {
      const current = coordinator.currentAddress()
      const owner = coordinator.getApplication()?.getSnapshot()
      const removed = new Set(removedSessionIds.map((id) => `t/${id}`))
      const historyTarget = historyTargetAfterSessionRemoval({
        target: router.history.location.state.platformNavigationTarget,
        removedSessionIds,
        successorSessionId,
      })
      if (
        !owner ||
        confirmedEnvironmentId(owner.origin) !== environmentId ||
        (historyTarget === undefined &&
          !removed.has(current.document ?? '') &&
          !removed.has(current.chat ?? ''))
      )
        return Promise.resolve({ status: 'superseded' } satisfies NavigationResult)
      return coordinator.request(({ application, address }) => {
        if (confirmedEnvironmentId(application.getSnapshot().origin) !== environmentId)
          return { address, replace: true, preserveTransient: true }
        const removed = new Set(removedSessionIds.map((id) => `t/${id}`))
        const token = successorSessionId ? `t/${successorSessionId}` : 't/new'
        return {
          address: {
            ...address,
            document:
              address.mode === 'chat' && address.document && removed.has(address.document)
                ? token
                : address.document,
            chat: address.chat && removed.has(address.chat) ? token : address.chat,
          },
          replace: true,
          preserveTransient: true,
          historyTarget,
          beforeApply: () => {
            if (historyTarget?.kind !== 'sidebar-chat') return
            useSidebarSelectionStore
              .getState()
              .restoreSelection({ ...historyTarget.chat, environmentId, projectId })
          },
        }
      })
    },
    removeProject(ref: ScopedProjectRef & { readonly rootPath?: string }) {
      const owner = coordinator.getApplication()?.getSnapshot()
      if (!owner || confirmedEnvironmentId(owner.origin) !== ref.environmentId)
        return supersededNavigation()
      const root = owner.editor.workspaceStore.getState().rootFolder?.path
      const slice = selectChatProjectionSlice(useChatProjectionStore.getState(), ref.environmentId)
      if (
        root === undefined ||
        (root !== ref.rootPath && selectWorktreeAtPath(slice, root)?.projectId !== ref.projectId)
      )
        return supersededNavigation()
      return coordinator.request(({ address }) => ({
        address: {
          ...emptyAddress(),
          workspace: '-',
          mode: 'workbench',
          environmentId: address.environmentId,
          passthrough: address.passthrough,
        },
        replace: true,
        historyTarget: null,
      }))
    },
    openEnvironment(environmentId: EnvironmentId) {
      return coordinator.request(async ({ application, address }) => {
        const retained = application.getEnvironment(environmentId)
        const cache = readWorkspaceCache(environmentScopedStorage(environmentId))
        const root = retained
          ? retained.editor.workspaceStore.getState().rootFolder
          : cache.rootFolder
        const next = root?.workspaceAddress
          ? await workspaceAddressFor(application, environmentId, root.workspaceAddress, address)
          : {
              ...emptyAddress(),
              workspace: '-',
              mode: address.mode ?? 'workbench',
              passthrough: address.passthrough,
            }
        return { address: { ...next, environmentId }, replace: false }
      })
    },
    startDraft: (ref: ScopedProjectRef, worktreeId?: WorktreeId) =>
      openChat({ ...ref, sessionId: null, surface: 'main', worktreeId, newDraft: true }),
    back: () => router.history.back(),
    forward: () => router.history.forward(),
    copyAddress(origin = window.location.origin) {
      const budget = budgetAddress(coordinator.currentAddress())
      return {
        href: shareableAddress(buildAddressLocation(router, budget.address).publicHref, origin),
        omissions: budget.omissions,
      }
    },
  }
}

export type Navigation = ReturnType<typeof createNavigation>

function categoryForAddress(category: string | null | undefined, current: string | null) {
  if (category === undefined) return current
  return category ? settingsCategorySlug(category) : null
}
