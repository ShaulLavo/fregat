import { workspaceRoot } from '@/lib/documents/utils/identity'
import type { FilesystemPath, TabId } from '@/lib/documents/utils/types'
import { FileSyncService } from '@/features/editor/state/file-sync-service'
import { EditorSaveService } from '@/features/editor/state/save-service'
import { SettingsSyncService } from '@/features/settings/state/sync-service'
import type { QueryClient } from '@tanstack/react-query'
import { use, useEffect, useRef, useState, type ReactNode } from 'react'
import { ApplicationRuntimeContext } from '@/providers/application-runtime-context'
import { NavigationContext } from '@/providers/navigation-context'
import type { ApplicationRuntime } from '@/state/application-runtime'
import type { Navigation } from '@/state/navigation'

import { createDefaultChatModePanels } from '@/features/chat-mode/utils/panels'
import type { PaletteScope } from '@/features/command-palette/command-palette-types'
import { paletteScopeForPrefix } from '@/features/command-palette/command-palette-utils'
import type { EditorCommands } from '@/features/editor/state/commands'
import { createEditorApplyActions } from '@/features/editor/state/apply-actions'
import {
  createEditorDocumentStore,
  type EditorDocumentStoreApi,
} from '@/features/editor/state/document-state'
import { createEditorUiStore } from '@/features/editor/state/ui-state'
import type { WorkspaceMutationReporter } from '@/features/editor/state/workspace-edit-service'
import {
  createEditorWorkspaceStore,
  type EditorWorkspaceStoreApi,
} from '@/features/editor/state/workspace-state'
import { DEFAULT_DIFF_VIEW_MODE } from '@/features/editor/utils/diff-view-mode'
import { createSearchBufferStore } from '@/features/search/state/buffer-state'
import type { SettingsSubmission } from '@workspace/client-core/settings/intent-store'
import { createDefaultWorkbenchLayout } from '@/features/workbench/utils/layout'
import { emptyWorkspaceSlice, type CachedWorkspaceState } from '@/features/workspace/state/cache'
import { defaultPlatformKeyBindings } from '@/keymap/default-bindings'
import type { WorkspaceCommandRuntime, WorkspaceCommandSnapshot } from '@/keymap/define-command'
import {
  CommandContext,
  type CommandContextValue,
  type PlatformCommandBus,
} from '@/keymap/providers/command-context'
import { createCommandBus } from '@/keymap/state/command-bus'
import type { PlatformKeyBinding } from '@/keymap/types'
import { useAppKeymap } from '@/keymap/use-app-keymap'
import {
  captureCommandSnapshot,
  dispatchEditor,
  lookupPlatformCommand,
  openWorkspaceSettings,
  resolveCommandTarget,
} from '@/keymap/state/runtime'
import { useFocusService } from '@/lib/focus/hooks/use-service'
import { useFocusSnapshot } from '@/lib/focus/hooks/use-snapshot'
import {
  focusTargetById,
  registeredFocusTarget,
  type FocusService,
  type FocusTargetToken,
} from '@/lib/focus/state/service'

export type TestCommandRuntimeOverrides = {
  readonly documents?: Partial<WorkspaceCommandRuntime['documents']>
  readonly editor?: Partial<WorkspaceCommandRuntime['editor']>
  readonly files?: Partial<WorkspaceCommandRuntime['files']>
  readonly settings?: Partial<WorkspaceCommandRuntime['settings']>
  readonly shell?: Partial<WorkspaceCommandRuntime['shell']>
  readonly tabs?: Partial<WorkspaceCommandRuntime['tabs']>
  readonly workspace?: EditorWorkspaceStoreApi
  readonly workspaceEdits?: WorkspaceCommandRuntime['workspaceEdits']
}

type TestCommandSnapshotSource =
  | Partial<WorkspaceCommandSnapshot>
  | (() => Partial<WorkspaceCommandSnapshot>)

export type TestCommandRuntimeOptions = {
  readonly bindings?: readonly PlatformKeyBinding[]
  readonly paletteOpen?: boolean
  readonly paletteOrigin?: FocusTargetToken | null
  readonly paletteSearch?: string
  readonly rootPath?: string | null
  readonly runtime?: TestCommandRuntimeOverrides
  readonly snapshot?: TestCommandSnapshotSource
}

export type TestCommandRuntime = {
  readonly bindings: readonly PlatformKeyBinding[]
  readonly bus: PlatformCommandBus
  readonly captureSnapshot: () => WorkspaceCommandSnapshot
  readonly runtime: WorkspaceCommandRuntime
}

