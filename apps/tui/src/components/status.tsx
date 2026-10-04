import { commandShortcut } from '@/commands/utils/bindings'
import { useStore } from 'zustand'
import { useCommands } from '@/commands/hooks/use-commands'
import { useTerminalDimensions } from '@opentui/react'
import type { SessionState } from '@/connection/state/session'
import type { Theme } from '@/theme/utils/theme'

export function Status({
  state,
  theme,
}: {
  state: Extract<SessionState, { kind: 'ready' }>
  theme: Theme
}) {
  const { bindings, focus } = useCommands()
  const terminal = useStore(focus.store, (state) => state.current?.area === 'terminal')
  const { width, height } = useTerminalDimensions()
  const compact = width < 70 || height < 20
  const offline = state.connection.kind === 'offline'
  const palette = commandShortcut(bindings, 'workspace.showCommandPalette').split(' / ')[0]
  const files = commandShortcut(bindings, 'workspace.showQuickAccess').split(' / ')[0]
  const refresh = commandShortcut(bindings, 'workspace.reconnect').split(' / ')[0]
  const quitKeys = commandShortcut(bindings, 'workspace.quit').split(' / ')
  const quit = bindings.find(
    (binding) =>
      binding.command === 'workspace.quit' &&
      !binding.unbind &&
      quitKeys.includes(binding.keys) &&
      (binding.source === 'user' || binding.keys.startsWith('Ctrl+K ')),
  )?.keys
  const back = commandShortcut(bindings, 'workspace.navigateBack').split(' / ')[0]
  const hints = [
    palette !== 'unassigned' && `${palette} commands`,
    !offline && !terminal && files !== 'unassigned' && `${files} files`,
    !terminal && (!compact || offline) && refresh !== 'unassigned' && `${refresh} refresh`,
    terminal && quit && `${quit} quit`,
    terminal && back !== 'unassigned' && `${back} back`,
  ].filter(Boolean)
  const connection = [
    state.connection.kind === 'live' ? 'Live' : 'Disconnected',
    state.descriptor.label,
  ].join(' · ')
  return (
    <box
      height={compact ? 2 : 1}
      paddingX={2}
      flexShrink={0}
      overflow='hidden'
      backgroundColor={theme.background}
    >
      <text fg={theme.mutedForeground}>
        {compact ? `${connection}\n${hints.join(' · ')}` : [connection, ...hints].join(' · ')}
      </text>
    </box>
  )
}
