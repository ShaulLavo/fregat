import { workbenchCommandMetadata } from '@workspace/client-core/commands/workbench'
import {
  workspaceCommandMetadata,
  sessionJumpMetadata,
} from '@workspace/client-core/commands/workspace'
import {
  ArrowClockwiseIcon,
  ArrowCounterClockwiseIcon,
  BracketsCurlyIcon,
  CardsIcon,
  ChatCircleIcon,
  FilePlusIcon,
  FolderPlusIcon,
  PlayIcon,
  ClockCounterClockwiseIcon,
  CommandIcon,
  CrosshairIcon,
  DesktopIcon,
  FileMagnifyingGlassIcon,
  FloppyDiskBackIcon,
  FloppyDiskIcon,
  FolderOpenIcon,
  GearSixIcon,
  GitDiffIcon,
  ImageIcon,
  MoonIcon,
  PaletteIcon,
  SidebarSimpleIcon,
  SquareHalfBottomIcon,
  SquaresFourIcon,
  SunIcon,
  XIcon,
} from '@phosphor-icons/react'
import type { QueryClient } from '@tanstack/react-query'

import { shareableAddress } from '@/features/address/state/storage'
import {
  jumpToSession,
  selectAdjacentSession,
  startScopedSessionDraft,
  type SessionTraversalDirection,
} from '@/features/chat-mode/state/session-commands'
import { setChatModeSessionRailOpen, showChatModeToolTab } from '@/features/chat-mode/utils/panels'
import {
  compareSavedDocumentId,
  parseCompareSavedDocumentId,
} from '@/features/editor/utils/compare-saved-document'
import {
  fileBackedDocumentPath,
  savableDocumentPath,
} from '@/features/editor/utils/file-backed-document'
import { activeSettingsBufferId } from '@/features/settings/state/active-buffer'
import { dirtySavableEditorDocuments } from '@/features/editor/utils/save'
import type { EditorDocumentStoreApi } from '@/features/editor/state/document-state'
import type { WorkspaceMutationReporter } from '@/features/editor/state/workspace-edit-service'
import { nextEditorDiffViewMode } from '@/features/editor/utils/diff-view-mode'
import { parseDiffDocumentId } from '@/features/git/utils/diff-document'
import { parseSearchBufferDocumentId } from '@/features/search/utils/buffer-document'
import {
  activeEditorTabForWorkbenchPanels,
  openEditorPathInWorkbenchPanels,
  showWorkbenchBottomTab,
  showWorkbenchSidebarTab,
  toggleWorkbenchBottomTab,
  toggleWorkbenchSidebarTab,
} from '@/features/workbench/utils/panels'
import { fetchFile } from '@/lib/file-server'
import { setFileSnapshotQueryData } from '@/lib/file-snapshot-query-cache'
import type {
  AsyncCommandSettlement,
  AsyncCommandStart,
  ImmediateCommandDisposition,
} from '@/keymap/state/command-bus'
import {
  focusTargetById,
  focusTargetIdsEqual,
  registeredFocusTarget,
  type FocusDestination,
  type FocusIntent,
  type FocusTargetId,
  type FocusTargetToken,
  type FocusTransitionTicket,
  type FocusTransitionOutcome,
} from '@/lib/focus/state/service'
import { matchesActiveSurface } from '@/lib/focus/utils/active-surface'
import { toggledWorkspaceUiMode } from '@/lib/ui-mode'

import {
  defineCommand,
  type WorkspaceCommandHandlerContext,
  type WorkspaceCommandRuntime,
} from './define-command'
import { SESSION_JUMP_POSITIONS } from './types'

const handled = { status: 'handled' } as const
const declined = { reason: 'handler-declined', status: 'unhandled' } as const
type StartedCommand = Extract<AsyncCommandStart, { readonly status: 'started' }>

/**
 * Session traversal only means something while the chat layout is the one on screen —
 * in the workbench there is no rail to count rows in and no stage to hand them to.
 */
function runSessionCommand(
  context: WorkspaceCommandHandlerContext,
  run: () => boolean | Promise<boolean>,
) {
  if (context.snapshot.uiMode !== 'chat') return declined

  const result = run()
  if (result instanceof Promise) return operationStart(result)
  return dispositionFor(result)
}