export function createTestCommandRuntime({
  application,
  focus,
  navigation,
  options = {},
  queryClient,
}: {
  readonly application?: ApplicationRuntime
  readonly focus: FocusService
  readonly navigation?: Navigation
  readonly options?: TestCommandRuntimeOptions
  readonly queryClient: QueryClient
}): TestCommandRuntime {
  const runtime = createRuntime(focus, queryClient, options, application, navigation)
  const captureSnapshot = () => ({
    ...captureCommandSnapshot(runtime),
    ...snapshotPatch(options.snapshot),
  })
  const bus = createCommandBus({
    captureSnapshot,
    dispatchEditor,
    lookup: lookupPlatformCommand,
    now: Date.now,
    resolveTarget: ({ entry, invocation, snapshot }) =>
      resolveCommandTarget(runtime, entry.target, invocation, snapshot),
    captureRuntime: () => runtime,
    targetIsAvailable: (target) =>
      target.kind === 'workspace' || runtime.focus.isRegistered(target.token),
  })

  return {
    bindings: options.bindings ?? defaultPlatformKeyBindings(),
    bus,
    captureSnapshot,
    runtime,
  }
}

export function TestCommandProvider({
  children,
  options = {},
  queryClient,
}: {
  readonly children: ReactNode
  readonly options?: TestCommandRuntimeOptions
  readonly queryClient: QueryClient
}) {
  const application = use(ApplicationRuntimeContext) ?? undefined
  const navigation = use(NavigationContext) ?? undefined
  const focus = useFocusService()
  const focusSnapshot = useFocusSnapshot()
  const [paletteOpen, setPaletteOpenState] = useState(options.paletteOpen ?? false)
  const [paletteOrigin, setPaletteOrigin] = useState(options.paletteOrigin ?? null)
  const [paletteSearch, setPaletteSearch] = useState(options.paletteSearch ?? '')
  const [paletteScope, setPaletteScope] = useState<PaletteScope | null>(null)
  // `showCommandPalette` is built once, so it reads palette state through refs.
  const paletteOpenRef = useRef(options.paletteOpen ?? false)
  const paletteSearchRef = useRef(options.paletteSearch ?? '')
  const paletteScopeRef = useRef<PaletteScope | null>(null)
  const paletteRestoreRef = useRef<FocusTargetToken | null | undefined>(undefined)
  const [commandRuntime] = useState(() => {
    const showCommandPalette = options.runtime?.shell?.showCommandPalette
    if (showCommandPalette)
      return createTestCommandRuntime({ application, navigation, focus, options, queryClient })

    const runtime = withShellOverride(options.runtime, {
      showCommandPalette: (initialSearch = '', origin) => {
        setPaletteOrigin(origin ?? focus.captureOrigin())
        openPaletteAt(initialSearch)
        paletteOpenRef.current = true
        setPaletteOpenState(true)
        return focus.request(focusTargetById({ kind: 'command-palette' }))
      },
    })
    return createTestCommandRuntime({
      application,
      navigation,
      focus,
      options: { ...options, runtime },
      queryClient,
    })
  })

  // Mirrors the app provider: a sub-picker prefix becomes a scope with an empty input,
  // a root prefix stays text.
  function openPaletteAt(initialSearch: string) {
    const mode = paletteScopeForPrefix(initialSearch)
    if (!mode) {
      applyPaletteScope(null)
      applyPaletteSearch(initialSearch)
      return
    }

    applyPaletteScope({ mode, returnSearch: paletteScopeReturnSearch() })
    applyPaletteSearch('')
  }

  function paletteScopeReturnSearch() {
    const current = paletteScopeRef.current
    if (current) return current.returnSearch
    if (!paletteOpenRef.current) return null

    return paletteSearchRef.current
  }

  function applyPaletteSearch(search: string) {
    paletteSearchRef.current = search
    setPaletteSearch(search)
  }

  function applyPaletteScope(scope: PaletteScope | null) {
    paletteScopeRef.current = scope
    setPaletteScope(scope)
  }

  function popPaletteScope() {
    const scope = paletteScopeRef.current
    if (!scope) return

    applyPaletteScope(null)
    if (scope.returnSearch === null) {
      closePalette(true)
      return
    }

    applyPaletteSearch(scope.returnSearch)
  }

  function closePalette(restoreOrigin: boolean) {
    paletteRestoreRef.current = restoreOrigin ? paletteOrigin : undefined
    paletteOpenRef.current = false
    applyPaletteScope(null)
    setPaletteOpenState(false)
    setPaletteOrigin(null)
  }

  function setPaletteOpen(open: boolean) {
    if (open) {
      paletteRestoreRef.current = undefined
      paletteOpenRef.current = true
      setPaletteOpenState(true)
      return
    }

    closePalette(true)
  }

  useEffect(() => {
    if (paletteOpen) {
      paletteRestoreRef.current = undefined
      return
    }

    const origin = paletteRestoreRef.current
    if (origin === undefined) return

    paletteRestoreRef.current = undefined
    restoreOriginTarget(focus, origin)
  }, [focus, paletteOpen])

  const keymap = useAppKeymap({
    bindings: commandRuntime.bindings,
    bus: commandRuntime.bus,
    focus,
    focusedPane: focusSnapshot.currentOwner?.area ?? 'global',
    focusedTarget: focusSnapshot.currentOwner?.token ?? null,
  })
  const value: CommandContextValue = {
    bindings: commandRuntime.bindings,
    bus: commandRuntime.bus,
    claimKeybinding: keymap.claimKeybinding,
    closePalette,
    openWorkspaceRoot: commandRuntime.runtime.shell.openWorkspaceRoot,
    paletteOpen,
    paletteOrigin,
    paletteScope,
    paletteSearch,
    pendingChord: keymap.pendingChord,
    popPaletteScope,
    setPaletteOpen,
    setPaletteSearch,
  }

  return <CommandContext value={value}>{children}</CommandContext>
}

