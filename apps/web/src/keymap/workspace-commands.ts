import { clientForQueryClient, originForQueryClient } from '@/lib/environments/state/query-clients'
import { workbenchCommandMetadata } from '@workspace/client-core/commands/workbench'
import {
  selectItemMetadata,
  sidebarPanelMetadata,
  workspaceCommandMetadata,
} from '@workspace/client-core/commands/workspace'
import {
  ArticleIcon,
  ArrowClockwiseIcon,
  ArrowCounterClockwiseIcon,
  BracketsCurlyIcon,
  CardsIcon,
  ChatCircleIcon,
  CheckIcon,
  FilePlusIcon,
  FilesIcon,
  FolderPlusIcon,
  PlayIcon,
  ClockCounterClockwiseIcon,
  CommandIcon,
  CrosshairIcon,
  DesktopIcon,
  DownloadSimpleIcon,
  FileMagnifyingGlassIcon,
  FloppyDiskBackIcon,
  FloppyDiskIcon,
  FolderOpenIcon,
  GaugeIcon,
  GitForkIcon,
  GitPullRequestIcon,
  GearSixIcon,
  GitDiffIcon,
  ImageIcon,
  MoonIcon,
  PaletteIcon,
  SwatchesIcon,
  SidebarSimpleIcon,
  SquareHalfBottomIcon,
  SquaresFourIcon,
  SunIcon,
  TerminalIcon,
  XIcon,
} from '@phosphor-icons/react'
import type { QueryClient } from '@tanstack/react-query'

import { getNavigation } from '@/state/navigation-binding'
import { filesystemPath } from '@/lib/documents/utils/identity'
import {
  fileOperationDocuments,
  reverseLatestFileOperation,
  type FileOperationRuntime,
} from '@/features/workspace/state/file-operations'
import type { NavigationResult } from '@/state/navigation-coordinator'
import {
  jumpToSession,
  selectAdjacentSession,
  startScopedSessionDraft,
  startSidebarSessionDraft,
  type SessionTraversalDirection,
} from '@/features/chat-mode/state/session-commands'
import { useSessionSelectionStore } from '@/features/chat-mode/state/session-selection-store'
import { setChatModeSessionRailOpen, showChatModeToolTab } from '@/features/chat-mode/utils/panels'
import { downloadSessionTranscript } from '@/features/chat/state/transcript-export'
import {
  undoLatestSessionAction,
  redoLatestSessionAction,
} from '@/features/chat-mode/state/session-undo'
import { documentKey } from '@/lib/documents/utils/identity'
import { runMutation } from '@/lib/mutations/run'
import { copyTextToClipboard } from '@/lib/clipboard'
import { historyRestoreMutationOptions } from '@/features/editor/state/history-mutations'
import { adjacentHistoryState } from '@/features/editor/utils/history-navigation'
import {
  documentSourcePath,
  filesystemResource,
  saveCapability,
} from '@/lib/documents/utils/capabilities'
import { documentTab, sameTabContent } from '@/lib/documents/utils/tabs'
import type { DocumentRef, EditorTabRecord, TabId } from '@/lib/documents/utils/types'
import type { EditorDocumentStoreApi } from '@/features/editor/state/document-state'
import { nextEditorDiffViewMode } from '@/features/editor/utils/diff-view-mode'
import { commitMessageFilePath } from '@/keymap/utils/commit-message-file'
import { focusInsideSidebar } from '@/keymap/utils/sidebar-focus'
import { markdownViewOverride, setMarkdownViewOverride } from '@/lib/markdown-mode/state/overrides'
import { isMarkdownPath, nextMarkdownView } from '@/lib/markdown-mode/utils/mode'
import { readSettingsMirror } from '@/lib/settings-boot-mirror'
import { selectionPrompt, type SelectedLines } from '@/keymap/utils/selection-prompt'
import { activeEnvironmentId } from '@/lib/environments/state/domain'
import { toTreePath } from '@/lib/path-formatters'
import { resolveSelection } from '@singapore-editor/core/document'
import { serializeComposerMention } from '@workspace/contracts'
import {
  activeEditorTabForWorkbenchPanels,
  openTerminalTabInWorkbenchPanels,
  selectAdjacentTerminalTabInWorkbenchPanels,
  showWorkbenchBottomTab,
  setWorkbenchSidebarOpen,
  showWorkbenchSidebarTab,
  toggleWorkbenchBottomTab,
  WORKBENCH_SIDEBAR_TABS,
  type TerminalTabDirection,
  type WorkbenchPanels,
  type WorkbenchSidebarTab,
} from '@/features/workbench/utils/panels'
import { killTerminalTab } from '@/features/workbench/state/kill-terminal-tab'
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
import { allEditorGroups, activeEditorGroup } from '@/lib/documents/utils/groups'
import type { EditorGroup, GroupEdge } from '@/lib/documents/utils/group-types'
import { groupSplitVerdict } from '@/features/workbench/state/group-geometry'

