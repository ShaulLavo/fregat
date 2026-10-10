import { selectSettingsProject } from '@/lib/project-settings/state/selection'
import { activeEditorTabForWorkbenchPanels } from '@/features/workbench/utils/panels'
import { wallpaperLibraryOptions } from '@/lib/wallpapers/state/queries'
import { selectSettingsSearch } from '@/features/settings/state/search-store'
import { selectSettingsView } from '@/features/settings/state/view-store'
import { selectSettingsScope } from '@/features/settings/state/scope-store'
import { useEditorRuntime } from '@/features/editor/hooks/use-runtime'
import { filesystemPath } from '@/lib/documents/utils/identity'
import { DeferredOverlay } from '@/components/deferred-overlay'
import { pickerDialogModuleQueryOptions } from '@/features/environments/utils/picker-dialog-module'
import { CloneRepositoryDialog } from '@/features/git/components/clone-repository-dialog'
import { StartPullRequestSessionDialog } from '@/features/chat-mode/components/start-pull-request-session-dialog'
import { parentPath } from '@/lib/path-formatters'
import { workspaceRoot } from '@/lib/documents/utils/identity'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { DEFAULT_SETTING_VALUES, type SettingsSnapshot } from '@workspace/contracts'

import { AppKeymapController } from '@/app-keymap-controller'
import { CommandPalette } from '@/components/command-palette'
import type { PaletteScope } from '@/features/command-palette/utils/types'
import { paletteScopeForPrefix } from '@/features/command-palette/utils/query'
import { useEditorTabActions } from '@/features/editor/hooks/use-editor-tab-actions'
import { useEditorCommands } from '@/features/editor/hooks/use-editor-commands'
import { useEditorDocumentStoreApi } from '@/features/editor/state/document-state'
import {
  useEditorWorkspaceStoreApi,
  useEditorWorkspaceState,
} from '@/features/editor/state/workspace-state'
import { useWorkspaceEditService } from '@/features/editor/providers/workspace-edit-context'
import { useOpenFileAtRef } from '@/features/git/hooks/use-open-file-at-ref'
import { SettingsDialog } from '@/features/settings/components/dialog'
import { useSettingValue } from '@/hooks/use-setting-value'
import { readSettingBootValue } from '@/lib/settings-boot-mirror'
import { useSettingsActions } from '@/features/settings/hooks/use-settings-actions'
import { useSettingsOwner } from '@/lib/settings-owner/hooks/use-settings-owner'
import { useSettingsStream } from '@/features/settings/hooks/use-settings-stream'
import { useTheme } from '@/features/settings/hooks/use-theme'
import { readLiveSettingsProjection } from '@/features/settings/state/live-projection'
import { useOpenWorkspaceRoot } from '@/features/workspace/hooks/use-open-root'
import { displayPlatformKeyBindings, resolvedPlatformKeyBindings } from '@/keymap/active-bindings'
import { defaultPlatformKeyBindings } from '@/keymap/default-bindings'
import { KeyBindingsContext } from '@/keymap/providers/bindings-context'
import { createComposerAttach } from '@/features/chat/state/composer-attach'
import { useAppKeymap } from '@/keymap/use-app-keymap'
import type { WindowKeymap } from '@/keymap/state/window-keymap'
import type { WorkspaceCommandRuntime, WorkspaceCommandSnapshot } from '@/keymap/define-command'
import { CommandContext, type CommandContextValue } from '@/keymap/providers/command-context'
import { useBusBinding } from '@/keymap/hooks/use-bus-binding'
import { openWorkspaceSettings } from '@/keymap/state/runtime'
import { useFocusService } from '@/lib/focus/hooks/use-service'
import {
  focusTargetById,
  registeredFocusTarget,
  type FocusTargetToken,
} from '@/lib/focus/state/service'

type RuntimeAdapters = {
  readonly editor: ReturnType<typeof useEditorCommands>
  readonly openFileAtRef: ReturnType<typeof useOpenFileAtRef>
  readonly openWorkspaceRoot: ReturnType<typeof useOpenWorkspaceRoot>
  readonly requestCloseTab: ReturnType<typeof useEditorTabActions>['requestCloseTab']
  readonly setDiffViewMode: ReturnType<typeof useSettingsActions>['setSetting']
  readonly setTheme: ReturnType<typeof useTheme>['setTheme']
  readonly setWallpaperEnabled: ReturnType<typeof useSettingsActions>['setSetting']
}

