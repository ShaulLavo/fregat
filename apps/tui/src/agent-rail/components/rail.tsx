import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useTerminalDimensions } from '@opentui/react'
import { scopedSessionKey, type ProjectId, type SessionId } from '@workspace/contracts'
import {
  selectChatProjects,
  selectChatSessions,
  selectChatWorktrees,
} from '@workspace/client-core/chat/selectors'
import { sessionRailModel, type SessionRailItem } from '@workspace/client-core/chat/rail/model'
import { railReorderIntent } from '@workspace/client-core/chat/rail/reorder'
import {
  createProjectMetaCommand,
  createProjectDeleteCommand,
  createProjectReorderCommand,
  createSessionRenameCommand,
  createSessionArchiveCommand,
  createSessionUnarchiveCommand,
  createSessionDeleteCommand,
  createSessionPlaceCommand,
  createSessionReorderCommand,
  createSessionRuntimeStopCommand,
} from '@workspace/client-core/chat/commands'
import { createAgentRailState } from '@/agent-rail/state/rail'
import { railRows, type RailRow } from '@/agent-rail/utils/rows'
import { railKeyTarget } from '@/agent-rail/utils/command-target'
import { RailPrompt } from '@/agent-rail/components/prompt'
import { RailMenu } from '@/agent-rail/components/menu'
import { useCommands } from '@/commands/hooks/use-commands'
import type { CommandContext } from '@/commands/state/bus'
import { usePaneFocus } from '@/commands/hooks/use-pane-focus'
import { useCommandHandlers } from '@/commands/hooks/use-command-handlers'
import { Prompt } from '@/components/prompt'
import { Select } from '@/components/select'
import { LoadingState } from '@/components/loading-state'
import { EmptyState } from '@/components/empty-state'
import { connectionFailure } from '@/connection/utils/failure'
import type { SettingsSession, SessionState } from '@/connection/state/session'
import type { Theme } from '@/theme/utils/theme'

type Modal =
  | { kind: 'closed' }
  | { kind: 'add' }
  | { kind: 'menu' | 'rename'; row: RailRow }
  | { kind: 'delete-project'; row: Extract<RailRow, { kind: 'project' }> }
  | { kind: 'delete-sessions'; sessions: readonly SessionRailItem[] }

