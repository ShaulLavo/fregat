import { commandById } from '@workspace/client-core/commands/catalog'
import { useTerminalDimensions } from '@opentui/react'

import { useCommands } from '@/commands/hooks/use-commands'
import { useCommandFocus } from '@/commands/hooks/use-command-focus'
import { Select } from '@/components/select'
import { Dialog } from '@/components/dialog'
import type { Theme } from '@/theme/utils/theme'
import { commandShortcut } from '@/commands/utils/bindings'

export function ShortcutHelp({ theme, onClose }: { theme: Theme; onClose: () => void }) {
  const commands = useCommands()
  const { height } = useTerminalDimensions()
  const bound = commands.bindings.filter(
    (binding) =>
      binding.command !== null &&
      !binding.unbind &&
      commands.bus.capture().inspect(binding.command).status !== 'unavailable' &&
      commandShortcut(commands.bindings, binding.command).split(' / ').includes(binding.keys),
  )
  useCommandFocus(
    {
      ...commands.focus.getSnapshot().scope,
      id: 'shortcut-help',
      area: 'dialog',
      textEntry: false,
      overlay: true,
      focus: () => true,
    },
    true,
  )
  return (
    <Dialog
      title='Keyboard shortcuts'
      theme={theme}
      onClose={onClose}
      footer='↑↓ select'
      dismissLabel='close'
      width={90}
    >
      <Select
        id='shortcut-help'
        options={bound.map((binding) => ({
          name: `${binding.keys.padEnd(18)} ${binding.command ? (commandById(binding.command)?.title ?? binding.command) : ''}`,
          description: `${binding.source} · ${binding.pane ?? 'global'}`,
        }))}
        height={Math.max(1, height - 12)}
        focused
        textColor={theme.foreground}
        selectedTextColor={theme.primary}
        selectedBackgroundColor={theme.accent}
      />
      <text fg={theme.mutedForeground}>
        Edit Keybindings overrides in Settings to customize these bindings.
      </text>
      {commands.diagnostics.length > 0 && (
        <text fg={theme.warning}>
          {commands.diagnostics.map((item) => `${item.command}: ${item.reason}`).join('\n')}
        </text>
      )}
    </Dialog>
  )
}