function createRuntime(
  focus: FocusService,
  queryClient: QueryClient,
  options: TestCommandRuntimeOptions,
  application?: ApplicationRuntime,
  navigation?: Navigation,
): WorkspaceCommandRuntime {
  const overrides = options.runtime
  const owner = application?.getSnapshot().editor
  const workspace =
    overrides?.workspace ??
    owner?.workspaceStore ??
    createTestWorkspaceStore(options.rootPath ?? null)
  const store = overrides?.documents?.store ?? owner?.documentStore ?? createEditorDocumentStore()
  const documents: WorkspaceCommandRuntime['documents'] = {
    queryClient,
    store,
    save:
      owner?.documentStore === store
        ? owner.saveService
        : new EditorSaveService(
            store,
            new FileSyncService(store, queryClient),
            new SettingsSyncService(store, queryClient),
          ),
    ...overrides?.documents,
  }
  const editor =
    navigation && owner?.workspaceStore === workspace && owner.documentStore === store
      ? { ...navigation.editorCommands(workspace), ...overrides?.editor }
      : createTestEditor(documents.store, workspace, overrides?.editor)
  const files: WorkspaceCommandRuntime['files'] = {
    openFileAtRef: async () => false,
    ...overrides?.files,
  }
  const settings: WorkspaceCommandRuntime['settings'] = {
    setDiffViewMode: noopSettingsSubmission,
    setTheme: noopSettingsSubmission,
    setWallpaperEnabled: noopSettingsSubmission,
    ...overrides?.settings,
    readSnapshot: overrides?.settings?.readSnapshot ?? defaultSettingsSnapshot,
  }
  const shell: WorkspaceCommandRuntime['shell'] = {
    showEnvironmentDialog: () => {},
    showMachines: () => {},
    openPicker: () => workspace.getState().openPicker(),
    openWorkspaceRoot: (rootPath) => openTestWorkspaceRoot(rootPath, workspace),
    showCommandPalette: () => focus.request(focusTargetById({ kind: 'command-palette' })),
    showSettings: () => showTestSettings(editor, focus, workspace),
    ...overrides?.shell,
  }
  const tabs: WorkspaceCommandRuntime['tabs'] = {
    requestCloseTab: (tabId) => closeTestTab(tabId, editor, workspace),
    ...overrides?.tabs,
  }
  const workspaceEdits: WorkspaceCommandRuntime['workspaceEdits'] = overrides?.workspaceEdits ?? {
    canMutateWorkspace: () => true,
    getSnapshot: () =>
      ({ canRedo: false, canUndo: false }) as ReturnType<
        WorkspaceCommandRuntime['workspaceEdits']['getSnapshot']
      >,
    redo: async () => false,
    runWorkspaceMutation: async <T,>(
      _affectedPaths: readonly FilesystemPath[] | 'all',
      operation: (reportAffectedPaths: WorkspaceMutationReporter) => Promise<T>,
    ) => operation(() => undefined),
    undo: async () => false,
  }

  return { documents, editor, files, focus, settings, shell, tabs, workspace, workspaceEdits }
}

