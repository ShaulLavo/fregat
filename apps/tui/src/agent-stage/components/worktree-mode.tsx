import { useState } from 'react'
import { Dialog } from '@/components/dialog'
import { Select } from '@/components/select'
import { useCommands } from '@/commands/hooks/use-commands'
import { useCommandFocus } from '@/commands/hooks/use-command-focus'
import type { Theme } from '@/theme/utils/theme'

export function WorktreeMode({
  value,
  newWorktreeReason,
  theme,
  onSelect,
  onClose,
}: {
  readonly value: 'current' | 'new'
  readonly newWorktreeReason: string | null
  readonly theme: Theme
  readonly onSelect: (mode: 'current' | 'new') => void
  readonly onClose: () => void
}) {
  const commands = useCommands()
  const [selected, setSelected] = useState(value === 'current' ? 0 : 1)
  const [message, setMessage] = useState<string | null>(null)
  useCommandFocus(
    {
      ...commands.focus.getSnapshot().scope,
      id: 'agent-worktree-mode',
      area: 'dialog',
      overlay: true,
      textEntry: false,
      focus: () => true,
    },
    true,
  )
  return (
    <Dialog title='Session worktree' theme={theme} onClose={onClose} footer='Enter select'>
      <Select
        id='agent-worktree-mode'
        options={[
          {
            name: 'Send to current branch',
            description: 'Use the selected checkout, including its working changes.',
          },
          {
            name: 'New worktree',
            description:
              newWorktreeReason ??
              'Create a separate checkout from its current commit on first send.',
          },
        ]}
        selectedIndex={selected}
        onChange={setSelected}
        onSelect={(index) => {
          if (index === 1 && newWorktreeReason) {
            setMessage(newWorktreeReason)
            return
          }
          onSelect(index === 1 ? 'new' : 'current')
        }}
        focused
        height={4}
        textColor={theme.foreground}
        selectedTextColor={theme.primary}
        selectedBackgroundColor={theme.accent}
      />
      {message && <text fg={theme.warning}>{message}</text>}
    </Dialog>
  )
}
