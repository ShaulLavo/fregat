import { compareSessionsByActivity } from '@workspace/client-core/chat/rail/session-order'
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useTerminalDimensions } from '@opentui/react'
import {
  scopedSessionKey,
  type ProjectId,
  type SessionId,
  type WorktreeId,
} from '@workspace/contracts'
import {
  selectChatProjects,
  selectChatSessions,
  selectChatWorktrees,
} from '@workspace/client-core/chat/selectors'
import { sessionRailModel, type SessionRailItem } from '@workspace/client-core/chat/rail/model'
import { railReorderIntent, planRailReorder } from '@workspace/client-core/chat/rail/reorder'
import {
  createProjectMetaCommand,
  createProjectDeleteCommand,
  createProjectReorderCommand,
  createSessionRenameCommand,
  createSessionArchiveCommand,
  createSessionUnarchiveCommand,
  createSessionDeleteCommand,
  createSessionReorderCommand,
  createSessionActiveReorderCommand,
  createSessionRuntimeStopCommand,
} from '@workspace/client-core/chat/commands'
import { createAgentRailState } from '@/agent-rail/state/rail'
import { railRows, type RailRow } from '@/agent-rail/utils/rows'
import { railKeyTarget } from '@/agent-rail/utils/command-target'
import { RailPrompt } from '@/agent-rail/components/prompt'
import { RailMenu } from '@/agent-rail/components/menu'
import { currentWorktree } from '@/agent/utils/selection'
import { draftsForStorage, draftKey } from '@/agent-stage/state/drafts'
import { WorktreeManager } from '@/worktrees/components/manager'
import { useSettingValue } from '@/settings/hooks/use-setting-value'
import { useCommands } from '@/commands/hooks/use-commands'
import type { CommandContext } from '@/commands/state/bus'
import type { FocusToken } from '@/commands/state/focus'
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
  | { kind: 'add'; origin: FocusToken | null }
  | { kind: 'menu' | 'rename'; row: RailRow }
  | { kind: 'delete-project'; row: Extract<RailRow, { kind: 'project' }> }
  | { kind: 'delete-sessions'; sessions: readonly SessionRailItem[] }
  | { kind: 'worktrees'; projectId: ProjectId; origin: FocusToken | null }

