import { useCommands } from '@/commands/hooks/use-commands'
import { useTerminalDimensions } from '@opentui/react'
import { useSyncExternalStore } from 'react'
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
  const focused = useSyncExternalStore(focus.subscribe, focus.getSnapshot)
  const terminal = focused.current?.area === 'terminal'
  const { width, height } = useTerminalDimensions()
  const compact = width < 70 || height < 20
  const offline = state.connection.kind === 'offline'
  const palette = bindings.find(
    (binding) => binding.command === 'workspace.showCommandPalette',
  )?.keys
  const files = bindings.find((binding) => binding.command === 'workspace.showQuickAccess')?.keys
  const refresh = bindings.find((binding) => binding.command === 'workspace.reconnect')?.keys
  const quit = bindings.find(
    (binding) =>
      binding.command === 'workspace.quit' &&
      (binding.source === 'user' || binding.keys.startsWith('Ctrl+K ')),
  )?.keys
  const back = bindings.find((binding) => binding.command === 'workspace.navigateBack')?.keys
  const hints = [
    palette && `${palette} commands`,
    !offline && !terminal && files && `${files} files`,
    !terminal && (!compact || offline) && refresh && `${refresh} refresh`,
    terminal && quit && `${quit} quit`,
    terminal && back && `${back} back`,
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
