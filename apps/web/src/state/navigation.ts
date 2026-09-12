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
import { hasDiffDocumentSnapshot, snapshotDiffDocumentId } from '@/features/git/utils/diff-document'
import type { ChangeRow } from '@/features/git/utils/types'
import { refDocumentId } from '@/features/git/utils/ref-document'
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
import type { LanguageServerDefinitionTarget } from '@singapor/lsp-plugin'
import { createNavigationCoordinator, type NavigationResult } from '@/state/navigation-coordinator'
import type { ApplicationRouter } from '@/state/router'
import type { AddressIntent } from '@/features/address/utils/intent'
import { documentTokenForPath } from '@/features/address/utils/document-token'
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
  type EditorApplyActions,
} from '@/features/editor/state/apply-actions'
import {
  activeEditorTabForWorkbenchPanels,
  closeEditorTabInWorkbenchPanels,
  reorderEditorTabInWorkbenchPanels,
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
  previousOpenEditorPath,
  recentlyClosedEditorPathsForReopen,
} from '@/features/editor/state/tab-paths'
import type { EditorRuntime } from '@/features/editor/state/runtime'
import { settingsDocumentId } from '@/features/settings/utils/document'
import { searchBufferDocumentId } from '@/features/search/utils/buffer-document'
import type { SearchBufferOptionPatch } from '@/features/search/state/buffer-state'
import { searchParamsFor } from '@/features/address/utils/search-params'
import { logsParamsFor } from '@/features/address/utils/logs-params'
import { defaultLogsFilterState, type LogsFilterState } from '@/features/logs/utils/filter-params'
import { settingsCategorySlug } from '@/features/address/utils/settings-category'
import { shareableAddress } from '@/features/address/state/storage'
import { buildAddressLocation } from '@/features/address/utils/route-options'
import { budgetAddress } from '@/features/address/utils/snapshot'
import { createClientInvariantError } from '@/lib/structured-errors'
import type { ApplicationRuntime } from '@/state/application-runtime'
import { diffScopeParam } from '@/features/address/utils/diff-scope'
import type { SessionDiffScope } from '@/features/chat/utils/session-diff-scope-storage'

