import '@/terminal/state/renderable'
import { createHostClipboard, type EmbeddedTerminalRenderable } from '@opentui/core'
import { useRenderer } from '@opentui/react'
import { useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { SessionId, WorktreeId } from '@workspace/contracts'
import { usePaneFocus } from '@/commands/hooks/use-pane-focus'
import { useCommands } from '@/commands/hooks/use-commands'
import { commandShortcut } from '@/commands/utils/bindings'
import { useCommandHandlers } from '@/commands/hooks/use-command-handlers'
import type { SessionState, SettingsSession } from '@/connection/state/session'
import { LoadingState } from '@/components/loading-state'
import { useHostActions } from '@/host/hooks/use-host-actions'
import { createTuiError } from '@/host/utils/structured-errors'
import { useSettingValue } from '@/settings/hooks/use-setting-value'
import {
  openTerminalConnection,
  type TerminalConnection,
  type TerminalState,
} from '@/terminal/state/connection'
import type { Theme } from '@/theme/utils/theme'
import { AgentNavigationContext } from '@/navigation/providers/agent-context'
import type { TerminalContextSelection } from '@workspace/client-core/chat/terminal-context'

export function TerminalView({
  session,
  worktreeId,
  terminalId,
  agentSessionId,
  ready,
  theme,
  enabled,
  onClose,
  onAskAgent,
}: {
  readonly session: SettingsSession
  readonly worktreeId: WorktreeId
  readonly terminalId: string
  readonly agentSessionId?: SessionId
  readonly ready: Extract<SessionState, { kind: 'ready' }>
  readonly theme: Theme
  readonly enabled: boolean
  readonly onClose: () => void
  readonly onAskAgent?: (context: TerminalContextSelection) => void | Promise<void>
}) {
  const renderer = useRenderer()
  const commands = useCommands()
  const { focus } = commands
  const host = useHostActions()
  const agentNavigation = useContext(AgentNavigationContext)
  const terminal = useRef<EmbeddedTerminalRenderable | null>(null)
  const connection = useRef<TerminalConnection | null>(null)
  const attached = useRef(false)
  const selectedText = useRef('')
  const [state, setState] = useState<TerminalState>({ kind: 'connecting' })
  const [attempt, setAttempt] = useState(0)
  const [clipboard] = useState(() => createHostClipboard())
  const scrollback = useSettingValue(ready.owner, 'terminal.integrated.scrollback')
  const id = `terminal-${terminalId}`
  const focused = usePaneFocus({ id, area: 'terminal', enabled, textEntry: true })
  useEffect(() => {
    if (enabled) focus.request({ kind: 'match', matches: (target) => target.widgetId === id })
  }, [focus, id, enabled])
  useEffect(() => {
    setState({ kind: 'connecting' })
    selectedText.current = ''
    terminal.current?.write('\x1b[2J\x1b[3J\x1b[H')
    const current = openTerminalConnection(session, {
      worktreeId,
      terminalId,
      agentSessionId,
      cols: terminal.current?.width || 80,
      rows: terminal.current?.height || 24,
    })
    connection.current = current
    const unsubscribe = current.subscribe(() => setState(current.getSnapshot()))
    const output = current.observeOutput((bytes) => terminal.current?.write(bytes))
    return () => {
      unsubscribe()
      output()
      current.close()
      connection.current = null
    }
  }, [session, worktreeId, terminalId, agentSessionId, scrollback, attempt])
  useEffect(
    () => () => {
      void clipboard.dispose()
    },
    [clipboard],
  )
  const inputReady = focused && ready.connection.kind === 'live'
  useLayoutEffect(() => {
    if (inputReady) terminal.current?.focus()
    if (!inputReady) terminal.current?.blur()
  }, [inputReady, scrollback])
  useCommandHandlers(
    {
      'terminal.askAgent': {
        disabledReason: () => {
          if (!onAskAgent && !agentNavigation)
            return 'Agent navigation is unavailable in this terminal host.'
          return (terminal.current?.getSelectedText() || selectedText.current).trim()
            ? null
            : 'Select terminal text to attach to a prompt.'
        },
        run: async () => {
          const text = terminal.current?.getSelectedText() || selectedText.current
          if (!text?.trim()) return
          const context = {
            source: `${terminalId} (selected excerpt)`,
            lineStart: 1,
            lineEnd: text.split('\n').length,
            text,
          }
          if (onAskAgent) {
            await onAskAgent(context)
            return
          }
          agentNavigation?.queuePrompt({ worktreeId, context })
        },
      },
      'terminal.reconnect': {
        disabledReason: () =>
          state.kind === 'failed' ? null : 'The terminal is already connected or has exited.',
        run: () => setAttempt((current) => current + 1),
      },
      'terminal.close': {
        run: () => {
          connection.current?.close(true)
          onClose()
        },
      },
      'terminal.clear': {
        run: () => {
          terminal.current?.write('\x1b[2J\x1b[3J\x1b[H')
        },
      },
      'terminal.copy': {
        run: () => {
          const text = terminal.current?.getSelectedText()
          if (text) renderer.copyToClipboardOSC52(text)
        },
      },
      'terminal.paste': {
        run: async () => {
          const result = await clipboard.read({
            preferredTypes: ['text/plain'],
            signal: session.signal,
          })
          if (result.status === 'empty' || result.status === 'cancelled') return
          if (result.status !== 'read')
            throw createTuiError(
              'Clipboard text could not be read.',
              'Paste using your host terminal shortcut.',
            )
          const bytes = terminal.current?.encodePaste(result.representation.bytes)
          if (bytes) connection.current?.send(bytes)
        },
      },
      'terminal.attach': {
        disabledReason: () =>
          host.attachTerminal ? null : 'Raw attach requires an interactive host terminal.',
        run: async () => {
          if (!host.attachTerminal || attached.current) return
          attached.current = true
          try {
            await host.attachTerminal({
              signal: session.signal,
              open: () =>
                openTerminalConnection(session, { worktreeId, terminalId, agentSessionId }),
            })
          } finally {
            attached.current = false
            if (terminal.current)
              connection.current?.resize(terminal.current.width, terminal.current.height)
            terminal.current?.invalidate()
          }
        },
      },
    },
    enabled,
  )
  return (
    <box flexDirection='column' flexGrow={1} minHeight={0} minWidth={0}>
      {state.kind === 'connecting' && (
        <box position='absolute' left={0} top={0} zIndex={1}>
          <LoadingState theme={theme} label='Connecting terminal…' />
        </box>
      )}
      {state.kind === 'failed' && (
        <text fg={theme.destructive}>{`${state.message} F1 → Reconnect terminal.`}</text>
      )}
      {state.kind === 'exited' && (
        <text fg={theme.mutedForeground}>
          {agentSessionId
            ? `Agent exited (${state.exitCode ?? 'unknown'}). ${commandShortcut(commands.bindings, 'terminal.close')} returns to chat.`
            : `Shell exited (${state.exitCode ?? 'unknown'}). ${commandShortcut(commands.bindings, 'terminal.new')} opens a new session.`}
        </text>
      )}
      <embeddedTerminal
        key={scrollback}
        id={id}
        ref={terminal}
        width='100%'
        height='100%'
        flexGrow={1}
        minHeight={1}
        minWidth={2}
        maxScrollback={scrollback}
        onMouseUp={() => {
          selectedText.current = terminal.current?.getSelectedText() ?? ''
        }}
        onData={(bytes, source) => {
          if (attached.current || (source === 'input' && !inputReady)) return
          if (source === 'input') selectedText.current = ''
          connection.current?.send(bytes)
        }}
        onTerminalResize={(cols, rows) => {
          if (!attached.current) connection.current?.resize(cols, rows)
        }}
      />
      <text height={1} flexShrink={0} fg={theme.mutedForeground}>
        {state.kind === 'ready'
          ? `${commandShortcut(commands.bindings, 'terminal.attach')} attach · Ctrl+] d detaches · ${state.cwd}`
          : 'Terminal'}
      </text>
    </box>
  )
}