function createTestEditor(
  documentStore: EditorDocumentStoreApi,
  workspaceStore: EditorWorkspaceStoreApi,
  overrides?: Partial<EditorCommands>,
): EditorCommands {
  const apply = createEditorApplyActions({
    retainedTextBudget: () => Number.MAX_SAFE_INTEGER,
    activation: { activate: () => undefined, setRoot: () => undefined },
    documentStore,
    searchStore: createSearchBufferStore({ rootPath: workspaceStore.getState().rootFolder?.path }),
    uiStore: createEditorUiStore(),
    workspaceStore,
  })

  const applied = () => Promise.resolve({ status: 'applied' } as const)
  const editor: EditorCommands = {
    ...apply,
    openTabContent: (content) => {
      apply.openTabContent(content)
      return applied()
    },
    openFileSurface: (path) => {
      apply.openFileSurface(path)
      return applied()
    },
    selectContent: (content) => {
      apply.selectContent(content)
      return applied()
    },
    selectFile: (path) => {
      apply.selectFile(path)
      return applied()
    },
    openDefinition: (target) => {
      apply.openDefinition(target)
      return applied()
    },
    openSearchEditor: (rootPath) => {
      apply.openSearchEditor(rootPath)
      return applied()
    },
    openSettingsEditor: () => {
      apply.openSettingsEditor()
      return applied()
    },
    selectTab: (paneId, tabId) => {
      apply.selectTab(paneId, tabId)
      return applied()
    },
    closeTab: (tabId) => {
      apply.closeTab(tabId)
      return applied()
    },
    closeTabs: (tabIds) => {
      tabIds.forEach(apply.closeTab)
      return applied()
    },
    discardAndCloseTab: (tabId) => {
      apply.discardAndCloseTab(tabId)
      return applied()
    },
    discardAndCloseTabs: (tabIds) => {
      tabIds.forEach(apply.discardAndCloseTab)
      return applied()
    },
    reorderTab: (paneId, tabId, index) => {
      apply.reorderTab(paneId, tabId, index)
      return applied()
    },
    selectPreviousEditor: () => {
      apply.selectPreviousEditor()
      return applied()
    },
    reopenClosedEditor: () => {
      apply.reopenClosedEditor()
      return applied()
    },
    renameLiveEditorDocument: (from, to) => ({
      ...apply.renameLiveEditorDocument(from, to),
      settled: applied(),
    }),
    discardLiveEditorDocument: (path) => ({
      ...apply.discardLiveEditorDocument(path),
      settled: applied(),
    }),
  }
  return { ...editor, ...overrides }
}

function createTestWorkspaceStore(rootPath: string | null) {
  const rootFolder = rootPath ? pickedDirectory(rootPath) : null
  const workspaces = rootPath ? { [rootPath]: emptyWorkspaceSlice() } : {}
  const state: CachedWorkspaceState = {
    chatModePanels: createDefaultChatModePanels(),
    rootFolder,
    searchBuffers: {},
    uiMode: 'workbench',
    workbenchLayout: createDefaultWorkbenchLayout(),
    worktreeIdByRootPath: {},
    workspaceOrder: rootPath ? [rootPath] : [],
    workspaces,
  }

  return createEditorWorkspaceStore(state)
}

function pickedDirectory(path: string) {
  return {
    birthtimeMs: 0,
    mtimeMs: 0,
    name: path.split('/').filter(Boolean).at(-1) ?? path,
    path: workspaceRoot(path),
    size: 0,
    type: 'directory' as const,
    version: '',
  }
}

function noopSettingsSubmission(): SettingsSubmission {
  return { kind: 'noop' }
}

function defaultSettingsSnapshot() {
  return { diffViewMode: DEFAULT_DIFF_VIEW_MODE, wallpaperEnabled: true } as const
}

async function openTestWorkspaceRoot(rootPath: FilesystemPath, workspace: EditorWorkspaceStoreApi) {
  if (workspace.getState().rootFolder?.path === rootPath) return 'already-open' as const

  workspace.getState().switchWorkspace(pickedDirectory(rootPath))
  return 'opened' as const
}

function showTestSettings(
  editor: EditorCommands,
  focus: FocusService,
  workspace: EditorWorkspaceStoreApi,
) {
  if (!workspace.getState().rootFolder) {
    return focus.request(focusTargetById({ kind: 'settings-dialog' }))
  }

  return openWorkspaceSettings(focus, workspace, editor)
}

function closeTestTab(tabId: TabId, editor: EditorCommands, workspace: EditorWorkspaceStoreApi) {
  const open = workspace.getState().workbenchPanels.editorTabs.some((tab) => tab.id === tabId)
  if (!open) return { reason: 'not-found', status: 'rejected' } as const

  const completion = editor.closeTab(tabId)
  return { status: 'closed', tabIds: [tabId], completion } as const
}

function snapshotPatch(source?: TestCommandSnapshotSource) {
  if (!source) return {}

  return typeof source === 'function' ? source() : source
}

function withShellOverride(
  runtime: TestCommandRuntimeOverrides | undefined,
  shell: Partial<WorkspaceCommandRuntime['shell']>,
): TestCommandRuntimeOverrides {
  return {
    ...runtime,
    shell: { ...runtime?.shell, ...shell },
  }
}

function restoreOriginTarget(focus: FocusService, origin: FocusTargetToken | null) {
  if (!origin || !focus.isRegistered(origin)) return

  const current = focus.getSnapshot().currentOwner
  if (current?.token === origin) return
  if (current && current.id.kind !== 'command-palette') return

  focus.request(registeredFocusTarget(origin))
}
