import { useState, useSyncExternalStore } from 'react'
import { useTerminalDimensions } from '@opentui/react'
import type { SessionId } from '@workspace/contracts'
import { AgentRail } from '@/agent-rail/components/rail'
import { AgentStage } from '@/agent-stage/components/stage'
import { EmptyState } from '@/components/empty-state'
import { LoadingState } from '@/components/loading-state'
import { Toast } from '@/components/toast'
import { useCommands } from '@/commands/hooks/use-commands'
import { useCommandHandlers } from '@/commands/hooks/use-command-handlers'
import type { FocusTarget } from '@/commands/state/focus'
import { stageTarget, selectedProject } from '@/agent/utils/selection'
import type { AgentLocation, StageTarget } from '@/agent/utils/target'
import type { SessionState, SettingsSession } from '@/connection/state/session'
import type { Theme } from '@/theme/utils/theme'

export function AgentScreen({
  session,
  ready,
  theme,
  location,
  enabled,
  onNavigate,
  onOpenWorkbench,
}: {
  readonly session: SettingsSession
  readonly ready: Extract<SessionState, { kind: 'ready' }>
  readonly theme: Theme
  readonly location: AgentLocation
  readonly enabled: boolean
  readonly onNavigate: (location: AgentLocation) => void
  readonly onOpenWorkbench: (path: string) => void | Promise<void>
}) {
  const { width, height } = useTerminalDimensions()
  const commands = useCommands()
  const snapshot = useSyncExternalStore(ready.chat.subscribe, ready.chat.getSnapshot)
  const focus = useSyncExternalStore(commands.focus.subscribe, commands.focus.getSnapshot)
  const [railVisible, setRailVisible] = useState(true)
  const [terminal, setTerminal] = useState<{
    location: AgentLocation
    target: Extract<StageTarget, { kind: 'terminal' }>
  } | null>(null)
  const projectId = selectedProject(snapshot.projection, location)
  const sameTerminalLocation =
    terminal?.location.sessionId === location.sessionId &&
    terminal?.location.projectId === location.projectId
  const target = sameTerminalLocation ? terminal.target : stageTarget(snapshot.projection, location)
  const missingSession =
    snapshot.status === 'ready' &&
    location.sessionId !== null &&
    !snapshot.projection.sessionById[location.sessionId]
  const narrow = width < 100
  const focusedTarget = focus.current?.capabilities.overlay
    ? focus.lastCommandTarget
    : focus.current
  const railFocused = focusedTarget?.widgetId.startsWith('agent-rail') === true
  const showRail = railVisible && (!narrow || railFocused || !target)
  const showStage = !narrow || !showRail
  let railWidth: number | '100%' = 0
  if (showRail) railWidth = narrow ? '100%' : 32
  function selectSession(sessionId: SessionId) {
    setTerminal(null)
    const selected = snapshot.projection.sessionById[sessionId]
    const worktree = selected ? snapshot.projection.worktreeById[selected.worktreeId] : null
    onNavigate({ kind: 'agent', sessionId, projectId: worktree?.projectId ?? projectId })
  }
  function select(target: StageTarget) {
    if (target.kind === 'terminal') {
      setTerminal({ location, target })
      return
    }
    setTerminal(null)
    if (target.kind === 'conversation') {
      selectSession(target.sessionId)
      return
    }
    const projectId = snapshot.projection.worktreeById[target.worktreeId]?.projectId ?? null
    onNavigate({ kind: 'agent', projectId, sessionId: null })
  }
  function focusStage(item: FocusTarget) {
    if (target?.kind === 'terminal') return item.widgetId === `terminal-${target.terminalId}`
    return ['agent-composer', 'agent-approval', 'agent-question'].includes(item.widgetId)
  }
  useCommandHandlers({
    'workspace.toggleSessionRail': {
      run: () => {
        if (narrow) {
          setRailVisible(true)
          commands.focus.request({
            kind: 'match',
            matches: railFocused ? focusStage : (item) => item.widgetId === 'agent-rail',
          })
          return
        }
        setRailVisible(!railVisible)
        commands.focus.request({
          kind: 'match',
          matches: railVisible ? focusStage : (item) => item.widgetId === 'agent-rail',
        })
      },
    },
  })
  return (
    <box flexGrow={1} minHeight={0} flexDirection='column' backgroundColor={theme.background}>
      {snapshot.error && (
        <Toast
          message={snapshot.error}
          theme={theme}
          tone='error'
          durationMs={0}
          onDismiss={() => ready.chat.clearError()}
        />
      )}
      <box
        flexGrow={1}
        minHeight={0}
        flexDirection='row'
        gap={1}
        paddingX={1}
        paddingBottom={height < 20 ? 0 : 1}
      >
        <box width={railWidth} flexShrink={0} overflow='hidden'>
          <AgentRail
            session={session}
            ready={ready}
            projectId={projectId}
            sessionId={location.sessionId}
            theme={theme}
            enabled={enabled && (showRail || narrow)}
            onSelectProject={(projectId) => {
              setTerminal(null)
              onNavigate({ kind: 'agent', projectId, sessionId: null })
            }}
            onSelectSession={selectSession}
            onOpenWorkbench={onOpenWorkbench}
          />
        </box>
        <box
          width={showStage ? undefined : 0}
          flexGrow={showStage ? 1 : 0}
          flexShrink={0}
          minWidth={0}
          minHeight={0}
          overflow='hidden'
        >
          {snapshot.status === 'loading' && <LoadingState theme={theme} />}
          {snapshot.status !== 'loading' && !missingSession && target && (
            <AgentStage
              session={session}
              ready={ready}
              theme={theme}
              target={target}
              onSelect={select}
              enabled={enabled}
            />
          )}
          {missingSession && (
            <EmptyState
              theme={theme}
              title='Session unavailable'
              description='Choose a session in the rail or start a new one.'
            />
          )}
          {snapshot.status !== 'loading' && !missingSession && !target && (
            <EmptyState
              theme={theme}
              title='Start a conversation'
              description='Add a project from the session rail or F1 → Add project. Then type your prompt.'
            />
          )}
        </box>
      </box>
    </box>
  )
}