export function createNavigation(router: ApplicationRouter, initial: AddressIntent) {
  const coordinator = createNavigationCoordinator(router, initial)
  const openChat = createChatNavigation(coordinator)
  const replaceFields = (fields: Partial<Address>) =>
    coordinator.request(({ address }) => ({
      address: { ...address, ...fields },
      replace: true,
      preserveTransient: true,
    }))

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
  ) {
    const current = coordinator.getApplication()?.getSnapshot()
    if (
      !current ||
      (owner && current.editor.workspaceStore !== owner) ||
      (rootPath !== undefined &&
        current.editor.workspaceStore.getState().rootFolder?.path !== rootPath)
    )
      return Promise.resolve({ status: 'superseded' } satisfies NavigationResult)
    return coordinator.request(prepare)
  }

  function assertOwner(application: ApplicationRuntime, owner?: EditorWorkspaceStoreApi) {
    if (owner && owner !== application.getSnapshot().editor.workspaceStore)
      throw createClientInvariantError('The command belongs to a previous environment.')
  }

  function addressWithFile(
    address: Address,
    path: string,
    rootPath: string | null,
    focus: Address['focus'] = null,
  ) {
    const token = documentTokenForPath(rootPath, path)
    if (token.kind !== 'token') return null
    const tabs = address.tabs?.includes(token.token)
      ? address.tabs
      : [...(address.tabs ?? []), token.token]
    const selected =
      address.mode === 'chat' ? { editor: token.token, tool: 'editor' } : { document: token.token }
    return { ...address, ...selected, tabs, focus }
  }

  function openFile({
    owner,
    path,
    focus = null,
    replace,
    settingsCategory,
  }: {
    readonly owner?: EditorWorkspaceStoreApi
    readonly path: string
    readonly focus?: Address['focus']
    readonly replace?: boolean
    readonly settingsCategory?: string | null
  }): Promise<NavigationResult> {
    if (owner && coordinator.getApplication()?.getSnapshot().editor.workspaceStore !== owner)
      return Promise.resolve({ status: 'superseded' })
    const current = coordinator.currentAddress()
    const rootPath = owner?.getState().rootFolder?.path ?? null
    if (owner && !addressWithFile(current, path, rootPath, focus)) {
      return coordinator.transient((application) => {
        assertOwner(application, owner)
        revealEditor(application)
        const apply = actions(application)
        if (focus) apply.openDefinition(definitionTargetFor(path, focus))
        if (!focus) apply.openFileSurface(path)
      })
    }
    return ownedRequest(owner, ({ application, address }) => {
      assertOwner(application, owner)
      const root =
        application.getSnapshot().editor.workspaceStore.getState().rootFolder?.path ?? null
      const next = addressWithFile(address, path, root, focus)
      if (!next) throw createClientInvariantError('This document has no workspace address.')
      return {
        address: { ...next, settings: categoryForAddress(settingsCategory, next.settings) },
        replace: replace ?? editorDocumentToken(next) === editorDocumentToken(address),
        historyTarget: { kind: 'editor' },
        beforeApply: () => revealEditor(application),
      }
    })
  }

  function addressForPanels(
    address: Address,
    panels: WorkbenchPanels,
    rootPath: string | null,
    focus: Address['focus'] = null,
  ) {
    const selected = activeEditorTabForWorkbenchPanels(panels)
    if (selected) return addressWithFile(address, selected.path, rootPath, focus) ?? address
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
      const tabs = panels.editorTabs.flatMap((tab) => {
        const token = documentTokenForPath(rootPath, tab.path)
        return token.kind === 'token' ? [token.token] : []
      })
      return {
        address: { ...next, tabs, side: panels.activeSidebarTab, bottom: panels.activeBottomTab },
        replace:
          next.mode === address.mode && editorDocumentToken(next) === editorDocumentToken(address),
        historyTarget: historyTargetForEditorChange(address, next),
        preserveTransient: true,
        beforeApply: () => editor.workspaceStore.getState().setWorkbenchPanels(panels),
      }
    })
  }

  function closeTabs(tabIds: readonly string[], owner: EditorWorkspaceStoreApi, discard = false) {
    if (tabIds.length === 0)
      return Promise.resolve({ status: 'applied' } satisfies NavigationResult)
    return ownedRequest(owner, ({ application, address }) => {
      assertOwner(application, owner)
      const workspace = owner.getState()
      const panels = tabIds.reduce(closeEditorTabInWorkbenchPanels, workspace.workbenchPanels)
      const next = addressForPanels(address, panels, workspace.rootFolder?.path ?? null)
      const tabs = panels.editorTabs.flatMap((tab) => {
        const token = documentTokenForPath(workspace.rootFolder?.path ?? null, tab.path)
        return token.kind === 'token' ? [token.token] : []
      })
      return {
        address: { ...next, tabs },
        replace: editorDocumentToken(next) === editorDocumentToken(address),
        historyTarget: historyTargetForEditorChange(address, next),
        preserveTransient: true,
        beforeApply: () => {
          const apply = actions(application)
          for (const tabId of tabIds) {
            if (discard) apply.discardAndCloseTab(tabId)
            if (!discard) apply.closeTab(tabId)
          }
        },
      }
    })
  }

  function editorCommands(owner: EditorWorkspaceStoreApi) {
    return {
      openFileSurface: (path: string) => openFile({ owner, path }),
      selectFile: (path: string | null) =>
        path
          ? openFile({ owner, path })
          : Promise.resolve({ status: 'applied' } satisfies NavigationResult),
      openDefinition: (target: LanguageServerDefinitionTarget) => {
        if (coordinator.getApplication()?.getSnapshot().editor.workspaceStore !== owner)
          return supersededNavigation()
        if (
          documentTokenForPath(owner.getState().rootFolder?.path ?? null, target.path).kind !==
          'token'
        ) {
          return coordinator.transient((application) => {
            revealEditor(application)
            actions(application).openDefinition(target)
          })
        }
        return openFile({
          owner,
          path: target.path,
          focus: {
            line: target.range.start.line + 1,
            column: target.range.start.character + 1,
            endLine:
              target.range.end.line > target.range.start.line ? target.range.end.line + 1 : null,
          },
        })
      },
      openSearchEditor: (rootPath: string) =>
        openFile({ owner, path: searchBufferDocumentId(rootPath) }),
      openSettingsEditor: (category?: string | null) =>
        openFile({ owner, path: settingsDocumentId(), settingsCategory: category }),
      selectTab: (_paneId: string, tabId: string) => {
        const tab = owner.getState().workbenchPanels.editorTabs.find((item) => item.id === tabId)
        return tab
          ? openFile({ owner, path: tab.path })
          : Promise.resolve({ status: 'superseded' } satisfies NavigationResult)
      },
      closeTab: (tabId: string) => closeTabs([tabId], owner),
      closeTabs: (tabIds: readonly string[]) => closeTabs(tabIds, owner),
      discardAndCloseTabs: (tabIds: readonly string[]) => closeTabs(tabIds, owner, true),
      discardAndCloseTab: (tabId: string) => closeTabs([tabId], owner, true),
      reorderTab: (_paneId: string, tabId: string, targetIndex: number) =>
        setWorkbenchPanels(
          reorderEditorTabInWorkbenchPanels(owner.getState().workbenchPanels, tabId, targetIndex),
          owner,
        ),
      selectPreviousEditor: () => {
        const state = owner.getState()
        const path = previousOpenEditorPath(
          state.editorHistory,
          state.openFilePaths,
          state.selectedFilePath,
        )
        return path
          ? openFile({ owner, path })
          : Promise.resolve({ status: 'superseded' } satisfies NavigationResult)
      },
      reopenClosedEditor: async () => {
        const path = owner.getState().recentlyClosedEditorPaths[0]
        if (!path) return { status: 'superseded' } satisfies NavigationResult
        const result = await openFile({ owner, path })
        if (result.status !== 'applied') return result
        const state = owner.getState()
        state.setRecentlyClosedEditorPaths(
          recentlyClosedEditorPathsForReopen(state.recentlyClosedEditorPaths, path),
        )
        return result
      },
      renameLiveEditorDocument: (from: string, to: string) => {
        const editor = coordinator.getApplication()?.getEditorForWorkspace(owner)
        if (!editor) return { wasDirty: false, settled: supersededNavigation() }
        const { wasDirty } = editorActions(editor).renameLiveEditorDocument(from, to)
        const settled = coordinator.reconcileAddress(owner, (address, root) =>
          addressForRenamedFile(address, root, from, to),
        )
        return { wasDirty, settled }
      },
      discardLiveEditorDocument: (path: string) => {
        const editor = coordinator.getApplication()?.getEditorForWorkspace(owner)
        if (!editor) return { wasDirty: false, settled: supersededNavigation() }
        const { wasDirty } = editorActions(editor).discardLiveEditorDocument(path)
        const settled = coordinator.reconcileAddress(owner, (address, root) =>
          addressForDeletedFile(address, root, path),
        )
        return { wasDirty, settled }
      },
      moveTabToPane: (..._args: Parameters<EditorApplyActions['moveTabToPane']>) => false,
      moveTabToSplit: (..._args: Parameters<EditorApplyActions['moveTabToSplit']>) => false,
      splitTab: (..._args: Parameters<EditorApplyActions['splitTab']>) => false,
      setActivePane: (..._args: Parameters<EditorApplyActions['setActivePane']>): void => undefined,
    }
  }

  return {
    router,
    initial,
    attach: coordinator.attach,
    dispose: coordinator.dispose,
    subscribe: coordinator.subscribe,
    getSnapshot: coordinator.getSnapshot,
    currentAddress: coordinator.currentAddress,
    permitsRecentRoot: coordinator.permitsRecentRoot,
    openFile,
    openChat,
    openWorkspace,
    openDiff({ owner, row }: { readonly owner: EditorWorkspaceStoreApi; readonly row: ChangeRow }) {
      return ownedRequest(owner, async ({ application, address, signal }) => {
        const staged = row.section === 'staged'
        const diffs = await application.getSnapshot().queryClient.fetchQuery({
          queryFn: ({ signal: querySignal, client }) =>
            fetchDiff(
              row.file.path,
              staged,
              AbortSignal.any([signal, querySignal]),
              clientForQueryClient(client),
            ),
          queryKey: gitKeys.diff(row.file.path, staged),
          staleTime: 1000,
        })
        const diff = diffs.find(
          (entry) => entry.path === row.file.path || entry.oldPath === row.file.path,
        )
        if (!diff || !hasDiffDocumentSnapshot(diff))
          throw createClientInvariantError('The requested change has no available file snapshot.')
        const next = addressWithFile(
          address,
          snapshotDiffDocumentId(diff),
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
      readonly path: string
      readonly ref: string
    }) {
      return ownedRequest(owner, async ({ application, address, signal, isCurrent }) => {
        const runtime = application.getSnapshot()
        const file = await runtime.queryClient.fetchQuery({
          queryKey: gitKeys.file(path, ref),
          staleTime: Infinity,
          queryFn: ({ signal: querySignal, client }) =>
            fetchGitFile(
              path,
              ref,
              AbortSignal.any([signal, querySignal]),
              clientForQueryClient(client),
            ),
        })
        const documentId = refDocumentId({ path, ref })
        const next = addressWithFile(address, documentId, owner.getState().rootFolder?.path ?? null)
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
                .ensureUnsyncedEditorDocument({ content: file.content, id: documentId })
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
      )
    },
    setLogsFilters: (filters: LogsFilterState) =>
      replaceFields({ logs: logsParamsFor(filters, defaultLogsFilterState()) }),
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

function supersededNavigation(): Promise<NavigationResult> {
  return Promise.resolve({ status: 'superseded' })
}
