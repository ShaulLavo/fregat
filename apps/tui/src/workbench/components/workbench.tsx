import { useLayoutEffect, useState, useSyncExternalStore } from 'react'
import { useTerminalDimensions } from '@opentui/react'
import { useCommands } from '@/commands/hooks/use-commands'
import { useCommandHandlers } from '@/commands/hooks/use-command-handlers'
import { commandShortcut } from '@/commands/utils/bindings'
import type { FocusArea } from '@workspace/client-core/commands/focus'
import type { SessionState, SettingsSession } from '@/connection/state/session'
import type { Theme } from '@/theme/utils/theme'
import { EmptyState } from '@/components/empty-state'
import { FileTree } from '@/tree/components/tree'
import { FileViewer } from '@/viewer/components/viewer'
import { ProblemsPane } from '@/viewer/components/problems'
import type { ViewerDiagnostics } from '@/viewer/utils/lsp'
import { TerminalPane } from '@/terminal/components/pane'
import { GitPane } from '@/git/components/pane'
import { SearchPane } from '@/search/components/pane'
import { LogsPane } from '@/logs/components/pane'
import {
  workbenchPanes,
  type WorkbenchLocation,
  type WorkbenchPane,
} from '@/workbench/utils/location'
import { paneAreas, paneLabels, primaryPaneTarget } from '@/workbench/utils/panes'