import {
  defineCommand,
  type WorkspaceCommandHandlerContext,
  type WorkspaceCommandRuntime,
  type WorkspaceCommandSnapshot,
} from './define-command'
import { ITEM_POSITIONS } from './types'

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

function exportSelectedSessionTranscript() {
  const { selection } = useSessionSelectionStore.getState()
  if (selection.kind !== 'session') return false

  return downloadSessionTranscript(selection, 'markdown').then(() => true)
}

function dispositionFor(accepted: boolean): ImmediateCommandDisposition {
  return accepted ? handled : declined
}

async function revertSelectedEditorDocument(
  documentStore: EditorDocumentStoreApi,
  queryClient: QueryClient,
  activeDocument: DocumentRef | null,
) {
  const resource = filesystemResource(activeDocument)
  if (!resource) return false

  const file = await fetchFile(
    resource.path,
    new AbortController().signal,
    clientForQueryClient(queryClient),
  )
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

function reverseFileOperationStart(
  { runtime, snapshot }: WorkspaceCommandHandlerContext,
  direction: 'redo' | 'undo',
) {
  const rootPath = snapshot.rootPath
  if (!rootPath) return declined
  const commands = getNavigation().editorCommands(runtime.workspace)
  const fileOperations: FileOperationRuntime = {
    documents: fileOperationDocuments({
      documentStore: runtime.documents.store,
      queryClient: runtime.documents.queryClient,
      renameLiveEditorDocument: commands.renameLiveEditorDocument,
      workspaceStore: runtime.workspace,
    }),
    queryClient: runtime.documents.queryClient,
    rootPath: filesystemPath(rootPath),
    workspaceEdits: runtime.workspaceEdits,
  }
  return operationStart(reverseLatestFileOperation(fileOperations, direction))
}

function navigationStart(operation: Promise<NavigationResult>): StartedCommand {
  return afterNavigation(operation, () => handled)
}

function splitActiveEditor(runtime: WorkspaceCommandRuntime, edge: GroupEdge) {
  const panels = runtime.workspace.getState().workbenchPanels
  const group = activeEditorGroup(panels.editorGroups)
  const tab = activeEditorTabForWorkbenchPanels(panels)
  if (!tab || tab.content.kind !== 'document' || tab.content.document.kind === 'search')
    return declined
  if (groupSplitVerdict(group.id, edge) === 'too-small') return declined
  return afterNavigation(
    runtime.editor.placeTab({
      tabId: tab.id,
      mode: 'copy',
      target: { kind: 'edge', groupId: group.id, edge },
    }),
    () => focusActiveSurface(runtime),
  )
}

function focusEditorGroup(runtime: WorkspaceCommandRuntime, index: number) {
  const groups = runtime.workspace.getState().workbenchPanels.editorGroups
  const group = allEditorGroups(groups)[index]
  if (!group) return declined
  return afterNavigation(runtime.editor.setActiveGroup(group.id), () => focusActiveSurface(runtime))
}

function afterNavigation(
  operation: Promise<NavigationResult>,
  next: () => StartedCommand | ImmediateCommandDisposition,
): StartedCommand {
  return {
    status: 'started',
    completion: operation.then((result) => {
      if (result.status === 'superseded')
        return { reason: 'domain-discarded', status: 'cancelled' } as const
      if (result.status === 'unavailable') return declined
      const outcome = next()
      return outcome.status === 'started' ? outcome.completion : outcome
    }),
  }
}

function resolvedOperationStart(operation: Promise<unknown>): StartedCommand {
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

// Matched by session id: every tab registers a target for the same root path.
function focusActiveTerminalStart(
  runtime: WorkspaceCommandRuntime,
  rootPath: string,
  panels: WorkbenchPanels,
) {
  const sessionId = panels.activeTerminalTabId
  if (!sessionId) return handled

  return focusIdInLayoutStart(runtime, { kind: 'terminal', rootPath, sessionId }, 'workbench')
}

function selectAdjacentTerminal(
  { runtime, snapshot }: WorkspaceCommandHandlerContext,
  direction: TerminalTabDirection,
) {
  const rootPath = snapshot.rootPath
  if (!rootPath) return declined

  const panels = selectAdjacentTerminalTabInWorkbenchPanels(snapshot.workbenchPanels, direction)
  if (panels === snapshot.workbenchPanels) return declined

  runtime.workspace.getState().setWorkbenchPanels(panels)
  return focusActiveTerminalStart(runtime, rootPath, panels)
}

function focusFileTree(
  { runtime, snapshot }: WorkspaceCommandHandlerContext,
  intent: FocusIntent = 'focus',
) {
  const rootPath = snapshot.rootPath
  if (!rootPath) return declined
  return afterNavigation(
    getNavigation().setWorkbenchPanels(
      showWorkbenchSidebarTab(snapshot.workbenchPanels, 'files'),
      runtime.workspace,
      'workbench',
    ),
    () => focusIdInLayoutStart(runtime, { kind: 'file-tree', rootPath }, 'workbench', intent),
  )
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

// The chronological history commands: one state either way in sequence order, whatever branch.
function stepHistory(
  { runtime, snapshot }: WorkspaceCommandHandlerContext,
  step: -1 | 1,
): StartedCommand | typeof declined {
  const document = snapshot.activeDocument
  if (!document) return declined
  const live = runtime.documents.store.getState().getLiveEditorDocument(documentKey(document))
  if (!live) return declined
  const target = adjacentHistoryState(live.buffer.getHistoryGraph(), step)
  if (target === null) return declined

  return operationStart(
    runMutation(
      runtime.documents.queryClient,
      historyRestoreMutationOptions(live.key, live.buffer),
      target,
    ),
  )
}

function focusActiveSurface(runtime: WorkspaceCommandRuntime): StartedCommand {
  let workspace = runtime.workspace.getState()
  if (workspace.uiMode === 'chat') {
    if (
      workspace.chatModePanels.activeToolTab !== 'editor' ||
      !workspace.chatModePanels.toolPaneOpen
    )
      return afterNavigation(
        getNavigation().setChatModePanels(
          showChatModeToolTab(workspace.chatModePanels, 'editor'),
          runtime.workspace,
        ),
        () => focusActiveSurface(runtime),
      )
  }
  const activeTab = activeEditorTabForWorkbenchPanels(workspace.workbenchPanels)
  if (!activeTab) {
    return focusStart(runtime, {
      isValid: () => false,
      kind: 'match',
      matches: () => false,
    })
  }
  const layout = workspace.uiMode

  const document = activeTab.content.kind === 'document' ? activeTab.content.document : null
  const activeDiffPath =
    document?.kind === 'compare-saved' || document?.kind === 'git-diff'
      ? documentSourcePath(document)
      : null
  const activeSearchRoot = document?.kind === 'search' ? document.root : null
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
        sameTabContent(current.content, activeTab.content)
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

// Visibility only: the selected panel and outside focus stay as they were.
function toggleWorkbenchSidebar({ runtime, snapshot }: WorkspaceCommandHandlerContext) {
  if (!snapshot.rootPath) return declined

  const panels = setWorkbenchSidebarOpen(
    snapshot.workbenchPanels,
    !snapshot.workbenchPanels.sidebarOpen,
  )
  const stranded = !panels.sidebarOpen && focusInsideSidebar()
  return afterNavigation(
    getNavigation().setWorkbenchPanels(panels, runtime.workspace, 'workbench'),
    () => (stranded ? focusActiveSurfaceOrShell(runtime) : handled),
  )
}

function toggleSessionRail({ runtime, snapshot }: WorkspaceCommandHandlerContext) {
  const open = !snapshot.chatModePanels.sessionRailOpen
  const stranded = !open && focusInsideSidebar()
  return afterNavigation(
    getNavigation().setChatModePanels(
      setChatModeSessionRailOpen(snapshot.chatModePanels, open),
      runtime.workspace,
    ),
    () => (stranded ? chatFocusStart(runtime, snapshot.rootPath, 'chat') : handled),
  )
}

function addSelectionToChat({ runtime, snapshot }: WorkspaceCommandHandlerContext) {
  const target = chatAttachTarget(snapshot)
  if (!target || !snapshot.activeTabId) return declined

  const selections = selectedLines(runtime, snapshot.activeTabId)
  if (selections.length === 0) return attachFileMention(runtime, target)
  const text = selectionPrompt(target.path, selections)
  return dispositionFor(runtime.composer.attachText('editor-selection', text, target.destination))
}

function attachFileMention(
  runtime: WorkspaceCommandRuntime,
  target: NonNullable<ReturnType<typeof chatAttachTarget>>,
) {
  const mention = serializeComposerMention(target.path)
  return dispositionFor(runtime.composer.attachText('editor-file', mention, target.destination))
}

// The active file, workspace-relative, and the workspace whose composer should take it.
function chatAttachTarget(snapshot: WorkspaceCommandSnapshot) {
  const path = filesystemResource(snapshot.activeDocument)?.path
  if (!path || !snapshot.rootPath) return null

  return {
    destination: { environmentId: activeEnvironmentId(), rootPath: snapshot.rootPath },
    path: toTreePath(path, snapshot.rootPath),
  }
}

function selectedLines(runtime: WorkspaceCommandRuntime, tabId: TabId): readonly SelectedLines[] {
  const documents = runtime.documents.store.getState()
  const view = documents.getEditorView(tabId)
  const live = view ? documents.getLiveEditorDocument(view.documentKey) : null
  if (!view || !live) return []

  const pieces = live.buffer.getSnapshot()
  const text = live.buffer.getTextSnapshot()
  return view.view.getSelections().selections.flatMap((selection) => {
    const { endOffset, startOffset } = resolveSelection(pieces, selection)
    if (startOffset === endOffset) return []
    return [
      {
        startLine: text.lineAt(startOffset) + 1,
        endLine: text.lineAt(endOffset - 1) + 1,
        text: text.readRange(startOffset, endOffset),
      },
    ]
  })
}

/**
 * One key per slot for both screens: the snapshot's layout picks editor tabs or chats,
 * so a user override moves both at once. Hidden from the palette, like next/previous.
 */
function selectItemCommands() {
  return ITEM_POSITIONS.map((position) =>
    defineCommand({
      ...selectItemMetadata(position),
      run: (context) => {
        if (context.snapshot.uiMode === 'chat')
          return runSessionCommand(context, () => jumpToSession(position))
        const group = activeEditorGroup(context.snapshot.workbenchPanels.editorGroups)
        return selectEditorTab(
          context.runtime,
          group,
          position === 9 ? group.tabs.at(-1) : group.tabs[position - 1],
        )
      },
    }),
  )
}

function adjacentItemHandler(direction: SessionTraversalDirection) {
  return (context: WorkspaceCommandHandlerContext) => {
    if (context.snapshot.uiMode === 'chat')
      return runSessionCommand(context, () => selectAdjacentSession(direction))
    const group = activeEditorGroup(context.snapshot.workbenchPanels.editorGroups)
    return selectEditorTab(context.runtime, group, adjacentTab(group, direction))
  }
}

// Wraps at both ends, like the session rail.
function adjacentTab(group: EditorGroup, direction: SessionTraversalDirection) {
  const count = group.tabs.length
  if (count === 0) return undefined
  const index = group.tabs.findIndex((tab) => tab.id === group.selectedTabId)
  if (index < 0) return group.tabs[direction === 'next' ? 0 : count - 1]
  const step = direction === 'next' ? 1 : -1
  return group.tabs[(index + step + count) % count]
}

function selectEditorTab(
  runtime: WorkspaceCommandRuntime,
  group: EditorGroup,
  tab: EditorTabRecord | undefined,
) {
  if (!tab) return declined
  return afterNavigation(runtime.editor.selectTab({ groupId: group.id, tabId: tab.id }), () =>
    focusActiveSurface(runtime),
  )
}

// Panels exist only in the workbench; chat has no numbered target for these keys.
function sidebarPanelCommands() {
  return ITEM_POSITIONS.map((position) =>
    defineCommand({
      ...sidebarPanelMetadata(position),
      run: (context) => {
        const tab = WORKBENCH_SIDEBAR_TABS[position - 1]
        if (context.snapshot.uiMode !== 'workbench' || !tab) return declined
        return toggleSidebarPanel(context, tab)
      },
    }),
  )
}

function toggleSidebarPanel(
  { runtime, snapshot }: WorkspaceCommandHandlerContext,
  tab: WorkbenchSidebarTab,
) {
  const rootPath = snapshot.rootPath
  if (!rootPath) return declined

  const current = snapshot.workbenchPanels
  const showing = current.sidebarOpen && current.activeSidebarTab === tab
  const panels = showing
    ? setWorkbenchSidebarOpen(current, false)
    : showWorkbenchSidebarTab(current, tab)
  const stranded = !panels.sidebarOpen && focusInsideSidebar()
  return afterNavigation(
    getNavigation().setWorkbenchPanels(panels, runtime.workspace, 'workbench'),
    () => {
      if (panels.sidebarOpen) return focusSidebarPanel(runtime, rootPath, tab)
      return stranded ? focusActiveSurfaceOrShell(runtime) : handled
    },
  )
}

function focusSidebarPanel(
  runtime: WorkspaceCommandRuntime,
  rootPath: string,
  tab: WorkbenchSidebarTab,
) {
  if (tab === 'chat') return chatFocusStart(runtime, rootPath, 'workbench')
  return focusIdInLayoutStart(runtime, sidebarFocusTarget(rootPath, tab), 'workbench')
}

function sidebarFocusTarget(
  rootPath: string,
  tab: Exclude<WorkbenchSidebarTab, 'chat'>,
): FocusTargetId {
  if (tab === 'git') return { kind: 'git', rootPath }
  if (tab === 'logs') return { kind: 'logs' }
  if (tab === 'search') return { kind: 'search', rootPath, surface: 'sidebar' }
  return { kind: 'file-tree', rootPath }
}

export const workspaceCommands = [
  defineCommand({
    ...workspaceCommandMetadata['workspace.fixDiagnostic'],
    run: ({ target }) => (target.kind === 'diagnostic' && target.execute() ? handled : declined),
  }),
  defineCommand({
    ...workspaceCommandMetadata['workspace.toggleCheckpointChange'],
    run: ({ target }) =>
      target.kind === 'checkpoint-change' && target.execute() ? handled : declined,
  }),
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
    ...workspaceCommandMetadata['workspace.undoSessionAction'],
    icon: ArrowCounterClockwiseIcon,
    run: () => operationStart(undoLatestSessionAction()),
  }),
  defineCommand({
    ...workspaceCommandMetadata['workspace.redoSessionAction'],
    icon: ArrowClockwiseIcon,
    run: () => operationStart(redoLatestSessionAction()),
  }),
  defineCommand({
    ...workspaceCommandMetadata['fileTree.undo'],
    icon: ArrowCounterClockwiseIcon,
    run: (context) => reverseFileOperationStart(context, 'undo'),
  }),
  defineCommand({
    ...workspaceCommandMetadata['fileTree.redo'],
    icon: ArrowClockwiseIcon,
    run: (context) => reverseFileOperationStart(context, 'redo'),
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
    ...workspaceCommandMetadata['workspace.selectThemeBundle'],
    icon: SwatchesIcon,
    run: ({ invocation, runtime }) =>
      transitionStart(
        runtime.shell.showCommandPalette('bundle ', invocation.origin as FocusTargetToken | null),
      ),
  }),
  defineCommand({
    ...workspaceCommandMetadata['workspace.selectWallpaper'],
    icon: ImageIcon,
    run: ({ invocation, runtime }) =>
      transitionStart(
        runtime.shell.showCommandPalette(
          'wallpaper ',
          invocation.origin as FocusTargetToken | null,
        ),
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
    ...workspaceCommandMetadata['workspace.showUnicodeSettings'],
    icon: GearSixIcon,
    run: ({ invocation, runtime }) =>
      transitionStart(
        runtime.shell.showSettings(invocation.origin as FocusTargetToken | null, 'unicode'),
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
    ...workspaceCommandMetadata['workspace.showWatchSettings'],
    icon: GearSixIcon,
    run: ({ invocation, runtime }) =>
      transitionStart(
        runtime.shell.showSettings(
          invocation.origin as FocusTargetToken | null,
          'files.watchDirectoryLimit',
        ),
      ),
  }),
  defineCommand({
    ...workspaceCommandMetadata['workspace.cloneRepository'],
    icon: GitForkIcon,
    run: ({ runtime }) => {
      runtime.shell.showCloneRepository()
      return { status: 'handled' }
    },
  }),
  defineCommand({
    ...workspaceCommandMetadata['workspace.startPullRequestSession'],
    icon: GitPullRequestIcon,
    run: ({ runtime }) => {
      runtime.shell.showStartPullRequestSession()
      return { status: 'handled' }
    },
  }),
  defineCommand({
    ...workspaceCommandMetadata['workspace.showUsage'],
    icon: GaugeIcon,
    run: ({ invocation, runtime }) =>
      transitionStart(
        runtime.shell.showSettings(invocation.origin as FocusTargetToken | null, 'usage'),
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
    run: (context) => focusFileTree(context, 'create-file'),
  }),
  defineCommand({
    ...workbenchCommandMetadata['fileTree.newFolder'],
    undoCategory: 'file-operation',
    when: ['workspaceOpen', 'workspaceMutable'],
    icon: FolderPlusIcon,
    run: (context) => focusFileTree(context, 'create-folder'),
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
      const rootPath = snapshot.rootPath
      if (!rootPath) return declined

      return afterNavigation(runtime.editor.openSearchEditor(snapshot.rootPath), () =>
        focusActiveSurface(runtime),
      )
    },
  }),
  defineCommand({
    ...workspaceCommandMetadata['workspace.quickOpenPreviousEditor'],
    icon: ClockCounterClockwiseIcon,
    run: ({ runtime }) => {
      return afterNavigation(runtime.editor.selectPreviousEditor(), () =>
        focusActiveSurface(runtime),
      )
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
      if (!filesystemResource(snapshot.activeDocument)) return declined

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
      const document = snapshot.activeDocument
      if (!document || saveCapability(document).kind === 'none') return declined
      return operationStart(runtime.documents.save.save(documentKey(document)))
    },
  }),
  defineCommand({
    ...workspaceCommandMetadata['workspace.saveAllFiles'],
    icon: FloppyDiskBackIcon,
    run: ({ runtime }) => resolvedOperationStart(runtime.documents.save.saveAll()),
  }),
  defineCommand({
    ...workspaceCommandMetadata['workspace.compareWithSaved'],
    run: ({ runtime, snapshot }) => {
      const resource = filesystemResource(snapshot.activeDocument)
      if (!resource) return declined

      return afterNavigation(
        runtime.editor.openTabContent(documentTab({ kind: 'compare-saved', file: resource })),
        () => focusActiveSurface(runtime),
      )
    },
  }),
  defineCommand({
    ...workspaceCommandMetadata['workspace.showHistory'],
    icon: ClockCounterClockwiseIcon,
    run: ({ runtime, snapshot }) => {
      const resource = filesystemResource(snapshot.activeDocument)
      if (!resource) return declined

      // No editor focus target to chase: the pane owns its own keyboard surface.
      return navigationStart(
        runtime.editor.openTabContent(documentTab({ kind: 'history', file: resource })),
      )
    },
  }),
  defineCommand({
    ...workspaceCommandMetadata['workspace.historyBack'],
    run: (context) => stepHistory(context, -1),
  }),
  defineCommand({
    ...workspaceCommandMetadata['workspace.historyForward'],
    run: (context) => stepHistory(context, 1),
  }),
  defineCommand({
    ...workspaceCommandMetadata['workspace.openFileAtHead'],
    run: ({ runtime, snapshot }) => {
      const resource = filesystemResource(snapshot.activeDocument)
      if (!resource) return declined

      return {
        completion: runtime.files.openFileAtRef(resource.path, 'HEAD').then(async (opened) => {
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
      if (!filesystemResource(snapshot.activeDocument)) return declined

      return operationStart(
        revertSelectedEditorDocument(
          runtime.documents.store,
          runtime.documents.queryClient,
          snapshot.activeDocument,
        ),
      )
    },
  }),
  defineCommand({
    ...workspaceCommandMetadata['workspace.reopenClosedEditor'],
    icon: ArrowClockwiseIcon,
    run: ({ runtime }) => {
      return afterNavigation(runtime.editor.reopenClosedEditor(), () => focusActiveSurface(runtime))
    },
  }),
  defineCommand({
    ...workspaceCommandMetadata['workspace.addSelectionToChat'],
    icon: ChatCircleIcon,
    run: addSelectionToChat,
  }),
  defineCommand({
    ...workspaceCommandMetadata['workspace.cycleMarkdownView'],
    icon: ArticleIcon,
    run: ({ snapshot }) => {
      const document = snapshot.activeDocument
      const path = filesystemResource(document)?.path
      if (!document || !path || !isMarkdownPath(path)) return declined
      const key = documentKey(document)
      const current = markdownViewOverride(key) ?? readSettingsMirror()['editor.markdownView']
      setMarkdownViewOverride(key, nextMarkdownView(current))
      return handled
    },
  }),
  defineCommand({
    ...workspaceCommandMetadata['workspace.addFileToChat'],
    icon: ChatCircleIcon,
    run: ({ runtime, snapshot }) => {
      const target = chatAttachTarget(snapshot)
      return target ? attachFileMention(runtime, target) : declined
    },
  }),
  defineCommand({
    ...workspaceCommandMetadata['workspace.toggleSidebarVisibility'],
    icon: SidebarSimpleIcon,
    run: (context) =>
      context.snapshot.uiMode === 'chat'
        ? toggleSessionRail(context)
        : toggleWorkbenchSidebar(context),
  }),
  defineCommand({
    ...workspaceCommandMetadata['workspace.togglePanel'],
    icon: SquareHalfBottomIcon,
    run: ({ runtime, snapshot }) => {
      const rootPath = snapshot.rootPath
      if (!rootPath) return declined

      const workspace = runtime.workspace.getState()
      const revealing = workspace.uiMode !== 'workbench'
      const panels = revealing
        ? showWorkbenchBottomTab(snapshot.workbenchPanels, 'terminal')
        : toggleWorkbenchBottomTab(snapshot.workbenchPanels, 'terminal')
      return afterNavigation(
        getNavigation().setWorkbenchPanels(panels, runtime.workspace, 'workbench'),
        () => {
          if (!panels.bottomPanelOpen) return handled
          return focusActiveTerminalStart(runtime, rootPath, panels)
        },
      )
    },
  }),
  defineCommand({
    ...workspaceCommandMetadata['workspace.splitEditorRight'],
    icon: FilesIcon,
    run: ({ runtime }) => splitActiveEditor(runtime, 'right'),
  }),
  defineCommand({
    ...workspaceCommandMetadata['workspace.splitEditorDown'],
    icon: FilesIcon,
    run: ({ runtime }) => splitActiveEditor(runtime, 'bottom'),
  }),
  defineCommand({
    ...workspaceCommandMetadata['workspace.moveTabToGroup'],
    icon: FilesIcon,
    run: ({ runtime }) => {
      const panels = runtime.workspace.getState().workbenchPanels
      const tab = activeEditorTabForWorkbenchPanels(panels)
      if (!tab || allEditorGroups(panels.editorGroups).length < 2) return declined
      runtime.editor.requestMoveTab(tab.id)
      return handled
    },
  }),
  defineCommand({
    ...workspaceCommandMetadata['workspace.focusFirstEditorGroup'],
    icon: CrosshairIcon,
    run: ({ runtime }) => focusEditorGroup(runtime, 0),
  }),
  defineCommand({
    ...workspaceCommandMetadata['workspace.focusSecondEditorGroup'],
    icon: CrosshairIcon,
    run: ({ runtime }) => focusEditorGroup(runtime, 1),
  }),
  defineCommand({
    ...workspaceCommandMetadata['workspace.focusThirdEditorGroup'],
    icon: CrosshairIcon,
    run: ({ runtime }) => focusEditorGroup(runtime, 2),
  }),
  defineCommand({
    ...workspaceCommandMetadata['workspace.focusEditor'],
    icon: CrosshairIcon,
    run: ({ runtime }) => focusActiveSurface(runtime),
  }),
  defineCommand({
    ...workspaceCommandMetadata['workspace.focusFileTree'],
    icon: CrosshairIcon,
    run: (context) => focusFileTree(context, 'focus'),
  }),
  defineCommand({
    ...workspaceCommandMetadata['workspace.findInFileTree'],
    icon: FileMagnifyingGlassIcon,
    run: (context) => focusFileTree(context, 'open-search'),
  }),
  defineCommand({
    ...workspaceCommandMetadata['workspace.revealActiveFileInTree'],
    icon: CrosshairIcon,
    run: (context) => {
      if (!filesystemResource(context.snapshot.activeDocument)) return declined
      return focusFileTree(context, 'reveal-active')
    },
  }),
  defineCommand({
    ...workspaceCommandMetadata['workspace.focusGit'],
    icon: CrosshairIcon,
    run: ({ runtime, snapshot }) => {
      const rootPath = snapshot.rootPath
      if (!rootPath) return declined

      return afterNavigation(
        getNavigation().setWorkbenchPanels(
          showWorkbenchSidebarTab(snapshot.workbenchPanels, 'git'),
          runtime.workspace,
          'workbench',
        ),
        () => focusIdInLayoutStart(runtime, { kind: 'git', rootPath }, 'workbench'),
      )
    },
  }),
  defineCommand({
    ...workspaceCommandMetadata['workspace.copyAddress'],
    run: () => {
      return resolvedOperationStart(
        copyTextToClipboard(getNavigation().copyAddress().href, 'address'),
      )
    },
  }),
  defineCommand({
    ...workspaceCommandMetadata['workspace.navigateBack'],
    run: () => {
      getNavigation().back()
      return handled
    },
  }),
  defineCommand({
    ...workspaceCommandMetadata['workspace.navigateForward'],
    run: () => {
      getNavigation().forward()
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
        return afterNavigation(
          getNavigation().setWorkbenchPanels(
            showWorkbenchSidebarTab(snapshot.workbenchPanels, 'chat'),
            runtime.workspace,
          ),
          () => chatFocusStart(runtime, snapshot.rootPath, snapshot.uiMode),
        )
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
      const rootPath = snapshot.rootPath
      if (!rootPath) return declined

      const panels = showWorkbenchBottomTab(snapshot.workbenchPanels, 'terminal')
      return afterNavigation(
        getNavigation().setWorkbenchPanels(panels, runtime.workspace, 'workbench'),
        () => focusActiveTerminalStart(runtime, rootPath, panels),
      )
    },
  }),
  defineCommand({
    ...workspaceCommandMetadata['workspace.newTerminal'],
    icon: TerminalIcon,
    run: ({ runtime, snapshot }) => {
      const rootPath = snapshot.rootPath
      if (!rootPath) return declined

      const panels = showWorkbenchBottomTab(
        openTerminalTabInWorkbenchPanels(snapshot.workbenchPanels),
        'terminal',
      )
      return afterNavigation(
        getNavigation().setWorkbenchPanels(panels, runtime.workspace, 'workbench'),
        () => focusActiveTerminalStart(runtime, rootPath, panels),
      )
    },
  }),
  defineCommand({
    ...workspaceCommandMetadata['workspace.killTerminal'],
    icon: XIcon,
    run: ({ runtime, snapshot }) => {
      const rootPath = snapshot.rootPath
      const tabId = snapshot.workbenchPanels.activeTerminalTabId
      if (!rootPath || !tabId) return declined

      const queryClient = runtime.documents.queryClient
      const server = {
        client: clientForQueryClient(queryClient),
        origin: originForQueryClient(queryClient),
      }
      const panels = killTerminalTab(snapshot.workbenchPanels, server, rootPath, tabId)
      runtime.workspace.getState().setWorkbenchPanels(panels)
      return focusActiveTerminalStart(runtime, rootPath, panels)
    },
  }),
  defineCommand({
    ...workspaceCommandMetadata['workspace.focusNextTerminal'],
    run: (context) => selectAdjacentTerminal(context, 'next'),
  }),
  defineCommand({
    ...workspaceCommandMetadata['workspace.focusPreviousTerminal'],
    run: (context) => selectAdjacentTerminal(context, 'previous'),
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

      return afterNavigation(result.completion, () => focusActiveSurfaceOrShell(runtime))
    },
  }),
  defineCommand({
    ...workspaceCommandMetadata['workspace.newChat'],
    icon: ChatCircleIcon,
    run: ({ snapshot }) => {
      const start = snapshot.uiMode === 'chat' ? startScopedSessionDraft : startSidebarSessionDraft
      const started = start()
      return operationStart(started instanceof Promise ? started : Promise.resolve(started))
    },
  }),
  defineCommand({
    ...workspaceCommandMetadata['workspace.acceptCommitMessage'],
    icon: CheckIcon,
    run: ({ runtime, snapshot }) => {
      const path = commitMessageFilePath(snapshot.activeDocument)
      const tabId = snapshot.activeTabId
      if (!path || !tabId || !snapshot.rootPath || !snapshot.activeDocument) return declined

      // Armed before the save: closing the tab is what commits, and a reload
      // since the file opened would have forgotten that a commit was waiting.
      runtime.git.setPendingMessageFile(snapshot.rootPath, path)
      const saved = runtime.documents.save.save(documentKey(snapshot.activeDocument))
      return operationStart(saved.then((ok) => ok && closeSavedTab(runtime, tabId)))
    },
  }),
  defineCommand({
    ...workspaceCommandMetadata['workspace.discardCommitMessage'],
    icon: XIcon,
    run: ({ runtime, snapshot }) => {
      const path = commitMessageFilePath(snapshot.activeDocument)
      if (!path || !snapshot.activeTabId || !snapshot.rootPath) return declined

      runtime.git.setPendingMessageFile(snapshot.rootPath, null)
      runtime.editor.discardAndCloseTab(snapshot.activeTabId)
      return resolvedOperationStart(Promise.resolve())
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
      return afterNavigation(getNavigation().setMode(nextMode, runtime.workspace), () => {
        if (nextMode === 'chat') return chatFocusStart(runtime, snapshot.rootPath, 'chat')
        return focusWorkbench(runtime)
      })
    },
  }),
  defineCommand({
    ...workspaceCommandMetadata['workspace.showChatMode'],
    run: ({ runtime, snapshot }) => {
      return afterNavigation(getNavigation().setMode('chat', runtime.workspace), () =>
        chatFocusStart(runtime, snapshot.rootPath, 'chat'),
      )
    },
  }),
  defineCommand({
    ...workspaceCommandMetadata['workspace.showWorkbenchMode'],
    run: ({ runtime }) => {
      return afterNavigation(getNavigation().setMode('workbench', runtime.workspace), () =>
        focusWorkbench(runtime),
      )
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
    ...workspaceCommandMetadata['wallpaper.next'],
    icon: ImageIcon,
    run: ({ runtime }) => operationStart(runtime.settings.nextWallpaper()),
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
  defineCommand({
    ...workspaceCommandMetadata['workspace.newSession'],
    run: (context) => runSessionCommand(context, startScopedSessionDraft),
  }),
  defineCommand({
    ...workspaceCommandMetadata['workspace.exportTranscript'],
    icon: DownloadSimpleIcon,
    run: (context) => runSessionCommand(context, exportSelectedSessionTranscript),
  }),
  defineCommand({
    ...workspaceCommandMetadata['workspace.nextItem'],
    run: adjacentItemHandler('next'),
  }),
  defineCommand({
    ...workspaceCommandMetadata['workspace.previousItem'],
    run: adjacentItemHandler('previous'),
  }),
  defineCommand({
    ...workspaceCommandMetadata['workspace.toggleSessionRail'],
    run: (context) => {
      if (context.snapshot.uiMode !== 'chat') return declined
      return toggleSessionRail(context)
    },
  }),
  ...selectItemCommands(),
  ...sidebarPanelCommands(),
]

export type WorkspaceCommandId = (typeof workspaceCommands)[number]['id']

function closeSavedTab(runtime: WorkspaceCommandRuntime, tabId: TabId) {
  runtime.editor.closeTab(tabId)
  return true
}