function sessionTraversalHandler(direction: SessionTraversalDirection) {
  return (context: WorkspaceCommandHandlerContext) =>
    runSessionCommand(context, () => selectAdjacentSession(direction))
}

function dispositionFor(accepted: boolean): ImmediateCommandDisposition {
  return accepted ? handled : declined
}

async function revertSelectedEditorDocument(
  documentStore: EditorDocumentStoreApi,
  queryClient: QueryClient,
  activeFilePath: string | null,
) {
  const path = fileBackedDocumentPath(activeFilePath)
  if (!path) return false

  const file = await fetchFile(path, new AbortController().signal)
  setFileSnapshotQueryData(queryClient, file)
  documentStore.getState().forceReplaceLiveEditorDocument(file)
  return true
}

function operationStart(operation: Promise<boolean>): StartedCommand {
  return {
    completion: operation.then((accepted) => dispositionFor(accepted)),
    status: 'started',
  }
}

function resolvedOperationStart(operation: Promise<void>): StartedCommand {
  return {
    completion: operation.then(() => handled),
    status: 'started',
  }
}

function focusStart(
  runtime: WorkspaceCommandRuntime,
  destination: FocusDestination,
  intent: FocusIntent = 'focus',
  acknowledged: ImmediateCommandDisposition = handled,
): StartedCommand {
  return transitionStart(runtime.focus.request(destination, intent), acknowledged)
}

function transitionStart(
  ticket: FocusTransitionTicket,
  acknowledged: ImmediateCommandDisposition = handled,
): StartedCommand {
  return {
    completion: ticket.completion.then((outcome) => focusSettlement(outcome, acknowledged)),
    status: 'started',
  }
}

function focusIdStart(
  runtime: WorkspaceCommandRuntime,
  id: FocusTargetId,
  intent: FocusIntent = 'focus',
  acknowledged: ImmediateCommandDisposition = handled,
) {
  return focusStart(runtime, focusTargetById(id), intent, acknowledged)
}

function focusIdInLayoutStart(
  runtime: WorkspaceCommandRuntime,
  id: FocusTargetId,
  layout: 'chat' | 'workbench',
  intent: FocusIntent = 'focus',
  acknowledged: ImmediateCommandDisposition = handled,
) {
  return focusStart(
    runtime,
    {
      isValid: () => runtime.workspace.getState().uiMode === layout,
      kind: 'match',
      matches: (target) => target.layout === layout && focusTargetIdsEqual(target.id, id),
    },
    intent,
    acknowledged,
  )
}

function focusSettlement(
  outcome: FocusTransitionOutcome,
  acknowledged: ImmediateCommandDisposition,
): AsyncCommandSettlement {
  if (outcome.status === 'acknowledged') return acknowledged
  if (outcome.status === 'superseded') {
    return { reason: 'domain-discarded', status: 'cancelled' }
  }

  return declined
}

function settingStart(
  submission: ReturnType<WorkspaceCommandRuntime['settings']['setTheme']>,
): AsyncCommandStart {
  if (submission.kind === 'noop') return handled

  return {
    completion: submission.settled.then((settlement) => {
      if (settlement === 'acknowledged') return handled
      if (settlement === 'discarded') {
        return { reason: 'domain-discarded', status: 'cancelled' } as const
      }

      return {
        failure: { operationId: submission.mutationId, owner: 'domain' },
        status: 'failed',
      } as const
    }),
    status: 'started',
  }
}

function focusActiveSurface(runtime: WorkspaceCommandRuntime): StartedCommand {
  let workspace = runtime.workspace.getState()
  if (workspace.uiMode === 'chat') {
    workspace.setChatModePanels(showChatModeToolTab(workspace.chatModePanels, 'editor'))
    workspace = runtime.workspace.getState()
  }
  const activeTab = activeEditorTabForWorkbenchPanels(workspace.workbenchPanels)
  if (!activeTab) {
    return focusStart(runtime, { isValid: () => false, kind: 'match', matches: () => false })
  }
  const layout = workspace.uiMode

  const activeDiffPath =
    parseCompareSavedDocumentId(activeTab.path) ?? parseDiffDocumentId(activeTab.path)?.path ?? null
  const activeSearchRoot = parseSearchBufferDocumentId(activeTab.path)?.rootPath ?? null
  const identity = {
    diffPath: activeDiffPath,
    layout,
    searchRoot: activeSearchRoot,
    tabId: activeTab.id,
  } as const

  return focusStart(runtime, {
    isValid: () => {
      const current = activeEditorTabForWorkbenchPanels(
        runtime.workspace.getState().workbenchPanels,
      )
      return (
        runtime.workspace.getState().uiMode === layout &&
        current?.id === activeTab.id &&
        current.path === activeTab.path
      )
    },
    kind: 'match',
    matches: (target) => matchesActiveSurface(target, identity),
  })
}