export function Workbench({
  session,
  state,
  location,
  theme,
  enabled,
  onNavigate,
}: {
  readonly session: SettingsSession
  readonly state: Extract<SessionState, { kind: 'ready' }>
  readonly location: WorkbenchLocation
  readonly theme: Theme
  readonly enabled: boolean
  readonly onNavigate: (location: WorkbenchLocation, replace?: boolean) => void
}) {
  const { width, height } = useTerminalDimensions()
  const commands = useCommands()
  const focusState = useSyncExternalStore(commands.focus.subscribe, commands.focus.getSnapshot)
  const { rootPath, pane } = location
  const [sidebar, setSidebar] = useState(
    () => state.storage.getItem(`workbench:sidebar:${rootPath}`) !== 'hidden',
  )
  const [diagnostics, setDiagnostics] = useState<ViewerDiagnostics>({
    path: '',
    status: 'unavailable',
    message: 'Open a file to see diagnostics.',
    items: [],
  })
  const wide = width >= 90
  const bottom = pane === 'terminal' || pane === 'problems'
  const editorShown = pane === 'files' || (bottom && wide && height >= 30)
  const treeShown = sidebar && (wide || (pane === 'files' && (location.tree || !location.path)))
  const interactive = enabled && state.connection.kind === 'live'
  function focus(area: FocusArea) {
    commands.focus.request({ kind: 'match', matches: (target) => primaryPaneTarget(target, area) })
  }
  useLayoutEffect(() => {
    if (!interactive || focusState.scope.screen !== 'workbench') return
    const snapshot = commands.focus.getSnapshot()
    if (snapshot.current?.capabilities.overlay || snapshot.requested?.target?.capabilities.overlay)
      return
    const area =
      pane === 'files' && (!location.path || location.tree) ? 'file-tree' : paneAreas[pane]
    commands.focus.request({ kind: 'match', matches: (target) => primaryPaneTarget(target, area) })
  }, [
    commands.focus,
    pane,
    location.path,
    location.tree,
    interactive,
    focusState.scope.screen,
    focusState.scope.projectId,
    wide,
    treeShown,
  ])
  function selectPane(next: WorkbenchPane) {
    if (next === 'files' && location.tree) {
      onNavigate({ ...location, pane: next, tree: false }, true)
      return
    }
    if (next !== pane) onNavigate({ ...location, pane: next }, true)
    else focus(paneAreas[next])
  }
  function openFile(path: string, line?: number) {
    onNavigate({ kind: 'workbench', rootPath, pane: 'files', path, line })
  }
  function updateSidebar(next: boolean) {
    state.storage.setItem(`workbench:sidebar:${rootPath}`, next ? 'visible' : 'hidden')
    setSidebar(next)
  }
  useCommandHandlers(
    {
      'workspace.focusFileTree': {
        run: () => {
          updateSidebar(true)
          onNavigate({ ...location, pane: 'files', tree: true }, true)
          focus('file-tree')
        },
      },
      'workspace.focusEditor': {
        run: () => {
          onNavigate({ ...location, pane: 'files', tree: false }, true)
          focus('editor')
        },
      },
      'workspace.focusFirstEditorGroup': { run: () => selectPane('files') },
      'workspace.focusGit': { run: () => selectPane('git') },
      'workspace.openSearchEditor': { run: () => selectPane('search') },
      'workspace.revealTerminal': { run: () => selectPane('terminal') },
      'workspace.showProblems': { run: () => selectPane('problems') },
      'workspace.showLogs': { run: () => selectPane('logs') },
      'workspace.toggleSidebar': { run: () => updateSidebar(!sidebar) },
      'workspace.closeCurrentTab': {
        disabledReason: () => (location.path ? null : 'No file is open.'),
        run: () => onNavigate({ kind: 'workbench', rootPath, pane: 'files' }),
      },
    },
    interactive,
  )
  return (
    <box flexDirection='column' flexGrow={1} minHeight={0} overflow='hidden'>
      <box
        flexDirection='row'
        gap={2}
        paddingX={1}
        height={1}
        flexShrink={0}
        backgroundColor={theme.card}
      >
        {workbenchPanes.map((value) => (
          <text
            key={value}
            fg={pane === value ? theme.primary : theme.mutedForeground}
            onMouseDown={() => {
              if (interactive) selectPane(value)
            }}
          >
            {pane === value ? `[${paneLabels[value]}]` : paneLabels[value]}
          </text>
        ))}
      </box>
      <text fg={theme.mutedForeground} paddingX={1} height={1} flexShrink={0}>
        {rootPath || 'Server root'} ·{' '}
        {commandShortcut(commands.bindings, 'workspace.changeProject')} open folder ·{' '}
        {commandShortcut(commands.bindings, 'workspace.navigateBack')} back
      </text>
      <box flexDirection='row' flexGrow={1} minHeight={0}>
        {treeShown && (
          <box
            width={wide ? 28 : '100%'}
            minHeight={0}
            border
            borderStyle='single'
            borderColor={theme.border}
          >
            <FileTree
              session={session}
              rootPath={rootPath}
              theme={theme}
              enabled={interactive}
              onOpenFile={openFile}
            />
          </box>
        )}
        {(wide || !treeShown) && (
          <box flexDirection='column' flexGrow={1} minWidth={0} minHeight={0}>
            <box flexGrow={1} minHeight={0} visible={editorShown}>
              {location.path ? (
                <FileViewer
                  key={location.path}
                  session={session}
                  rootPath={rootPath}
                  path={location.path}
                  line={location.line}
                  theme={theme}
                  enabled={interactive && editorShown}
                  onOpenFile={openFile}
                  onPositionChange={(line) => {
                    if (location.line === line) return
                    onNavigate({ ...location, line }, true)
                  }}
                  onDiagnostics={setDiagnostics}
                />
              ) : (
                <EmptyState
                  title='Open a file'
                  description={`Choose a file from the tree or use ${commandShortcut(commands.bindings, 'workspace.showQuickAccess')}. ${commandShortcut(commands.bindings, 'workspace.revealTerminal')} opens a terminal.`}
                  theme={theme}
                />
              )}
            </box>
            {pane === 'git' && (
              <GitPane
                session={session}
                rootPath={rootPath}
                theme={theme}
                enabled={interactive}
                onOpenFile={openFile}
              />
            )}
            {pane === 'search' && (
              <SearchPane
                session={session}
                rootPath={rootPath}
                theme={theme}
                enabled={interactive}
                onOpenFile={openFile}
              />
            )}
            {pane === 'logs' && (
              <LogsPane session={session} rootPath={rootPath} theme={theme} enabled={interactive} />
            )}
            {bottom && (
              <box
                height={editorShown ? Math.max(8, Math.floor(height * 0.38)) : undefined}
                flexGrow={editorShown ? 0 : 1}
                minHeight={0}
                border
                borderStyle='single'
                borderColor={theme.border}
              >
                {pane === 'terminal' ? (
                  <TerminalPane
                    session={session}
                    rootPath={rootPath}
                    theme={theme}
                    enabled={interactive}
                  />
                ) : (
                  <ProblemsPane
                    diagnostics={diagnostics}
                    theme={theme}
                    enabled={interactive}
                    onOpenFile={openFile}
                  />
                )}
              </box>
            )}
          </box>
        )}
      </box>
    </box>
  )
}