export function AgentRail({
  session,
  ready,
  projectId,
  sessionId,
  worktreeId,
  theme,
  enabled,
  focusable,
  onSelectProject,
  onSelectSession,
  onSelectWorktree,
  onOpenWorkbench,
}: {
  readonly session: SettingsSession
  readonly ready: Extract<SessionState, { kind: 'ready' }>
  readonly projectId: ProjectId | null
  readonly sessionId: SessionId | null
  readonly worktreeId: WorktreeId | null
  readonly theme: Theme
  readonly enabled: boolean
  readonly focusable: boolean
  readonly onSelectProject: (id: ProjectId | null) => void
  readonly onSelectSession: (id: SessionId) => void
  readonly onSelectWorktree: (id: WorktreeId) => void
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
  const currentSession = useRef(sessionId)
  useLayoutEffect(() => {
    currentSession.current = sessionId
  }, [sessionId])
  const [filtering, setFiltering] = useState(false)
  const [modal, setModal] = useState<Modal>({ kind: 'closed' })
  const projection = chat.projection
  const managedProject = modal.kind === 'worktrees' ? projection.projectById[modal.projectId] : null
  const paneEnabled = enabled && focusable
  useLayoutEffect(() => {
    if (modal.kind !== 'worktrees' || managedProject || chat.status !== 'ready') return
    setModal({ kind: 'closed' })
    commands.focus.request({ kind: 'match', matches: (target) => target.widgetId === 'agent-rail' })
  }, [modal, managedProject, chat.status, commands.focus])
  const groupingMode = useSettingValue(ready.owner, 'chat.projectGrouping')
  const sessionSortOrder = useSettingValue(ready.owner, 'chat.sessionSortOrder')
  const confirmSessionDelete = useSettingValue(ready.owner, 'chat.confirmSessionDelete')
  const groupingOverrides = useSettingValue(ready.owner, 'chat.projectGroupingOverrides')
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
        capabilities: ready.descriptor.capabilities,
      },
    ],
    activeProjectRef: projectId
      ? { environmentId: ready.descriptor.environmentId, projectId }
      : null,
    activeSessionKey: sessionId
      ? scopedSessionKey({ environmentId: ready.descriptor.environmentId, sessionId })
      : null,
    collapsedProjectIds: state.collapsed,
    query: state.query,
    scope: state.scope,
    searchMatches: state.search,
    seenBySessionKey: state.seen,
    view: state.view,
    grouping: { mode: groupingMode, overrides: groupingOverrides },
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
    enabled: paneEnabled && !filtering && modal.kind === 'closed',
  })
  const filterFocused = usePaneFocus({
    id: 'agent-rail-filter',
    area: 'chat',
    textEntry: true,
    enabled: paneEnabled && filtering && modal.kind === 'closed',
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
    if (modal.kind === 'worktrees' || modal.kind === 'add') {
      commands.focus.restore(modal.origin)
      return
    }
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
    if (row?.kind === 'project') return row.project
    const id = row?.session.projectId ?? projectId
    return (
      model.projects.find((group) => group.members.some((member) => member.ref.projectId === id)) ??
      null
    )
  }
  function newSession(context: CommandContext) {
    const fromRail = context.target?.widgetId.startsWith('agent-rail') === true
    startSession(fromRail ? rows[latestSelection.current]?.value : undefined)
  }
  function checkout(row?: RailRow) {
    if (row?.kind === 'session') return row.session.worktree
    if (row?.kind === 'project') return currentWorktree(projection, row.project.id)
    if (worktreeId) return projection.worktreeById[worktreeId] ?? null
    return currentWorktree(projection, projectId)
  }
  function startSession(row?: RailRow, isolated = false) {
    const worktree = checkout(row)
    if (!worktree) {
      setModal({ kind: 'add', origin: commands.focus.capture() })
      return
    }
    const project = projection.projectById[worktree.projectId]
    if (isolated && (project?.repositoryKind !== 'git' || worktree.lifecycle.state !== 'ready')) {
      store.setError('A new worktree requires a ready Git checkout.')
      return
    }
    const target = { kind: 'draft', worktreeId: worktree.id } as const
    draftsForStorage(ready.storage).update(draftKey(target), {
      worktreeMode: isolated ? 'new' : 'current',
    })
    setModal({ kind: 'closed' })
    onSelectWorktree(worktree.id)
    commands.focus.request({
      kind: 'match',
      matches: (target) => target.widgetId === 'agent-composer',
    })
  }
  function manageWorktrees(row?: RailRow, origin = commands.focus.capture()) {
    const worktree = checkout(row)
    const id = row?.kind === 'project' ? row.project.id : (worktree?.projectId ?? projectId)
    if (id) setModal({ kind: 'worktrees', projectId: id, origin })
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
      return model.sessions.filter((item) =>
        row.project.sessionRefs.some((ref) => ref.sessionId === item.id),
      )
    return []
  }
  async function archive(row = current) {
    const items = targets(row)
    const unarchive = items.length > 0 && items.every((item) => item.archived)
    let failures = 0
    let completed = 0
    for (const item of items) {
      if (item.archived !== unarchive) continue
      const session = ready.chat.getSnapshot().projection.sessionById[item.id]
      const running =
        session?.latestTurn?.state === 'running' ||
        (session?.runtime?.activeTurnId != null &&
          ['running', 'waiting'].includes(session.runtime.status))
      if (running && !unarchive) {
        failures++
        continue
      }
      const command = unarchive
        ? createSessionUnarchiveCommand({ sessionId: item.id })
        : createSessionArchiveCommand({ sessionId: item.id })
      if (!(await store.execute([command], true))) {
        failures++
        continue
      }
      completed++
      if (!unarchive && currentSession.current === item.id) onSelectWorktree(item.worktree.id)
    }
    close()
    if (failures)
      store.setError(
        `${completed} ${unarchive ? 'restored' : 'archived'}, ${failures} skipped or failed.`,
      )
  }
  function remove(row = current) {
    if (row?.kind === 'project' && !state.marked.length) {
      setModal({ kind: 'delete-project', row })
      return
    }
    const items = targets(row)
    if (!items.length) return
    if (confirmSessionDelete) {
      setModal({ kind: 'delete-sessions', sessions: items })
      return
    }
    void deleteSessions(items)
  }
  async function reorder(amount: number) {
    if (!current) return
    if (current.kind === 'project') {
      if (current.project.members.length !== 1) return
      const items = model.projects.filter((project) => project.members.length === 1)
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
    if (!selected.canReorder) return
    const items = model.sessions.filter(
      (item) =>
        item.projectGroupKey === selected.projectGroupKey && item.placement === selected.placement,
    )
    const index = items.findIndex((item) => item.key === selected.key)
    const destination = index + amount
    if (destination < 0 || destination >= items.length) return
    const orderedIds = items.map((item) => item.key)
    orderedIds.splice(index, 1)
    orderedIds.splice(destination, 0, selected.key)
    const keysById = new Map(
      Object.values(projection.sessionById)
        .filter((session) => !session.archivedAt)
        .map(
          (session) =>
            [
              scopedSessionKey({
                environmentId: ready.descriptor.environmentId,
                sessionId: session.id,
              }),
              selected.placement === 'pinned' ? session.pinOrderKey : session.activeOrderKey,
            ] as const,
        ),
    )
    const assignments = planRailReorder({ orderedIds, keysById, movedId: selected.key })
    const targets = new Map(items.map((item) => [item.key, item]))
    if (assignments.some((assignment) => !targets.get(assignment.id)?.canReorder)) return
    await store.execute(
      assignments.map((assignment) => {
        const sessionId = targets.get(assignment.id)!.id
        const command =
          selected.placement === 'pinned'
            ? createSessionReorderCommand
            : createSessionActiveReorderCommand
        return command({ sessionId, orderKey: assignment.orderKey })
      }),
    )
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
      'workspace.newIsolatedSession': {
        run: (context) =>
          startSession(
            context.target?.widgetId.startsWith('agent-rail')
              ? rows[latestSelection.current]?.value
              : undefined,
            true,
          ),
      },
      'chat.manageWorktrees': {
        run: (context) =>
          manageWorktrees(
            context.target?.widgetId.startsWith('agent-rail')
              ? rows[latestSelection.current]?.value
              : undefined,
            context.target?.token ?? null,
          ),
      },
      'agent.addProject': {
        run: (context) => setModal({ kind: 'add', origin: context.target?.token ?? null }),
      },
    },
    enabled && modal.kind === 'closed' && !state.busy,
  )
  useCommandHandlers(
    {
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
      'agent.rename': {
        run: () => {
          if (current) setModal({ kind: 'rename', row: current })
        },
      },
      'agent.archive': { run: () => archive() },
      'agent.delete': { run: () => remove() },
      'agent.toggleArchived': { run: store.toggleArchived },
      'agent.scopeProject': { run: () => store.setScope(rowProject()?.groupKey ?? null) },
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
          if (id) store.toggleCollapsed(id.members.map((member) => member.physicalKey))
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
    paneEnabled && modal.kind === 'closed' && !state.busy,
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
      const commands =
        row.kind === 'project'
          ? row.project.members.map((member) =>
              createProjectMetaCommand({ projectId: member.ref.projectId, title: text }),
            )
          : [createSessionRenameCommand({ sessionId: row.session.id, title: text })]
      if (await store.execute(commands)) close()
      return
    }
    if (modal.kind === 'delete-project') {
      if (
        await store.execute(
          modal.row.project.members.map((member) =>
            createProjectDeleteCommand({ projectId: member.ref.projectId }),
          ),
        )
      ) {
        close()
        if (modal.row.project.members.some((member) => member.ref.projectId === projectId))
          onSelectProject(null)
      }
      return
    }
    if (modal.kind !== 'delete-sessions') return
    await deleteSessions(modal.sessions)
  }
  async function deleteSessions(items: readonly SessionRailItem[]) {
    let failures = 0
    let deleted = 0
    for (const item of items) {
      const accepted = await store.execute(
        [createSessionDeleteCommand({ sessionId: item.id })],
        true,
      )
      if (!accepted) {
        failures++
        continue
      }
      deleted++
      if (currentSession.current !== item.id) continue
      const snapshot = ready.chat.getSnapshot().projection
      const survivor = Object.values(snapshot.sessionById)
        .filter(
          (candidate) =>
            candidate.id !== item.id &&
            !candidate.archivedAt &&
            snapshot.worktreeById[candidate.worktreeId]?.projectId === item.projectId,
        )
        .toSorted((left, right) => compareSessionsByActivity(left, right, sessionSortOrder))[0]
      if (survivor) onSelectSession(survivor.id)
      else onSelectWorktree(item.worktree.id)
    }
    close()
    if (failures)
      store.setError(`${deleted} deleted, ${failures} failed. Failed sessions remain selected.`)
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
    description = `Delete ${modal.row.project.title} and all ${modal.row.project.sessionRefs.length} sessions.`
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
      {modal.kind === 'worktrees' && managedProject && (
        <WorktreeManager
          key={managedProject.id}
          session={session}
          chat={ready.chat}
          project={managedProject}
          currentWorktreeId={worktreeId}
          theme={theme}
          onClose={close}
          onSelectWorktree={(id) => {
            draftsForStorage(ready.storage).update(draftKey({ kind: 'draft', worktreeId: id }), {
              worktreeMode: 'current',
            })
            setModal({ kind: 'closed' })
            onSelectWorktree(id)
            commands.focus.request({
              kind: 'match',
              matches: (target) => target.widgetId === 'agent-composer',
            })
          }}
          onOpenWorkbench={onOpenWorkbench}
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
              run: () => startSession(menuRow),
            },
            { label: 'New session in a new worktree', run: () => startSession(menuRow, true) },
            { label: 'Manage worktrees', run: () => manageWorktrees(menuRow) },
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
                store.setScope(rowProject(menuRow)?.groupKey ?? null)
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
                if (id) store.toggleCollapsed(id.members.map((member) => member.physicalKey))
                close()
              },
            },
          ]}
        />
      )}
    </box>
  )
}