function focusAppShell(runtime: WorkspaceCommandRuntime): StartedCommand {
  return focusIdStart(runtime, { kind: 'app-shell' })
}

function focusActiveSurfaceOrShell(runtime: WorkspaceCommandRuntime): StartedCommand {
  if (activeEditorTabForWorkbenchPanels(runtime.workspace.getState().workbenchPanels)) {
    return focusActiveSurface(runtime)
  }

  return focusAppShell(runtime)
}

function focusWorkbench(runtime: WorkspaceCommandRuntime): StartedCommand {
  const last = runtime.focus.getSnapshot().lastCommandTarget
  if (
    last?.layout === 'workbench' &&
    workbenchFocusArea(last.area) &&
    runtime.focus.isRegistered(last.token)
  ) {
    return focusStart(runtime, registeredFocusTarget(last.token))
  }

  return focusActiveSurfaceOrShell(runtime)
}

function workbenchFocusArea(area: string) {
  return !['chat', 'command-palette', 'dialog', 'global', 'settings'].includes(area)
}

function chatFocusStart(
  runtime: WorkspaceCommandRuntime,
  rootPath: string | null,
  layout: 'chat' | 'workbench',
) {
  if (!rootPath) return declined

  return focusIdInLayoutStart(runtime, { key: rootPath, kind: 'chat-composer' }, layout)
}

/**
 * The nine jump slots are one shape, so they are written once. They are hidden
 * from the palette for the same reason as their four named siblings: they are
 * keyboard navigation for the visible chat rail, not general palette actions.
 */
function sessionJumpCommands() {
  return SESSION_JUMP_POSITIONS.map((position) =>
    defineCommand({
      ...sessionJumpMetadata(position),
      run: (context) => runSessionCommand(context, () => jumpToSession(position)),
    }),
  )
}