export function AgentRail({
  session,
  ready,
  projectId,
  sessionId,
  theme,
  enabled,
  onSelectProject,
  onSelectSession,
  onOpenWorkbench,
}: {
  readonly session: SettingsSession
  readonly ready: Extract<SessionState, { kind: 'ready' }>
  readonly projectId: ProjectId | null
  readonly sessionId: SessionId | null
  readonly theme: Theme
  readonly enabled: boolean
  readonly onSelectProject: (id: ProjectId | null) => void
  readonly onSelectSession: (id: SessionId) => void
  readonly onOpenWorkbench: (path: string) => void | Promise<void>
}) {
  const commands = useCommands()
  const { height } = useTerminalDimensions()
  const compact = height < 20
  const [store] = useState(() => createAgentRailState(session, ready))
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const chat = useSyncExternalStore(ready.chat.subscribe, ready.chat.getSnapshot)
  const [selection, updateSelection] = useState<{ index: number; key: string | null }>({
    index: 0,
    key: null,
  })
  const latestSelection = useRef(0)
  const [filtering, setFiltering] = useState(false)
  const [modal, setModal] = useState<Modal>({ kind: 'closed' })
  const projection = chat.projection
  const sessions = selectChatSessions(projection)
  const model = sessionRailModel({
    environments: [
      {
        environmentId: ready.descriptor.environmentId,
        label: null,
        isPrimary: true,
        phase: ready.connection.kind === 'live' ? 'live' : 'offline',
        projects: selectChatProjects(projection),
        worktrees: selectChatWorktrees(projection),
        sessions,
      },
    ],
    activeProjectId: projectId,
    activeSessionKey: sessionId
      ? scopedSessionKey({ environmentId: ready.descriptor.environmentId, sessionId })
      : null,
    collapsedProjectIds: state.collapsed,
    query: state.query,
    scope: state.scope,
    searchMatches: state.search,
    seenBySessionKey: state.seen,
    view: state.view,
  })
  const rows = railRows(model, state.marked, state.scope, state.query, state.search)
  const keyedIndex = rows.findIndex((row) => row.key === selection.key)
  const selected =
    keyedIndex >= 0 ? keyedIndex : Math.min(selection.index, Math.max(0, rows.length - 1))
  useLayoutEffect(() => {
    latestSelection.current = selected
  }, [selected])
  const current = rows[selected]?.value
  const visibleSessions = rows.flatMap((row) =>
    row.value.kind === 'session' ? [row.value.session] : [],
  )
  const focused = usePaneFocus({
    id: 'agent-rail',
    area: 'chat',
    enabled: enabled && !filtering && modal.kind === 'closed',
  })
  const filterFocused = usePaneFocus({
    id: 'agent-rail-filter',
    area: 'chat',
    textEntry: true,
    enabled: enabled && filtering && modal.kind === 'closed',
  })
  useEffect(() => () => store.dispose(), [store])
  const completedAt = sessionId
    ? (projection.sessionById[sessionId]?.latestTurn?.completedAt ?? null)
    : null
  useEffect(() => {
    if (sessionId) store.markSeen(sessionId, completedAt)
  }, [store, sessionId, completedAt])

  function setSelection(index: number) {
    latestSelection.current = index
    updateSelection({ index, key: rows[index]?.key ?? null })
  }
  function restoreFocus() {
    commands.focus.request({ kind: 'match', matches: (target) => target.widgetId === 'agent-rail' })
  }
  function close() {
    setModal({ kind: 'closed' })
    restoreFocus()
  }
  function open(index = latestSelection.current) {
    const row = rows[index]?.value
    if (row?.kind === 'project') onSelectProject(row.project.id)
    if (row?.kind === 'session') onSelectSession(row.session.id)
  }
  function move(amount: number) {
    setSelection(Math.max(0, Math.min(rows.length - 1, latestSelection.current + amount)))
  }
  function rowProject(row = current) {
    return row?.kind === 'project' ? row.project.id : (row?.session.projectId ?? projectId)
  }
  function newSession(context: CommandContext) {
    const fromRail = context.target?.widgetId.startsWith('agent-rail') === true
    const id = fromRail ? rowProject(rows[latestSelection.current]?.value) : projectId
    if (id) onSelectProject(id)
    else setModal({ kind: 'add' })
  }
  function mark(range = false) {
    if (current?.kind !== 'session') return
    if (range) {
      store.markRange(
        visibleSessions.map((item) => item.id),
        current.session.id,
      )
      return
    }
    store.mark(current.session.id)
  }
  function targets(row = current) {
    if (state.marked.length) return model.sessions.filter((item) => state.marked.includes(item.id))
    if (row?.kind === 'session') return [row.session]
    if (row?.kind === 'project')
      return model.sessions.filter((item) => item.projectId === row.project.id)
    return []
  }
  async function archive(row = current) {
    const items = targets(row)
    const unarchive = items.length > 0 && items.every((item) => item.archived)
    const running = items.find((item) => {
      const session = projection.sessionById[item.id]
      return (
        session?.latestTurn?.state === 'running' ||
        (session?.runtime?.activeTurnId != null &&
          ['running', 'waiting'].includes(session.runtime.status))
      )
    })
    if (running && !unarchive) {
      store.setError(`Stop ${running.title} before archiving it.`)
      close()
      return
    }
    const accepted = await store.execute(
      items
        .filter((item) => item.archived === unarchive)
        .map((item) =>
          unarchive
            ? createSessionUnarchiveCommand({ sessionId: item.id })
            : createSessionArchiveCommand({ sessionId: item.id }),
        ),
      true,
    )
    if (accepted) {
      store.clearMarks()
      close()
    }
  }
  function remove(row = current) {
    if (row?.kind === 'project' && !state.marked.length) {
      setModal({ kind: 'delete-project', row })
      return
    }
    const items = targets(row)
    if (items.length) setModal({ kind: 'delete-sessions', sessions: items })
  }
  async function reorder(amount: number) {
    if (!current) return
    if (current.kind === 'project') {
      const items = model.projects
      const index = items.findIndex((item) => item.id === current.project.id)
      const intent = railReorderIntent({
        activeId: current.project.id,
        overId: items[index + amount]?.id ?? null,
        rows: items.map((item) => ({ id: item.id, orderKey: item.orderKey })),
      })
      if (intent)
        await store.execute([
          createProjectReorderCommand({ projectId: current.project.id, orderKey: intent.orderKey }),
        ])
      return
    }
    const selected = current.session
    if (selected.archived) return
    const items = model.sessions.filter(
      (item) =>
        item.projectId === selected.projectId && item.status === selected.status && !item.archived,
    )
    const index = items.findIndex((item) => item.id === selected.id)
    const intent = railReorderIntent({
      activeId: selected.id,
      overId: items[index + amount]?.id ?? null,
      rows: items.map((item) => ({ id: item.id, orderKey: item.pinOrderKey })),
    })
    if (!intent) return
    const command = selected.pinOrderKey
      ? createSessionReorderCommand({ sessionId: selected.id, orderKey: intent.orderKey })
      : createSessionPlaceCommand({ sessionId: selected.id, orderKey: intent.orderKey })
    await store.execute([command])
  }
  async function workbench(row = current) {
    if (!row) return
    try {
      await onOpenWorkbench(
        row.kind === 'project' ? row.project.workspaceRoot : row.session.worktreePath,
      )
      setModal({ kind: 'closed' })
    } catch (error) {
      store.setError(connectionFailure(error).message)
    }
  }
  function adjacent(amount: number) {
    if (!visibleSessions.length) return
    const selectedIndex = visibleSessions.findIndex((item) => item.id === sessionId)
    const index = selectedIndex < 0 && amount < 0 ? 0 : selectedIndex
    const next = visibleSessions[(index + amount + visibleSessions.length) % visibleSessions.length]
    if (next) onSelectSession(next.id)
  }
  useCommandHandlers(
    {
      'workspace.newSession': { run: newSession },
      'workspace.nextSession': { run: () => adjacent(1) },
      'workspace.previousSession': { run: () => adjacent(-1) },
      'workspace.jumpToSession1': {
        run: () => {
          if (visibleSessions[0]) onSelectSession(visibleSessions[0].id)
        },
      },
      'workspace.jumpToSession2': {
        run: () => {
          if (visibleSessions[1]) onSelectSession(visibleSessions[1].id)
        },
      },
      'workspace.jumpToSession3': {
        run: () => {
          if (visibleSessions[2]) onSelectSession(visibleSessions[2].id)
        },
      },
      'workspace.jumpToSession4': {
        run: () => {
          if (visibleSessions[3]) onSelectSession(visibleSessions[3].id)
        },
      },
      'workspace.jumpToSession5': {
        run: () => {
          if (visibleSessions[4]) onSelectSession(visibleSessions[4].id)
        },
      },
      'workspace.jumpToSession6': {
        run: () => {
          if (visibleSessions[5]) onSelectSession(visibleSessions[5].id)
        },
      },
      'workspace.jumpToSession7': {
        run: () => {
          if (visibleSessions[6]) onSelectSession(visibleSessions[6].id)
        },
      },
      'workspace.jumpToSession8': {
        run: () => {
          if (visibleSessions[7]) onSelectSession(visibleSessions[7].id)
        },
      },
      'workspace.jumpToSession9': {
        run: () => {
          if (visibleSessions[8]) onSelectSession(visibleSessions[8].id)
        },
      },
      'agent.railNext': { disabledReason: railKeyTarget, run: () => move(1) },
      'agent.railPrevious': { disabledReason: railKeyTarget, run: () => move(-1) },
      'agent.railOpen': { run: () => open() },
      'agent.railFilter': {
        disabledReason: railKeyTarget,
        run: () => {
          setFiltering(true)
          commands.focus.request({
            kind: 'match',
            matches: (target) => target.widgetId === 'agent-rail-filter',
          })
        },
      },
      'agent.railMenu': {
        disabledReason: railKeyTarget,
        run: () => {
          if (current) setModal({ kind: 'menu', row: current })
        },
      },
      'agent.addProject': { run: () => setModal({ kind: 'add' }) },
      'agent.rename': {
        run: () => {
          if (current) setModal({ kind: 'rename', row: current })
        },
      },
      'agent.archive': { run: () => archive() },
      'agent.delete': { run: () => remove() },
      'agent.toggleArchived': { run: store.toggleArchived },
      'agent.scopeProject': { run: () => store.setScope(rowProject()) },
      'agent.clearScope': { run: () => store.setScope(null) },
      'agent.mark': { disabledReason: railKeyTarget, run: () => mark() },
      'agent.markRange': { disabledReason: railKeyTarget, run: () => mark(true) },
      'agent.selectAll': { run: () => store.markAll(visibleSessions.map((item) => item.id)) },
      'agent.clearMarks': { run: store.clearMarks },
      'agent.moveUp': { run: () => reorder(-1) },
      'agent.moveDown': { run: () => reorder(1) },
      'agent.collapseProject': {
        run: () => {
          const id = rowProject()
          if (id) store.toggleCollapsed(id)
        },
      },
      'agent.openWorkbench': { run: () => workbench() },
      'agent.stopSession': {
        run: () =>
          store.execute(
            targets().map((item) => createSessionRuntimeStopCommand({ sessionId: item.id })),
          ),
      },
    },
    enabled && modal.kind === 'closed' && !state.busy,
  )

  async function submit(text: string) {
    if (modal.kind === 'add') {
      const result = await store.addProject(text)
      if (result) {
        setModal({ kind: 'closed' })
        onSelectProject(result.projectId)
      }
      return
    }
    if (modal.kind === 'rename') {
      const row = modal.row
      const command =
        row.kind === 'project'
          ? createProjectMetaCommand({ projectId: row.project.id, title: text })
          : createSessionRenameCommand({ sessionId: row.session.id, title: text })
      if (await store.execute([command])) close()
      return
    }
    if (modal.kind === 'delete-project') {
      if (await store.execute([createProjectDeleteCommand({ projectId: modal.row.project.id })])) {
        close()
        if (modal.row.project.id === projectId) onSelectProject(null)
      }
      return
    }
    if (modal.kind !== 'delete-sessions') return
    if (
      await store.execute(
        modal.sessions
          .filter((item) => projection.sessionById[item.id])
          .map((item) => createSessionDeleteCommand({ sessionId: item.id })),
        true,
      )
    ) {
      store.clearMarks()
      if (modal.sessions.some((item) => item.id === sessionId)) onSelectProject(projectId)
      close()
    }
  }
  const prompt =
    modal.kind === 'add' ||
    modal.kind === 'rename' ||
    modal.kind === 'delete-project' ||
    modal.kind === 'delete-sessions'
  let title = 'Add project'
  let description = 'Enter an existing project folder on the server.'
  let initial = ''
  let confirmation: string | undefined
  if (modal.kind === 'rename') {
    title = 'Rename'
    initial = modal.row.kind === 'project' ? modal.row.project.title : modal.row.session.title
    description = 'Enter a new title.'
  }
  if (modal.kind === 'delete-project') {
    title = 'Delete project'
    description = `Delete ${modal.row.project.title} and all ${sessions.filter((item) => item.project.id === modal.row.project.id).length} sessions.`
    confirmation = 'delete'
  }
  if (modal.kind === 'delete-sessions') {
    title = 'Delete sessions'
    description = `Permanently delete ${modal.sessions.length} sessions.`
    confirmation = 'delete'
  }
  const menuRow = modal.kind === 'menu' ? modal.row : null
  return (
    <box
      flexDirection='column'
      flexGrow={1}
      minHeight={0}
      width='100%'
      paddingLeft={1}
      paddingRight={1}
      paddingTop={compact ? 0 : 1}
      paddingBottom={compact ? 0 : 1}
      backgroundColor={theme.card}
    >
      <box flexDirection='column' marginBottom={compact ? 0 : 1} flexShrink={0}>
        <box flexDirection='row' justifyContent='space-between' height={1}>
          <text fg={theme.foreground}>
            <strong>Sessions</strong>
          </text>
          <text fg={theme.mutedForeground}>{state.view}</text>
        </box>
        <text fg={theme.mutedForeground} wrapMode='none' height={1}>
          {model.scopeTitle}
        </text>
      </box>
      {filtering && (
        <Prompt
          id='agent-rail-filter'
          value={state.query}
          onChange={(query) => {
            store.setQuery(query)
            setSelection(0)
          }}
          onSubmit={() => {
            setFiltering(false)
            restoreFocus()
          }}
          focused={filterFocused}
          theme={theme}
          placeholder='Search sessions…'
        />
      )}
      {state.query && !filtering && (
        <text fg={theme.mutedForeground} wrapMode='none' height={1}>
          Filter: {state.query}
        </text>
      )}
      {chat.status === 'loading' && !rows.length && (
        <LoadingState theme={theme} label='Reading sessions…' />
      )}
      {chat.status === 'ready' && !state.searching && !state.error && !rows.length && (
        <EmptyState
          theme={theme}
          title='No sessions here'
          description='Add a project or change the filter.'
        />
      )}
      <Select
        id='agent-rail'
        options={rows}
        selectedIndex={selected}
        onChange={setSelection}
        onSelect={open}
        focused={focused}
        navigateFromInput={filterFocused}
        flexGrow={1}
        minHeight={0}
        backgroundColor={theme.card}
        textColor={theme.foreground}
        descriptionColor={theme.mutedForeground}
        selectedTextColor={theme.foreground}
        selectedDescriptionColor={theme.mutedForeground}
        selectedBackgroundColor={theme.accent}
      />
      {state.searching && <LoadingState theme={theme} label='Searching transcripts…' />}
      {state.busy && <LoadingState theme={theme} label='Updating sessions…' />}
      {state.marked.length > 0 && <text fg={theme.info}>{state.marked.length} marked</text>}
      {(state.error || chat.error) && (
        <text fg={theme.destructive}>{state.error || chat.error}</text>
      )}
      {prompt && (
        <RailPrompt
          key={modal.kind}
          title={title}
          description={description}
          initial={initial}
          confirm={confirmation}
          busy={state.busy}
          error={state.error}
          theme={theme}
          onSubmit={submit}
          onClose={close}
        />
      )}
      {menuRow && (
        <RailMenu
          title={menuRow.kind === 'project' ? menuRow.project.title : menuRow.session.title}
          theme={theme}
          onClose={close}
          actions={[
            {
              label: 'New session',
              run: () => {
                setModal({ kind: 'closed' })
                onSelectProject(rowProject(menuRow))
              },
            },
            { label: 'Rename', run: () => setModal({ kind: 'rename', row: menuRow }) },
            {
              label: 'Archive / unarchive',
              run: () => {
                void archive(menuRow)
              },
            },
            { label: 'Delete', run: () => remove(menuRow) },
            {
              label: 'Show this project',
              run: () => {
                store.setScope(rowProject(menuRow))
                close()
              },
            },
            {
              label: 'Open workbench',
              run: () => {
                void workbench(menuRow)
              },
            },
            {
              label: 'Collapse / expand project',
              run: () => {
                const id = rowProject(menuRow)
                if (id) store.toggleCollapsed(id)
                close()
              },
            },
          ]}
        />
      )}
    </box>
  )
}