type SnapshotSettings = {
  readonly diffViewMode: WorkspaceCommandSnapshot['diffViewMode']
  readonly wallpaperEnabled: boolean
  readonly wallpaperSelection: SettingsSnapshot['values']['workbench.wallpaper']
}

function runtimeAdapters({
  editor,
  openFileAtRef,
  openWorkspaceRoot,
  requestCloseTab,
  settings,
  theme,
}: {
  readonly editor: ReturnType<typeof useEditorCommands>
  readonly openFileAtRef: ReturnType<typeof useOpenFileAtRef>
  readonly openWorkspaceRoot: ReturnType<typeof useOpenWorkspaceRoot>
  readonly requestCloseTab: ReturnType<typeof useEditorTabActions>['requestCloseTab']
  readonly settings: ReturnType<typeof useSettingsActions>
  readonly theme: ReturnType<typeof useTheme>
}): RuntimeAdapters {
  return {
    editor,
    openFileAtRef,
    openWorkspaceRoot,
    requestCloseTab,
    setDiffViewMode: settings.setSetting,
    setTheme: theme.setTheme,
    setWallpaperEnabled: settings.setSetting,
  }
}

export function CommandProvider({ children }: { readonly children: ReactNode }) {
  const focus = useFocusService()
  const editorRuntime = useEditorRuntime()
  const documentStore = useEditorDocumentStoreApi()
  const workspace = useEditorWorkspaceStoreApi()
  const workspaceEdits = useWorkspaceEditService()
  const queryClient = useQueryClient()
  const settingsOwner = useSettingsOwner()
  const editor = useEditorCommands()
  const openFileAtRef = useOpenFileAtRef()
  const openWorkspaceRoot = useOpenWorkspaceRoot()
  const { requestCloseTab } = useEditorTabActions()
  const settings = useSettingsActions()
  const theme = useTheme()
  const overrides = useSettingValue('keybindings.overrides')
  const preset = useSettingValue('keybindings.preset')
  const [paletteOpen, setPaletteOpenState] = useState(false)
  const [paletteSearch, setPaletteSearchState] = useState('')
  const [paletteScope, setPaletteScopeState] = useState<PaletteScope | null>(null)
  const [paletteOrigin, setPaletteOrigin] = useState<FocusTargetToken | null>(null)
  // The folder a clone lands beside; null while the dialog is closed.
  const [cloneParent, setCloneParent] = useState<string | null>(null)
  // The checkout a pull request session forks from; null while that dialog is closed.
  const [pullRequestDialog, setPullRequestDialog] = useState<{ rootPath: string | null } | null>(
    null,
  )
  const [environmentDialog, setEnvironmentDialog] = useState<
    'switch' | 'connect' | 'disconnect' | null
  >(null)
  const settingsOpen = useEditorWorkspaceState(
    (state) => state.rootFolder === null && state.selectedTabContent?.kind === 'settings',
  )
  const [settingsOrigin, setSettingsOrigin] = useState<FocusTargetToken | null>(null)
  const adaptersRef = useRef(
    runtimeAdapters({
      editor,
      openFileAtRef,
      openWorkspaceRoot,
      requestCloseTab,
      settings,
      theme,
    }),
  )
  const paletteOpenRef = useRef(false)
  // The command runtime is built once and dispatches long after that render, so the
  // palette state it reads has to come from refs rather than a stale closure.
  const paletteSearchRef = useRef('')
  const paletteScopeRef = useRef<PaletteScope | null>(null)
  const paletteRestoreRef = useRef<FocusTargetToken | null | undefined>(undefined)
  const settingsRestoreRef = useRef<FocusTargetToken | null | undefined>(undefined)

  useLayoutEffect(() => {
    adaptersRef.current = runtimeAdapters({
      editor,
      openFileAtRef,
      openWorkspaceRoot,
      requestCloseTab,
      settings,
      theme,
    })
  }, [editor, openFileAtRef, openWorkspaceRoot, requestCloseTab, settings, theme])

  useSettingsStream()

  const setPaletteSearch = (search: string) => {
    paletteSearchRef.current = search
    setPaletteSearchState(search)
  }
  const setPaletteScope = (scope: PaletteScope | null) => {
    paletteScopeRef.current = scope
    setPaletteScopeState(scope)
  }
  /**
   * Root prefixes go into the input as text, the way the user would have typed them.
   * A sub-picker prefix becomes a scope instead, opening on an empty query.
   */
  const openPaletteAt = (initialSearch: string) => {
    const mode = paletteScopeForPrefix(initialSearch)
    if (!mode) {
      setPaletteScope(null)
      setPaletteSearch(initialSearch)
      return
    }

    setPaletteScope({ mode, returnSearch: paletteScopeReturnSearch() })
    setPaletteSearch('')
  }
  /**
   * What Backspace on an empty input pops back to. A scope pushed from inside another
   * keeps the first one's answer — the command list it was opened from, not the picker
   * in between — and one pushed with the palette shut has nothing to go back to.
   */
  const paletteScopeReturnSearch = () => {
    const current = paletteScopeRef.current
    if (current) return current.returnSearch
    if (!paletteOpenRef.current) return null

    return paletteSearchRef.current
  }

  const { binding, bus } = useBusBinding()
  const keymapRef = useRef<WindowKeymap | null>(null)
  const [runtime] = useState<WorkspaceCommandRuntime>(() => ({
    keymap: {
      dispatch: (command, invocation) =>
        keymapRef.current?.dispatchCommand(command, invocation) ?? false,
    },
    composer: createComposerAttach(bus),
    documents: { queryClient, store: documentStore, save: editorRuntime.saveService },
    editorUi: editorRuntime.uiStore,
    editor: {
      closeTab: (...args) => adaptersRef.current.editor.closeTab(...args),
      closeTabs: (...args) => adaptersRef.current.editor.closeTabs(...args),
      discardAndCloseTabs: (...args) => adaptersRef.current.editor.discardAndCloseTabs(...args),
      discardAndCloseTab: (...args) => adaptersRef.current.editor.discardAndCloseTab(...args),
      discardLiveEditorDocument: (...args) =>
        adaptersRef.current.editor.discardLiveEditorDocument(...args),
      placeTab: (...args) => adaptersRef.current.editor.placeTab(...args),
      resizeEditorSplit: (...args) => adaptersRef.current.editor.resizeEditorSplit(...args),
      requestMoveTab: (...args) => adaptersRef.current.editor.requestMoveTab(...args),
      openDefinition: (...args) => adaptersRef.current.editor.openDefinition(...args),
      openTabContent: (...args) => adaptersRef.current.editor.openTabContent(...args),
      selectContent: (...args) => adaptersRef.current.editor.selectContent(...args),
      openFileSurface: (...args) => adaptersRef.current.editor.openFileSurface(...args),
      openSearchEditor: (...args) => adaptersRef.current.editor.openSearchEditor(...args),
      openSettingsEditor: (...args) => adaptersRef.current.editor.openSettingsEditor(...args),
      reopenClosedEditor: (...args) => adaptersRef.current.editor.reopenClosedEditor(...args),
      renameLiveEditorDocument: (...args) =>
        adaptersRef.current.editor.renameLiveEditorDocument(...args),
      selectFile: (...args) => adaptersRef.current.editor.selectFile(...args),
      selectPreviousEditor: (...args) => adaptersRef.current.editor.selectPreviousEditor(...args),
      selectTab: (...args) => adaptersRef.current.editor.selectTab(...args),
      setActiveGroup: (...args) => adaptersRef.current.editor.setActiveGroup(...args),
    },
    files: {
      openFileAtRef: (path, ref) => adaptersRef.current.openFileAtRef(path, ref),
    },
    focus,
    settings: {
      readSnapshot: () => readCommandSettingsSnapshot(settingsOwner),
      setDiffViewMode: (mode, initiator) =>
        adaptersRef.current.setDiffViewMode('editor.diff.viewMode', mode, undefined, initiator),
      setTheme: (value, initiator) => adaptersRef.current.setTheme(value, initiator),
      nextWallpaper: async () => {
        const library = await settingsOwner.query(wallpaperLibraryOptions())
        if (!library.assets.length) return false
        const selection = readCommandSettingsSnapshot(settingsOwner).wallpaperSelection
        const current = selection.source
        const index =
          current.kind === 'library'
            ? library.assets.findIndex((asset) => asset.id === current.asset)
            : -1
        const asset = library.assets[(index + 1) % library.assets.length]!
        const submission = adaptersRef.current.setWallpaperEnabled(
          'workbench.wallpaper',
          { enabled: true, source: { kind: 'library', asset: asset.id } },
          'user',
          'wallpaper.next',
        )
        return submission.kind === 'noop' || (await submission.settled) === 'acknowledged'
      },
      setWallpaperEnabled: (enabled, initiator) =>
        adaptersRef.current.setWallpaperEnabled(
          'workbench.wallpaper',
          {
            ...readCommandSettingsSnapshot(settingsOwner).wallpaperSelection,
            enabled,
          },
          undefined,
          initiator,
        ),
    },
    shell: {
      showEnvironmentDialog: setEnvironmentDialog,
      showStartPullRequestSession: () =>
        setPullRequestDialog({ rootPath: workspace.getState().rootFolder?.path ?? null }),
      showCloneRepository: () =>
        setCloneParent(parentPath(workspace.getState().rootFolder?.path ?? '')),
      showMachines: () => {
        selectSettingsProject(null)
        selectSettingsScope('user')
        void openWorkspaceSettings(focus, workspace, adaptersRef.current.editor, 'Machines')
          .completion
      },
      openPicker: () => workspace.getState().openPicker(),
      openWorkspaceRoot: (rootPath) => adaptersRef.current.openWorkspaceRoot(rootPath),
      showCommandPalette: (initialSearch = '', origin) => {
        if (!paletteOpenRef.current) setPaletteOrigin(origin ?? focus.captureOrigin())

        openPaletteAt(initialSearch)
        paletteOpenRef.current = true
        setPaletteOpenState(true)
        return focus.request(focusTargetById({ kind: 'command-palette' }))
      },
      showSettings: (origin, search) => {
        if (search !== undefined) {
          selectSettingsProject(null)
          selectSettingsSearch(search)
          selectSettingsView('form')
        }
        if (!workspace.getState().rootFolder) setSettingsOrigin(origin ?? focus.captureOrigin())
        return openWorkspaceSettings(
          focus,
          workspace,
          adaptersRef.current.editor,
          search === undefined ? undefined : null,
        )
      },
    },
    git: {
      setPendingMessageFile: (rootPath, path) =>
        editorRuntime
          .gitStoreForRoot(filesystemPath(rootPath))
          .getState()
          // The command runs on the open tab, so it has already been seen open.
          .setPendingMessageFile(path ? { path, seenOpen: true } : null),
    },
    tabs: {
      requestCloseTab: (tabId) => adaptersRef.current.requestCloseTab(tabId),
    },
    workspace,
    workspaceEdits,
  }))
  useLayoutEffect(() => binding.bind(runtime), [binding, runtime])
  const shellKeys = useSettingValue('terminal.shellKeys')
  // The binding update effect must keep chord state when only its indicator changes.
  const defaults = useMemo(
    () => defaultPlatformKeyBindings(undefined, preset, shellKeys),
    [preset, shellKeys],
  )
  // Stable identity is required by the document listener and every shortcut-hint consumer.
  const bindings = useMemo(
    () => resolvedPlatformKeyBindings(defaults, overrides),
    [defaults, overrides],
  )
  const displayBindings = displayPlatformKeyBindings(bindings)
  const { keymap, pendingChord } = useAppKeymap({
    bindings,
    bus,
    focus,
  })
  useLayoutEffect(() => {
    keymapRef.current = keymap
    return () => {
      keymapRef.current = null
    }
  }, [keymap])

  const closePalette = (restoreOrigin: boolean) => {
    paletteRestoreRef.current = restoreOrigin ? paletteOrigin : undefined
    paletteOpenRef.current = false
    setPaletteScope(null)
    setPaletteOpenState(false)
    setPaletteOrigin(null)
  }
  const popPaletteScope = () => {
    const scope = paletteScopeRef.current
    if (!scope) return

    setPaletteScope(null)
    if (scope.returnSearch === null) {
      closePalette(true)
      return
    }

    setPaletteSearch(scope.returnSearch)
  }
  const setPaletteOpen = (open: boolean) => {
    if (open) return

    closePalette(true)
  }
  const handleSettingsOpenChange = (open: boolean) => {
    if (open) return
    const tabId = activeEditorTabForWorkbenchPanels(workspace.getState().workbenchPanels)?.id
    if (tabId) void adaptersRef.current.editor.closeTab(tabId)
    settingsRestoreRef.current = settingsOrigin
    setSettingsOrigin(null)
  }

  useEffect(() => {
    if (paletteOpen) {
      paletteRestoreRef.current = undefined
      return
    }

    const origin = paletteRestoreRef.current
    if (origin === undefined) return

    paletteRestoreRef.current = undefined
    restoreCapturedOrigin(focus, origin, 'command-palette')
  }, [focus, paletteOpen])

  useEffect(() => {
    if (settingsOpen) {
      settingsRestoreRef.current = undefined
      return
    }

    const origin = settingsRestoreRef.current
    if (origin === undefined) return

    settingsRestoreRef.current = undefined
    restoreCapturedOrigin(focus, origin, 'settings-dialog')
  }, [focus, settingsOpen])
  if (!keymap) return null

  const value: CommandContextValue = {
    bindings: displayBindings,
    bus,
    keymap,
    closePalette,
    openWorkspaceRoot,
    paletteOpen,
    paletteOrigin,
    paletteScope,
    paletteSearch,
    pendingChord,
    popPaletteScope,
    setPaletteOpen,
    setPaletteSearch,
  }

  return (
    <CommandContext value={value}>
      <KeyBindingsContext value={displayBindings}>{children}</KeyBindingsContext>
      {environmentDialog ? (
        <DeferredOverlay
          label='machine picker'
          module={pickerDialogModuleQueryOptions}
          open
          onClose={() => setEnvironmentDialog(null)}
        >
          {({ PickerDialog }) => (
            <PickerDialog mode={environmentDialog} onClose={() => setEnvironmentDialog(null)} />
          )}
        </DeferredOverlay>
      ) : null}
      {cloneParent !== null ? (
        <CloneRepositoryDialog
          open
          defaultParent={cloneParent}
          onOpenChange={(open) => {
            if (!open) setCloneParent(null)
          }}
          onCloned={(path) => void adaptersRef.current.openWorkspaceRoot(workspaceRoot(path))}
        />
      ) : null}
      {pullRequestDialog !== null ? (
        <StartPullRequestSessionDialog
          open
          rootPath={pullRequestDialog.rootPath}
          onOpenChange={(open) => {
            if (!open) setPullRequestDialog(null)
          }}
        />
      ) : null}
      <AppKeymapController />
      <CommandPalette />
      <SettingsDialog open={settingsOpen} onOpenChange={handleSettingsOpenChange} />
    </CommandContext>
  )
}