export const workspaceCommands = [
  defineCommand({
    ...workspaceCommandMetadata['workspace.undoWorkspaceEdit'],
    icon: ArrowCounterClockwiseIcon,
    run: ({ runtime }) => operationStart(runtime.workspaceEdits.undo()),
  }),
  defineCommand({
    ...workspaceCommandMetadata['workspace.redoWorkspaceEdit'],
    icon: ArrowClockwiseIcon,
    run: ({ runtime }) => operationStart(runtime.workspaceEdits.redo()),
  }),
  defineCommand({
    ...workspaceCommandMetadata['workspace.showQuickAccess'],
    icon: FileMagnifyingGlassIcon,
    run: ({ invocation, runtime }) =>
      transitionStart(
        runtime.shell.showCommandPalette('', invocation.origin as FocusTargetToken | null),
      ),
  }),
  defineCommand({
    ...workspaceCommandMetadata['workspace.showCommandPalette'],
    icon: CommandIcon,
    run: ({ invocation, runtime }) =>
      transitionStart(
        runtime.shell.showCommandPalette('>', invocation.origin as FocusTargetToken | null),
      ),
  }),
  // Settings are machine-wide, so this is the one workspace command that stays
  // available with no folder open — it is where a provider gets configured in
  // the first place.
  defineCommand({
    ...workspaceCommandMetadata['workspace.selectAppColors'],
    icon: PaletteIcon,
    run: ({ invocation, runtime }) =>
      transitionStart(
        runtime.shell.showCommandPalette('colors ', invocation.origin as FocusTargetToken | null),
      ),
  }),
  defineCommand({
    ...workspaceCommandMetadata['workspace.runProjectScript'],
    icon: PlayIcon,
    run: ({ invocation, runtime }) =>
      transitionStart(
        runtime.shell.showCommandPalette('run ', invocation.origin as FocusTargetToken | null),
      ),
  }),
  defineCommand({
    ...workspaceCommandMetadata['workspace.switchSession'],
    icon: ChatCircleIcon,
    run: ({ invocation, runtime }) =>
      transitionStart(
        runtime.shell.showCommandPalette('sess ', invocation.origin as FocusTargetToken | null),
      ),
  }),
  defineCommand({
    ...workbenchCommandMetadata['workspace.goToLine'],
    undoCategory: 'view-only',
    keepsPaletteOpen: true,
    when: ['fileBackedTab'],
    icon: CrosshairIcon,
    run: ({ invocation, runtime }) =>
      transitionStart(
        runtime.shell.showCommandPalette(':', invocation.origin as FocusTargetToken | null),
      ),
  }),
  defineCommand({
    ...workspaceCommandMetadata['workspace.showFontSettings'],
    icon: GearSixIcon,
    run: ({ invocation, runtime }) =>
      transitionStart(
        runtime.shell.showSettings(invocation.origin as FocusTargetToken | null, 'font'),
      ),
  }),
  defineCommand({
    ...workspaceCommandMetadata['workspace.showTransparencySettings'],
    icon: GearSixIcon,
    run: ({ invocation, runtime }) =>
      transitionStart(
        runtime.shell.showSettings(
          invocation.origin as FocusTargetToken | null,
          'workbench.surface',
        ),
      ),
  }),
  defineCommand({
    ...workbenchCommandMetadata['fileTree.newFile'],
    undoCategory: 'file-operation',
    when: ['workspaceOpen', 'workspaceMutable'],
    icon: FilePlusIcon,
    run: ({ runtime, snapshot }) => {
      if (!snapshot.rootPath) return declined

      const workspace = runtime.workspace.getState()
      workspace.setUiMode('workbench')
      workspace.setWorkbenchPanels(showWorkbenchSidebarTab(snapshot.workbenchPanels, 'files'))
      return focusIdInLayoutStart(
        runtime,
        { kind: 'file-tree', rootPath: snapshot.rootPath },
        'workbench',
        'create-file',
      )
    },
  }),
  defineCommand({
    ...workbenchCommandMetadata['fileTree.newFolder'],
    undoCategory: 'file-operation',
    when: ['workspaceOpen', 'workspaceMutable'],
    icon: FolderPlusIcon,
    run: ({ runtime, snapshot }) => {
      if (!snapshot.rootPath) return declined

      const workspace = runtime.workspace.getState()
      workspace.setUiMode('workbench')
      workspace.setWorkbenchPanels(showWorkbenchSidebarTab(snapshot.workbenchPanels, 'files'))
      return focusIdInLayoutStart(
        runtime,
        { kind: 'file-tree', rootPath: snapshot.rootPath },
        'workbench',
        'create-folder',
      )
    },
  }),
  defineCommand({
    ...workspaceCommandMetadata['workspace.showSettings'],
    icon: GearSixIcon,
    run: ({ invocation, runtime }) =>
      transitionStart(runtime.shell.showSettings(invocation.origin as FocusTargetToken | null)),
  }),
  defineCommand({
    ...workspaceCommandMetadata['workspace.openFilePicker'],
    icon: FolderOpenIcon,
    run: ({ runtime }) => {
      runtime.shell.openPicker()
      return handled
    },
  }),
  defineCommand({
    ...workspaceCommandMetadata['workspace.openSearchEditor'],
    icon: FileMagnifyingGlassIcon,
    run: ({ runtime, snapshot }) => {
      if (!snapshot.rootPath) return declined

      runtime.editor.openSearchEditor(snapshot.rootPath)
      return focusActiveSurface(runtime)
    },
  }),
  defineCommand({
    ...workspaceCommandMetadata['workspace.quickOpenPreviousEditor'],
    icon: ClockCounterClockwiseIcon,
    run: ({ runtime }) => {
      if (!runtime.editor.selectPreviousEditor()) return declined

      return focusActiveSurface(runtime)
    },
  }),
  defineCommand({
    ...workspaceCommandMetadata['workspace.quickOpenView'],
    icon: SquaresFourIcon,
    run: ({ invocation, runtime }) =>
      transitionStart(
        runtime.shell.showCommandPalette('view ', invocation.origin as FocusTargetToken | null),
      ),
  }),
  defineCommand({
    ...workspaceCommandMetadata['workspace.gotoSymbol'],
    icon: BracketsCurlyIcon,
    run: ({ invocation, runtime, snapshot }) => {
      if (!fileBackedDocumentPath(snapshot.activeFilePath)) return declined

      return transitionStart(
        runtime.shell.showCommandPalette('@', invocation.origin as FocusTargetToken | null),
      )
    },
  }),
  defineCommand({
    ...workspaceCommandMetadata['workspace.showAllEditors'],
    icon: CardsIcon,
    run: ({ invocation, runtime }) =>
      transitionStart(
        runtime.shell.showCommandPalette('edt ', invocation.origin as FocusTargetToken | null),
      ),
  }),
  defineCommand({
    ...workspaceCommandMetadata['workspace.saveFile'],
    icon: FloppyDiskIcon,
    run: ({ runtime, snapshot }) => {
      // The settings tab is one document with two views, and only the JSON view
      // has a buffer. Resolving here rather than in `save.ts` keeps the fact
      // that the settings page has modes inside the feature that owns them.
      const path = activeSettingsBufferId(snapshot.activeFilePath) ?? snapshot.activeFilePath
      if (!path || !savableDocumentPath(path)) return declined
      const save = () => runtime.documents.save.save(path)
      const dirty = dirtySavableEditorDocuments(runtime.documents.store.getState()).some(
        (document) => document.id === path,
      )

      return operationStart(
        dirty ? runtime.workspaceEdits.runWorkspaceMutation([path], save) : save(),
      )
    },
  }),
  defineCommand({
    ...workspaceCommandMetadata['workspace.saveAllFiles'],
    icon: FloppyDiskBackIcon,
    run: ({ runtime }) => {
      const affectedPaths = dirtySavableEditorDocuments(runtime.documents.store.getState()).map(
        (document) => document.id,
      )
      const save = (reportAffectedPaths?: WorkspaceMutationReporter) =>
        runtime.documents.save.saveAll((path) => reportAffectedPaths?.([path]))
      const operation =
        affectedPaths.length > 0
          ? runtime.workspaceEdits.runWorkspaceMutation(affectedPaths, save)
          : save()
      return resolvedOperationStart(operation)
    },
  }),
  defineCommand({
    ...workspaceCommandMetadata['workspace.compareWithSaved'],
    run: ({ runtime, snapshot }) => {
      const path = fileBackedDocumentPath(snapshot.activeFilePath)
      if (!path) return declined

      runtime.workspace
        .getState()
        .setWorkbenchPanels(
          openEditorPathInWorkbenchPanels(snapshot.workbenchPanels, compareSavedDocumentId(path)),
        )
      return focusActiveSurface(runtime)
    },
  }),
  defineCommand({
    ...workspaceCommandMetadata['workspace.openFileAtHead'],
    run: ({ runtime, snapshot }) => {
      const path = fileBackedDocumentPath(snapshot.activeFilePath)
      if (!path) return declined

      return {
        completion: runtime.files.openFileAtRef(path, 'HEAD').then(async (opened) => {
          if (!opened) return declined

          return focusActiveSurface(runtime).completion
        }),
        status: 'started',
      }
    },
  }),
  defineCommand({
    ...workspaceCommandMetadata['workspace.revertFile'],
    icon: ArrowCounterClockwiseIcon,
    run: ({ runtime, snapshot }) => {
      if (!fileBackedDocumentPath(snapshot.activeFilePath)) return declined

      return operationStart(
        revertSelectedEditorDocument(
          runtime.documents.store,
          runtime.documents.queryClient,
          snapshot.activeFilePath,
        ),
      )
    },
  }),
  defineCommand({
    ...workspaceCommandMetadata['workspace.reopenClosedEditor'],
    icon: ArrowClockwiseIcon,
    run: ({ runtime }) => {
      if (!runtime.editor.reopenClosedEditor()) return declined

      return focusActiveSurface(runtime)
    },
  }),
  defineCommand({
    ...workspaceCommandMetadata['workspace.toggleSidebarVisibility'],
    icon: SidebarSimpleIcon,
    run: ({ runtime, snapshot }) => {
      if (!snapshot.rootPath) return declined

      const workspace = runtime.workspace.getState()
      // Arriving from chat mode reveals the pane rather than toggling it: the
      // workbench panels the user is about to see were never on screen, so
      // hiding one would answer a keystroke they could not have aimed.
      const revealing = workspace.uiMode !== 'workbench'
      const panels = revealing
        ? showWorkbenchSidebarTab(snapshot.workbenchPanels, 'files')
        : toggleWorkbenchSidebarTab(snapshot.workbenchPanels, 'files')
      workspace.setUiMode('workbench')
      workspace.setWorkbenchPanels(panels)
      if (!panels.sidebarOpen) return handled

      return focusIdInLayoutStart(
        runtime,
        { kind: 'file-tree', rootPath: snapshot.rootPath },
        'workbench',
      )
    },
  }),
  defineCommand({
    ...workspaceCommandMetadata['workspace.togglePanel'],
    icon: SquareHalfBottomIcon,
    run: ({ runtime, snapshot }) => {
      if (!snapshot.rootPath) return declined

      const workspace = runtime.workspace.getState()
      const revealing = workspace.uiMode !== 'workbench'
      const panels = revealing
        ? showWorkbenchBottomTab(snapshot.workbenchPanels, 'terminal')
        : toggleWorkbenchBottomTab(snapshot.workbenchPanels, 'terminal')
      workspace.setUiMode('workbench')
      workspace.setWorkbenchPanels(panels)
      if (!panels.bottomPanelOpen) return handled

      return focusStart(runtime, {
        isValid: () => runtime.workspace.getState().uiMode === 'workbench',
        kind: 'match',
        matches: (target) =>
          target.id.kind === 'terminal' &&
          target.id.rootPath === snapshot.rootPath &&
          target.layout === 'workbench',
      })
    },
  }),
  defineCommand({
    ...workspaceCommandMetadata['workspace.focusFirstEditorGroup'],
    icon: CrosshairIcon,
    run: ({ runtime }) => focusActiveSurface(runtime),
  }),
  defineCommand({
    ...workspaceCommandMetadata['workspace.focusSecondEditorGroup'],
    icon: CrosshairIcon,
    run: ({ runtime }) => focusActiveSurface(runtime),
  }),
  defineCommand({
    ...workspaceCommandMetadata['workspace.focusThirdEditorGroup'],
    icon: CrosshairIcon,
    run: ({ runtime }) => focusActiveSurface(runtime),
  }),
  defineCommand({
    ...workspaceCommandMetadata['workspace.focusEditor'],
    icon: CrosshairIcon,
    run: ({ runtime }) => focusActiveSurface(runtime),
  }),
  defineCommand({
    ...workspaceCommandMetadata['workspace.focusFileTree'],
    icon: CrosshairIcon,
    run: ({ runtime, snapshot }) => {
      if (!snapshot.rootPath) return declined

      const workspace = runtime.workspace.getState()
      workspace.setUiMode('workbench')
      workspace.setWorkbenchPanels(showWorkbenchSidebarTab(snapshot.workbenchPanels, 'files'))
      return focusIdInLayoutStart(
        runtime,
        { kind: 'file-tree', rootPath: snapshot.rootPath },
        'workbench',
      )
    },
  }),
  defineCommand({
    ...workspaceCommandMetadata['workspace.findInFileTree'],
    icon: FileMagnifyingGlassIcon,
    run: ({ runtime, snapshot }) => {
      if (!snapshot.rootPath) return declined

      const workspace = runtime.workspace.getState()
      workspace.setUiMode('workbench')
      workspace.setWorkbenchPanels(showWorkbenchSidebarTab(snapshot.workbenchPanels, 'files'))
      return focusIdInLayoutStart(
        runtime,
        { kind: 'file-tree', rootPath: snapshot.rootPath },
        'workbench',
        'open-search',
      )
    },
  }),
  defineCommand({
    ...workspaceCommandMetadata['workspace.revealActiveFileInTree'],
    icon: CrosshairIcon,
    run: ({ runtime, snapshot }) => {
      if (!fileBackedDocumentPath(snapshot.activeFilePath)) return declined
      if (!snapshot.rootPath) return declined

      const workspace = runtime.workspace.getState()
      workspace.setUiMode('workbench')
      workspace.setWorkbenchPanels(showWorkbenchSidebarTab(snapshot.workbenchPanels, 'files'))
      return focusIdInLayoutStart(
        runtime,
        { kind: 'file-tree', rootPath: snapshot.rootPath },
        'workbench',
        'reveal-active',
      )
    },
  }),
  defineCommand({
    ...workspaceCommandMetadata['workspace.focusGit'],
    icon: CrosshairIcon,
    run: ({ runtime, snapshot }) => {
      if (!snapshot.rootPath) return declined

      const workspace = runtime.workspace.getState()
      workspace.setUiMode('workbench')
      workspace.setWorkbenchPanels(showWorkbenchSidebarTab(snapshot.workbenchPanels, 'git'))
      return focusIdInLayoutStart(
        runtime,
        { kind: 'git', rootPath: snapshot.rootPath },
        'workbench',
      )
    },
  }),
  defineCommand({
    ...workspaceCommandMetadata['workspace.copyAddress'],
    run: () => {
      if (!navigator.clipboard?.writeText) return declined

      // The address bar already holds the full address — session, tool pane, filters and
      // all. Rebuilding a workbench-only subset here copied a strictly weaker link than
      // the one on screen, which defeats the point of the command.
      //
      // Through `shareableAddress`, not the raw location: a copied link needs an origin
      // to be openable at all, and it must not carry the dev params, which belong to the
      // session someone typed them into rather than to everyone they send the link to.
      return resolvedOperationStart(navigator.clipboard.writeText(shareableAddress()))
    },
  }),
  // History is the browser's, so back and forward are one call each. The popstate
  // listener in the address layer is what turns the move into applied state.
  //
  // Mod+[ and Mod+] are app bindings too, not only the editor's outdent/indent
  // pair. Outside the editor these keys used to reach the browser untouched,
  // which was harmless only while there was no history to walk; now that there
  // is, the app has to own them or a back press in the file tree leaves the
  // workspace entirely.
  defineCommand({
    ...workspaceCommandMetadata['workspace.navigateBack'],
    run: () => {
      history.back()
      return handled
    },
  }),
  defineCommand({
    ...workspaceCommandMetadata['workspace.navigateForward'],
    run: () => {
      history.forward()
      return handled
    },
  }),
  // Chat mode already puts the composer on the stage, so only the workbench has
  // anything to reveal — and there it is a sidebar tab, not a focus target: the
  // caller (terminal capture today) is handing over context, not the keyboard.
  defineCommand({
    ...workspaceCommandMetadata['workspace.revealChat'],
    run: ({ runtime, snapshot }) => {
      if (snapshot.uiMode !== 'chat') {
        runtime.workspace
          .getState()
          .setWorkbenchPanels(showWorkbenchSidebarTab(snapshot.workbenchPanels, 'chat'))
      }

      return chatFocusStart(runtime, snapshot.rootPath, snapshot.uiMode)
    },
  }),
  // Unlike the chat reveal, this one has somewhere to go from either mode: the
  // terminal lives in the workbench, so a caller in chat mode has to be taken
  // there or its command runs somewhere the user cannot see.
  defineCommand({
    ...workspaceCommandMetadata['workspace.revealTerminal'],
    run: ({ runtime, snapshot }) => {
      if (!snapshot.rootPath) return declined

      const workspace = runtime.workspace.getState()
      workspace.setUiMode('workbench')
      workspace.setWorkbenchPanels(showWorkbenchBottomTab(snapshot.workbenchPanels, 'terminal'))
      return focusStart(runtime, {
        isValid: () => runtime.workspace.getState().uiMode === 'workbench',
        kind: 'match',
        matches: (target) =>
          target.id.kind === 'terminal' &&
          target.id.rootPath === snapshot.rootPath &&
          target.layout === 'workbench',
      })
    },
  }),
  defineCommand({
    ...workspaceCommandMetadata['workspace.closeCurrentTab'],
    icon: XIcon,
    run: ({ runtime, snapshot }) => {
      if (!snapshot.activeTabId) return declined

      const result = runtime.tabs.requestCloseTab(snapshot.activeTabId)
      if (result.status === 'rejected') return declined
      if (result.status === 'deferred') {
        return focusIdStart(
          runtime,
          { dialogTarget: result.dialogTarget, kind: 'unsaved-dialog' },
          'focus',
          { reason: 'dirty-close', status: 'deferred' },
        )
      }

      return focusActiveSurfaceOrShell(runtime)
    },
  }),
  defineCommand({
    ...workspaceCommandMetadata['workspace.toggleDiffViewMode'],
    icon: GitDiffIcon,
    run: ({ runtime, snapshot }) => {
      // Through the settings write path: the command and the settings page are two
      // front doors onto one value.
      return settingStart(
        runtime.settings.setDiffViewMode(
          nextEditorDiffViewMode(snapshot.diffViewMode),
          'workspace.toggleDiffViewMode',
        ),
      )
    },
  }),
  defineCommand({
    ...workspaceCommandMetadata['workspace.toggleUiMode'],
    run: ({ runtime, snapshot }) => {
      const nextMode = toggledWorkspaceUiMode(snapshot.uiMode)
      runtime.workspace.getState().setUiMode(nextMode)
      if (nextMode === 'chat') return chatFocusStart(runtime, snapshot.rootPath, 'chat')

      return focusWorkbench(runtime)
    },
  }),
  defineCommand({
    ...workspaceCommandMetadata['workspace.showChatMode'],
    run: ({ runtime, snapshot }) => {
      runtime.workspace.getState().setUiMode('chat')
      return chatFocusStart(runtime, snapshot.rootPath, 'chat')
    },
  }),
  defineCommand({
    ...workspaceCommandMetadata['workspace.showWorkbenchMode'],
    run: ({ runtime }) => {
      runtime.workspace.getState().setUiMode('workbench')
      return focusWorkbench(runtime)
    },
  }),
  defineCommand({
    ...workspaceCommandMetadata['workspace.selectColorMode'],
    icon: PaletteIcon,
    run: ({ invocation, runtime }) =>
      transitionStart(
        runtime.shell.showCommandPalette('color ', invocation.origin as FocusTargetToken | null),
      ),
  }),
  defineCommand({
    ...workspaceCommandMetadata['workspace.selectColorTheme'],
    icon: PaletteIcon,
    run: ({ invocation, runtime }) =>
      transitionStart(
        runtime.shell.showCommandPalette('theme ', invocation.origin as FocusTargetToken | null),
      ),
  }),
  defineCommand({
    ...workspaceCommandMetadata['workspace.setDarkTheme'],
    icon: MoonIcon,
    run: ({ runtime }) => settingStart(runtime.settings.setTheme('dark', 'workspace.setDarkTheme')),
  }),
  defineCommand({
    ...workspaceCommandMetadata['workspace.setLightTheme'],
    icon: SunIcon,
    run: ({ runtime }) =>
      settingStart(runtime.settings.setTheme('light', 'workspace.setLightTheme')),
  }),
  defineCommand({
    ...workspaceCommandMetadata['workspace.setSystemTheme'],
    icon: DesktopIcon,
    run: ({ runtime }) =>
      settingStart(runtime.settings.setTheme('system', 'workspace.setSystemTheme')),
  }),
  defineCommand({
    ...workspaceCommandMetadata['workspace.toggleWallpaper'],
    icon: ImageIcon,
    run: ({ runtime, snapshot }) => {
      // Through the settings write path, not a store setter. The command and the
      // settings page are two front doors onto one value; if they wrote to
      // different places they would disagree the first time either was used.
      return settingStart(
        runtime.settings.setWallpaperEnabled(
          !snapshot.wallpaperEnabled,
          'workspace.toggleWallpaper',
        ),
      )
    },
  }),
  // Chat sessions all sit under Mod+Alt: the plain Mod digits are reserved for the
  // editor groups VS Code puts there, and Mod+B already toggles the Files pane.
  defineCommand({
    ...workspaceCommandMetadata['workspace.newSession'],
    run: (context) => runSessionCommand(context, startScopedSessionDraft),
  }),
  defineCommand({
    ...workspaceCommandMetadata['workspace.nextSession'],
    run: sessionTraversalHandler('next'),
  }),
  defineCommand({
    ...workspaceCommandMetadata['workspace.previousSession'],
    run: sessionTraversalHandler('previous'),
  }),
  defineCommand({
    ...workspaceCommandMetadata['workspace.toggleSessionRail'],
    run: (context) => {
      if (context.snapshot.uiMode !== 'chat') return declined
      context.runtime.workspace
        .getState()
        .setChatModePanels(
          setChatModeSessionRailOpen(
            context.snapshot.chatModePanels,
            !context.snapshot.chatModePanels.sessionRailOpen,
          ),
        )

      return handled
    },
  }),
  ...sessionJumpCommands(),
]

export type WorkspaceCommandId = (typeof workspaceCommands)[number]['id']
