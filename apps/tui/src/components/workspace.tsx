import { AgentNavigationContext } from '@/navigation/providers/agent-context'
import type { AgentNavigation } from '@/navigation/providers/agent-context'
import { queuePrompt } from '@/agent-stage/state/inbox'
import { toWorkspaceAbsolute, toWorkspaceRelative } from '@workspace/client-core/files/path'
import { AgentScreen } from '@/agent/components/screen'
import { agentHome, type AgentLocation } from '@/agent/utils/target'
import { rememberAgent, rememberedAgent } from '@/agent/utils/location'
import { currentWorktree, selectedWorktree } from '@/agent/utils/selection'
import { parsePickerPathInput } from '@workspace/client-core/files/path-input'
import { createTuiError } from '@/host/utils/structured-errors'
import { connectionFailure } from '@/connection/utils/failure'
import { Toast } from '@/components/toast'
import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { commandById, type CommandId } from '@workspace/client-core/commands/catalog'

import { useCommands } from '@/commands/hooks/use-commands'
import { useCommandHandlers } from '@/commands/hooks/use-command-handlers'
import { useThemeCommands } from '@/commands/hooks/use-theme-commands'
import type { FocusToken } from '@/commands/state/focus'
import { CommandPalette } from '@/commands/components/palette'
import { ShortcutHelp } from '@/commands/components/help'
import { SettingsBrowser } from '@/settings/components/browser'
import { FileView } from '@/files/components/view'
import { AddressDialog } from '@/navigation/components/address'
import type { NavigationHistory } from '@/navigation/state/history'
import type { DialogKind, Overlay } from '@/navigation/utils/overlay'
import type { SessionState, SettingsSession } from '@/connection/state/session'
import type { Theme } from '@/theme/utils/theme'
import { useHostActions } from '@/host/hooks/use-host-actions'
import { readEntry, readServerPaths } from '@workspace/client-core/files/read'
import { isDirectoryEntry } from '@workspace/contracts'
import { parentDirectory } from '@/files/utils/list'
import { Workbench } from '@/workbench/components/workbench'
import {
  rememberWorkbench,
  rememberedWorkbench,
  type WorkbenchLocation,
} from '@/workbench/utils/location'