// Read at dispatch, so a command sees a settings write the tree has not rendered yet.
function readCommandSettingsSnapshot(
  queryClient: ReturnType<typeof useQueryClient>,
): SnapshotSettings {
  const { values } =
    readLiveSettingsProjection(queryClient) ??
    readLiveSettingsProjection(queryClient, bootSettingsSnapshot())
  return {
    diffViewMode: values['editor.diff.viewMode'],
    wallpaperSelection: values['workbench.wallpaper'],
    wallpaperEnabled: values['workbench.wallpaper'].enabled,
  }
}

/** Only while the settings document has not landed; pending writes still project over it. */
function bootSettingsSnapshot(): SettingsSnapshot {
  const file = { keyRanges: {}, parseErrors: [], revision: 'command-fallback', text: '{}\n' }
  return {
    diagnostics: [],
    layers: [
      { file, id: 'user', present: false, raw: {} },
      { file, id: 'workspace', present: false, raw: {} },
      { id: 'policy', present: false, raw: {} },
    ],
    serverVersion: { epoch: 'command-fallback', sequence: 0 },
    values: {
      ...DEFAULT_SETTING_VALUES,
      'editor.diff.viewMode': readSettingBootValue('editor.diff.viewMode'),
      'workbench.wallpaper': readSettingBootValue('workbench.wallpaper'),
    },
  }
}

function restoreCapturedOrigin(
  focus: ReturnType<typeof useFocusService>,
  origin: FocusTargetToken | null,
  departingOverlay: 'command-palette' | 'settings-dialog',
) {
  if (!origin || !focus.isRegistered(origin)) return

  const current = focus.getSnapshot().currentOwner
  if (current?.token === origin) return
  if (current && current.id.kind !== departingOverlay) return

  focus.request(registeredFocusTarget(origin))
}
