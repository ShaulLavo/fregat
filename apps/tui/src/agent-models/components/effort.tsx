import { useState } from 'react'
import type { ModelSelection } from '@workspace/contracts'
import type { ProviderModelOption } from '@workspace/client-core/chat/providers/models'
import { withModelEffort } from '@workspace/client-core/chat/providers/effort'
import { useCommandFocus } from '@/commands/hooks/use-command-focus'
import { useCommands } from '@/commands/hooks/use-commands'
import { Dialog } from '@/components/dialog'
import { Select } from '@/components/select'
import type { Theme } from '@/theme/utils/theme'

export function ModelEffort({
  option,
  theme,
  onSelect,
  onClose,
}: {
  readonly option: ProviderModelOption
  readonly theme: Theme
  readonly onSelect: (value: ModelSelection) => void
  readonly onClose: () => void
}) {
  const commands = useCommands()
  const [selected, setSelected] = useState(0)
  const options = [
    {
      name: 'Provider default',
      description: 'Let the provider choose the reasoning effort',
      value: null,
    },
    ...option.effortLevels.map((level) => ({
      name: level.label,
      description: level.description ?? '',
      value: level.effort,
    })),
  ]
  useCommandFocus(
    {
      ...commands.focus.getSnapshot().scope,
      id: 'agent-model-effort',
      area: 'dialog',
      textEntry: false,
      overlay: true,
      focus: () => true,
    },
    true,
  )
  return (
    <Dialog title={`${option.label} · reasoning effort`} theme={theme} onClose={onClose}>
      <Select
        id='agent-model-effort'
        options={options}
        selectedIndex={selected}
        onChange={setSelected}
        onSelect={(index) =>
          onSelect(withModelEffort(option.modelSelection, options[index]?.value ?? null))
        }
        focused
        height={Math.min(14, options.length * 2 + 1)}
        textColor={theme.foreground}
        selectedTextColor={theme.primary}
        selectedBackgroundColor={theme.accent}
      />
    </Dialog>
  )
}
