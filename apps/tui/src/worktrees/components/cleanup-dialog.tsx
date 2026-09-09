import { useState } from 'react'
import { useCommandFocus } from '@/commands/hooks/use-command-focus'
import { useCommands } from '@/commands/hooks/use-commands'
import { Dialog } from '@/components/dialog'
import { Select } from '@/components/select'
import { Spinner } from '@/components/spinner'
import type { Theme } from '@/theme/utils/theme'
import { WorktreeDescription } from '@/worktrees/components/description'
import { cleanupConfirmationText, type CleanupConfirmation } from '@/worktrees/utils/confirmation'

export function WorktreeCleanupDialog({
  confirmation,
  label,
  pending,
  error,
  theme,
  onCancel,
  onConfirm,
}: {
  readonly confirmation: CleanupConfirmation
  readonly label: string
  readonly pending: boolean
  readonly error: string | null
  readonly theme: Theme
  readonly onCancel: () => void
  readonly onConfirm: () => void
}) {
  const commands = useCommands()
  const [selected, setSelected] = useState(0)
  const text = cleanupConfirmationText(confirmation)
  useCommandFocus(
    {
      ...commands.focus.getSnapshot().scope,
      id: 'worktree-cleanup-confirmation',
      area: 'dialog',
      textEntry: false,
      overlay: true,
      focus: () => true,
    },
    true,
  )
  function cancel() {
    if (!pending) onCancel()
  }
  return (
    <Dialog
      title={text.title}
      theme={theme}
      width={80}
      height={22}
      onClose={cancel}
      footer='PgUp/PgDn details'
    >
      <WorktreeDescription owner='worktree-cleanup-confirmation'>
        <text fg={theme.foreground}>{text.description}</text>
        <text fg={theme.mutedForeground} wrapMode='char'>
          Checkout: {label}
        </text>
        {error && <text fg={theme.destructive}>{error}</text>}
        {pending && <Spinner theme={theme} />}
      </WorktreeDescription>
      <Select
        id='worktree-cleanup-confirmation'
        options={[
          { name: 'Cancel', description: '', value: 'cancel' },
          { name: text.action, description: '', value: 'confirm' },
        ]}
        selectedIndex={selected}
        onChange={setSelected}
        onSelect={(index) => {
          if (pending) return
          if (index === 1) onConfirm()
          if (index === 0) onCancel()
        }}
        focused
        height={2}
        flexShrink={0}
        showDescription={false}
        textColor={theme.foreground}
        selectedTextColor={confirmation.kind === 'force' ? theme.destructive : theme.primary}
        selectedBackgroundColor={theme.accent}
      />
    </Dialog>
  )
}
