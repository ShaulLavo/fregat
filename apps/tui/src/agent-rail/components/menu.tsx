import { useState } from 'react'
import { useCommands } from '@/commands/hooks/use-commands'
import { useCommandFocus } from '@/commands/hooks/use-command-focus'
import { Dialog } from '@/components/dialog'
import { Select } from '@/components/select'
import type { Theme } from '@/theme/utils/theme'

export function RailMenu({
  title,
  actions,
  theme,
  onClose,
}: {
  readonly title: string
  readonly actions: readonly { readonly label: string; readonly run: () => void }[]
  readonly theme: Theme
  readonly onClose: () => void
}) {
  const commands = useCommands()
  const [selected, setSelected] = useState(0)
  useCommandFocus(
    {
      ...commands.focus.getSnapshot().scope,
      id: 'agent-rail-menu',
      area: 'dialog',
      overlay: true,
      textEntry: false,
      focus: () => true,
    },
    true,
  )
  return (
    <Dialog title={title} theme={theme} onClose={onClose}>
      <Select
        id='agent-rail-menu'
        options={actions.map((action) => ({ name: action.label, description: '', value: action }))}
        selectedIndex={selected}
        onChange={setSelected}
        onSelect={(index) => actions[index]?.run()}
        focused
        showDescription={false}
        height={Math.min(16, actions.length)}
        textColor={theme.foreground}
        selectedTextColor={theme.primary}
        selectedBackgroundColor={theme.accent}
      />
    </Dialog>
  )
}