export function Workspace({
  session,
  state,
  theme,
  history,
}: {
  session: SettingsSession
  state: Extract<SessionState, { kind: 'ready' }>
  theme: Theme
  history: NavigationHistory
}) {
  const [overlay, setOverlay] = useState<Overlay | null>(null)
  const [editing, setEditing] = useState(false)
  const [settingsQuery, setSettingsQuery] = useState(() => {
    const initial = history.getSnapshot().current
    return initial.kind === 'settings' ? initial.query : ''
  })
  const [fileFailure, setFileFailure] = useState<string | null>(null)
  const search = useRef(settingsQuery)
  const navigationRequest = useRef(0)
  const navigation = useSyncExternalStore(history.subscribe, history.getSnapshot)
  const chat = useSyncExternalStore(state.chat.subscribe, state.chat.getSnapshot)
  useLayoutEffect(() => {
    const remember = () => {
      const location = history.getSnapshot().current
      if (location.kind === 'workbench') rememberWorkbench(state.storage, location)
      if (location.kind === 'agent') rememberAgent(state.storage, location)
    }
    remember()
    return history.subscribe(remember)
  }, [history, state.storage])
  const currentOverlay = useRef(overlay)
  useLayoutEffect(() => {
    currentOverlay.current = overlay
  }, [overlay])
  const commands = useCommands()
  const host = useHostActions()
  const restore = useRef<FocusToken | null | undefined>(undefined)
  const pendingCommand = useRef<{ id: CommandId; origin: FocusToken | null } | null>(null)
  const live = state.connection.kind === 'live'
  const networkOverlay = overlay?.kind === 'address' || overlay?.kind === 'copy-address'
  const networkView = navigation.current.kind === 'files'
  useThemeCommands(state.owner, live)
  useLayoutEffect(() => {
    if (!live && (networkOverlay || networkView)) {
      navigationRequest.current += 1
      restore.current = overlay?.origin ?? null
      history.visit({ kind: 'settings', query: search.current })
      // oxlint-disable-next-line oxc-react-compiler/set-state-in-effect -- Close network surfaces before restoring cached-settings focus.
      setOverlay(null)
      return
    }
    if (overlay?.kind === 'commands') return
    if (!overlay && restore.current !== undefined) {
      commands.focus.restore(restore.current)
      restore.current = undefined
    }
    const pending = pendingCommand.current
    pendingCommand.current = null
    if (pending)
      void commands.bus.capture('palette', pending.origin).dispatch(pending.id).completion
  }, [overlay, networkOverlay, networkView, live, commands, history])
  function show(kind: DialogKind, origin: FocusToken | null, query?: string) {
    setOverlay({
      kind,
      query,
      origin: currentOverlay.current?.origin ?? origin,
    })
  }
  async function showFiles(query?: string) {
    setFileFailure(null)
    const request = ++navigationRequest.current
    const current = history.getSnapshot().current
    const paths = await readServerPaths({ client: session.client, signal: session.signal })
    const agent = current.kind === 'agent' ? current : (rememberedAgent(state.storage) ?? agentHome)
    const worktree = selectedWorktree(state.chat.getSnapshot().projection, agent)
    let initial =
      worktree?.path ?? state.storage.getItem('file-picker-directory') ?? paths.defaultPath
    if (current.kind === 'workbench') initial = current.rootPath
    if (current.kind === 'files') initial = current.path
    const parsed = initial === '' ? { path: '' } : parsePickerPathInput(initial, paths)
    if (parsed.path === null)
      throw createTuiError(parsed.error, 'Choose a folder available on this server.')
    if (request !== navigationRequest.current) return
    let workbenchRoot: string | undefined
    if (current.kind === 'workbench') workbenchRoot = current.rootPath
    if (current.kind === 'files') workbenchRoot = current.workbenchRoot
    history.visit({
      kind: 'files',
      path: parsed.path,
      rootPath: current.kind === 'files' ? current.rootPath : parsed.path,
      query,
      workbenchRoot,
    })
    setOverlay(null)
    restore.current = undefined
  }
  function dismiss() {
    const active = currentOverlay.current
    if (!active) return false
    setOverlay(null)
    restore.current = active.origin
  }
  function openSettings(query = search.current) {
    navigationRequest.current += 1
    search.current = query
    setSettingsQuery(query)
    history.visit({ kind: 'settings', query })
    if (currentOverlay.current) {
      setOverlay(null)
      restore.current = null
      return
    }
    commands.focus.restore(null)
  }
  function navigate(direction: -1 | 1) {
    navigationRequest.current += 1
    const location = history.go(direction)
    if (!location) return false
    setOverlay(null)
    restore.current = undefined
    if (location.kind !== 'settings') return true
    search.current = location.query
    setSettingsQuery(location.query)
    return true
  }
  function updateSearch(query: string) {
    search.current = query
    setSettingsQuery(query)
    if (history.getSnapshot().current.kind === 'settings')
      history.replace({ kind: 'settings', query })
  }
  function recordLocation(location: { path: string; rootPath: string }) {
    const current = history.getSnapshot().current
    if (current.kind !== 'files') return
    const next = { ...current, ...location, kind: 'files' as const }
    if (current.path === location.path) history.replace(next)
    else history.visit(next)
  }
  function updateFileQuery(query: string) {
    const current = history.getSnapshot().current
    if (current.kind === 'files') history.replace({ ...current, query })
  }
  function openFilesFromPalette(query: string) {
    void showFiles(query).catch((error) => {
      const reason = connectionFailure(error)
      setFileFailure(reason.message)
      session.record({ action: 'tui.files.open.failed', ...reason })
    })
  }
  function openBrowserFile(path: string) {
    const current = history.getSnapshot().current
    if (current.kind !== 'files') return
    let rootPath = current.rootPath
    if (
      current.workbenchRoot !== undefined &&
      toWorkspaceRelative(current.workbenchRoot, path) !== null
    )
      rootPath = current.workbenchRoot
    visitWorkbench({ kind: 'workbench', rootPath, pane: 'files', path, tree: false })
  }
  function visitWorkbench(location: WorkbenchLocation, replace = false) {
    navigationRequest.current += 1
    if (replace) history.replace(location)
    else history.visit(location)
    setOverlay(null)
    restore.current = undefined
  }
  function openAgentFile({
    rootPath,
    relativePath,
    line,
  }: {
    rootPath: string
    relativePath: string
    line?: number
  }) {
    const path = toWorkspaceAbsolute(rootPath, relativePath)
    if (path === null)
      throw createTuiError(
        'The file is outside this checkout.',
        'Choose a file inside the session checkout.',
      )
    visitWorkbench({ kind: 'workbench', rootPath, path, line, pane: 'files', tree: false })
  }
  function visitAgent(location: AgentLocation) {
    navigationRequest.current += 1
    history.visit(location)
    setOverlay(null)
    restore.current = undefined
  }
  const queueAgentPrompt: AgentNavigation['queuePrompt'] = ({ worktreeId, context }) => {
    const worktree = state.chat.getSnapshot().projection.worktreeById[worktreeId]
    if (!worktree)
      throw createTuiError(
        'This checkout is unavailable.',
        'Select a registered project before attaching terminal context.',
      )
    queuePrompt(state.storage, worktreeId, context)
    visitAgent({ kind: 'agent', projectId: worktree.projectId, sessionId: null, worktreeId })
  }
  async function openWorkbench(path?: string) {
    const request = ++navigationRequest.current
    const current = history.getSnapshot().current
    const paths = await readServerPaths({ client: session.client, signal: session.signal })
    const projection = state.chat.getSnapshot().projection
    const agentWorktree = current.kind === 'agent' ? selectedWorktree(projection, current) : null
    if (
      path === undefined &&
      current.kind === 'agent' &&
      (current.worktreeId || current.sessionId) &&
      !agentWorktree
    )
      throw createTuiError(
        'This checkout is unavailable.',
        'Choose an available checkout before opening its workbench.',
      )
    let initial = path ?? paths.defaultPath
    if (path === undefined && agentWorktree) initial = agentWorktree.path
    if (path === undefined && (current.kind === 'files' || current.kind === 'workbench'))
      initial = current.path ?? current.rootPath
    if (initial.startsWith('/')) {
      const parsed = parsePickerPathInput(initial, paths)
      if (parsed.path === null)
        throw createTuiError(parsed.error, 'Choose a folder available on this server.')
      initial = parsed.path
    }
    const entry = await readEntry({ client: session.client, path: initial, signal: session.signal })
    if (request !== navigationRequest.current) return
    const rootPath = isDirectoryEntry(entry) ? initial : parentDirectory(initial)
    const remembered = rememberedWorkbench(state.storage, rootPath)
    visitWorkbench(
      remembered ?? {
        kind: 'workbench',
        rootPath,
        pane: 'files',
        path: isDirectoryEntry(entry) ? undefined : initial,
      },
    )
  }
  function changeSettingsDialog(open: boolean) {
    setEditing(open)
    if (open) openSettings()
  }
  const disabledReason = () => (editing ? 'Finish editing this setting first.' : null)
  const networkDisabledReason = () =>
    live ? disabledReason() : 'Reconnect to browse files and open addresses.'
  const location = navigation.current
  useCommandHandlers({
    'workspace.revealChat': {
      disabledReason,
      run: () => visitAgent(rememberedAgent(state.storage) ?? agentHome),
    },
    'workspace.openWorkbench': {
      disabledReason: networkDisabledReason,
      run: () => openWorkbench(),
    },
    'workspace.changeProject': {
      disabledReason: networkDisabledReason,
      run: () => showFiles(),
    },
    'workspace.showCommandPalette': {
      disabledReason,
      run: ({ origin }) => show('commands', origin, '>'),
    },
    'workspace.showQuickAccess': {
      disabledReason: networkDisabledReason,
      run: () => showFiles(),
    },
    'workspace.showSettings': { disabledReason, run: () => openSettings() },
    'workspace.quickOpenView': {
      disabledReason,
      run: ({ origin }) => show('commands', origin, 'view '),
    },
    'workspace.selectColorMode': {
      disabledReason,
      run: ({ origin }) => show('commands', origin, 'color '),
    },
    'workspace.selectColorTheme': {
      disabledReason,
      run: ({ origin }) => show('commands', origin, 'theme '),
    },
    'workspace.openAddress': {
      disabledReason: networkDisabledReason,
      run: ({ origin }) => show('address', origin),
    },
    'workspace.copyAddress': {
      disabledReason: networkDisabledReason,
      run: ({ origin }) => show('copy-address', origin),
    },
    'workspace.navigateBack': {
      disabledReason: () =>
        networkDisabledReason() ?? (navigation.canGoBack ? null : 'No earlier location.'),
      run: () => navigate(-1),
    },
    'workspace.navigateForward': {
      disabledReason: () =>
        networkDisabledReason() ?? (navigation.canGoForward ? null : 'No later location.'),
      run: () => navigate(1),
    },
    'workspace.showShortcutHelp': { disabledReason, run: ({ origin }) => show('help', origin) },
    'workspace.reconnect': { run: () => session.refresh() },
    'workspace.quit': { run: host.quit },
    'workspace.dismiss': { run: dismiss },
    'workspace.focusNextPane': {
      run: () => {
        if (currentOverlay.current || editing) return false
        const target = commands.focus.getSnapshot().current
        const invocation = commands.bus.capture('programmatic')
        if (
          target?.widgetId === 'agent-composer' &&
          invocation.inspect('chat.completePrompt').status === 'ready'
        )
          return invocation.dispatch('chat.completePrompt').claimed
        return commands.focus.cycle(1)
      },
    },
    'workspace.focusPreviousPane': {
      run: () => !currentOverlay.current && !editing && commands.focus.cycle(-1),
    },
    ...(host.suspend ? { 'workspace.suspend': { run: host.suspend } } : {}),
  })
  return (
    <AgentNavigationContext
      value={{ openFile: openAgentFile, queuePrompt: queueAgentPrompt, openWorkbench }}
    >
      <box flexGrow={1} minHeight={0} flexDirection='column' overflow='hidden'>
        {location.kind === 'agent' && (
          <AgentScreen
            session={session}
            ready={state}
            theme={theme}
            location={location}
            enabled={!editing}
            onNavigate={visitAgent}
            onOpenWorkbench={openWorkbench}
          />
        )}
        {location.kind === 'workbench' && (
          <Workbench
            key={location.rootPath}
            session={session}
            state={state}
            location={location}
            theme={theme}
            enabled={!editing}
            onNavigate={visitWorkbench}
          />
        )}
        {location.kind === 'settings' && (
          <box flexDirection='column' flexGrow={1} minHeight={0}>
            <text fg={theme.primary} paddingX={2} height={1} flexShrink={0}>
              Settings
            </text>
            <SettingsBrowser
              owner={state.owner}
              theme={theme}
              enabled={!overlay}
              writable={live}
              initialQuery={settingsQuery}
              onQueryChange={updateSearch}
              onDialogChange={changeSettingsDialog}
            />
          </box>
        )}
        {commands.pending && (
          <text fg={theme.info}>
            {commands.pending.commands
              .map(
                (binding) =>
                  `${binding.keys} ${commandById(binding.command)?.title ?? binding.command}`,
              )
              .join(' · ')}
          </text>
        )}
        {overlay?.kind === 'commands' && (
          <CommandPalette
            chat={state.chat}
            onSession={(sessionId) => {
              const projection = state.chat.getSnapshot().projection
              const conversation = projection.sessionById[sessionId]
              const projectId = conversation
                ? (projection.worktreeById[conversation.worktreeId]?.projectId ?? null)
                : null
              visitAgent({ kind: 'agent', projectId, sessionId })
            }}
            key={overlay.query}
            origin={overlay.origin}
            storage={state.storage}
            owner={state.owner}
            writable={live}
            initialQuery={overlay.query}
            theme={theme}
            onClose={dismiss}
            onFiles={openFilesFromPalette}
            onRun={(id) => {
              pendingCommand.current = { id, origin: overlay.origin }
              dismiss()
            }}
          />
        )}
        {live && location.kind === 'files' && (
          <FileView
            session={session}
            storage={state.storage}
            owner={state.owner}
            theme={theme}
            enabled={live && !overlay}
            onBack={() => navigate(-1)}
            initialPath={location.path}
            initialQuery={location.query}
            onQueryChange={updateFileQuery}
            places={chat.projection.projectIds.flatMap((id) => {
              const project = chat.projection.projectById[id]
              const worktree = currentWorktree(chat.projection, id)
              return worktree ? [{ name: project.title, path: worktree.path }] : []
            })}
            onLocationChange={recordLocation}
            onOpenWorkbench={openWorkbench}
            onOpenFile={location.workbenchRoot === undefined ? undefined : openBrowserFile}
          />
        )}
        {((live && overlay?.kind === 'address') || overlay?.kind === 'copy-address') && (
          <AddressDialog
            key={overlay.kind}
            session={session}
            state={state}
            theme={theme}
            location={location}
            onClose={dismiss}
            copy={overlay.kind === 'copy-address'}
            onSettings={openSettings}
            onWorkbench={visitWorkbench}
            onAgent={visitAgent}
          />
        )}
        {overlay?.kind === 'help' && <ShortcutHelp theme={theme} onClose={dismiss} />}
        {fileFailure && (
          <Toast
            message={fileFailure}
            tone='error'
            theme={theme}
            onDismiss={() => setFileFailure(null)}
          />
        )}
      </box>
    </AgentNavigationContext>
  )
}
