import { useEffect, useState } from 'react'
import type { WorktreeId } from '@workspace/contracts'
import type { SettingsSession, SessionState } from '@/connection/state/session'
import { useCommandHandlers } from '@/commands/hooks/use-command-handlers'
import { usePaneFocus } from '@/commands/hooks/use-pane-focus'
import { useCommands } from '@/commands/hooks/use-commands'
import { commandShortcut } from '@/commands/utils/bindings'
import { EmptyState } from '@/components/empty-state'
import { TerminalView } from '@/terminal/components/view'
import {
  nextTerminal,
  readTerminalTabs,
  saveTerminalTabs,
  type TerminalTabs,
} from '@/terminal/utils/tabs'
import type { Theme } from '@/theme/utils/theme'

export function TerminalSessions({
  session,
  rootPath,
  worktreeId,
  ready,
  theme,
  enabled,
}: {
  readonly session: SettingsSession
  readonly rootPath: string
  readonly worktreeId: WorktreeId
  readonly ready: Extract<SessionState, { kind: 'ready' }>
  readonly theme: Theme
  readonly enabled: boolean
}) {
  const [tabs, setTabs] = useState(() => readTerminalTabs(ready.storage, rootPath))
  const emptyFocused = usePaneFocus({
    id: 'terminal-empty',
    area: 'terminal',
    enabled: enabled && tabs.selected === null,
  })
  useEffect(() => {
    saveTerminalTabs(ready.storage, rootPath, tabs)
  }, [ready.storage, rootPath, tabs])
  const commands = useCommands()
  const select = (next: TerminalTabs) => {
    setTabs(next)
    const id = next.selected === null ? 'terminal-empty' : `terminal-${next.selected}`
    commands.focus.request({ kind: 'match', matches: (target) => target.widgetId === id })
  }
  useCommandHandlers(
    {
      'terminal.new': {
        run: () => {
          const id = crypto.randomUUID()
          select({ ids: [...tabs.ids, id], selected: id })
        },
      },
      'terminal.next': { run: () => select({ ...tabs, selected: nextTerminal(tabs, 1) }) },
      'terminal.previous': { run: () => select({ ...tabs, selected: nextTerminal(tabs, -1) }) },
    },
    enabled,
  )
  const close = (id: string) => {
    const ids = tabs.ids.filter((value) => value !== id)
    select({ ids, selected: ids[Math.max(0, tabs.ids.indexOf(id) - 1)] ?? null })
  }
  const selected = tabs.selected
  return (
    <box flexDirection='column' flexGrow={1} minHeight={0} minWidth={0}>
      <box height={1} flexShrink={0} flexDirection='row' gap={2} backgroundColor={theme.card}>
        {tabs.ids.map((id, index) => (
          <text
            key={id}
            fg={id === tabs.selected ? theme.primary : theme.mutedForeground}
            onMouseDown={() => select({ ...tabs, selected: id })}
          >
            {`${id === tabs.selected ? '●' : '○'} Terminal ${index + 1}`}
          </text>
        ))}
        <text
          fg={theme.mutedForeground}
        >{`${commandShortcut(commands.bindings, 'terminal.new')} new · ${commandShortcut(commands.bindings, 'terminal.attach')} attach`}</text>
      </box>
      {tabs.selected === null && (
        <box id='terminal-empty' focusable focused={emptyFocused} flexGrow={1}>
          <EmptyState
            title='No terminal sessions'
            description='Use Terminal: New in the command palette.'
            theme={theme}
          />
        </box>
      )}
      {tabs.selected !== null && (
        <TerminalView
          key={tabs.selected}
          session={session}
          worktreeId={worktreeId}
          terminalId={tabs.selected}
          ready={ready}
          theme={theme}
          enabled={enabled}
          onClose={() => {
            if (selected !== null) close(selected)
          }}
        />
      )}
    </box>
  )
}
