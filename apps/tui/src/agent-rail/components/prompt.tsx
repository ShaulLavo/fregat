import { useState } from 'react'
import { useCommands } from '@/commands/hooks/use-commands'
import { useCommandFocus } from '@/commands/hooks/use-command-focus'
import { Dialog } from '@/components/dialog'
import { Prompt } from '@/components/prompt'
import { LoadingState } from '@/components/loading-state'
import type { Theme } from '@/theme/utils/theme'

export function RailPrompt({
  title,
  description,
  initial = '',
  confirm,
  busy,
  error,
  theme,
  onSubmit,
  onClose,
}: {
  readonly title: string
  readonly description: string
  readonly initial?: string
  readonly confirm?: string
  readonly busy: boolean
  readonly error: string | null
  readonly theme: Theme
  readonly onSubmit: (text: string) => void | Promise<void>
  readonly onClose: () => void
}) {
  const commands = useCommands()
  const [text, setText] = useState(initial)
  useCommandFocus(
    {
      ...commands.focus.getSnapshot().scope,
      id: 'agent-rail-dialog',
      area: 'dialog',
      overlay: true,
      textEntry: true,
      focus: () => true,
    },
    true,
  )
  return (
    <Dialog
      title={title}
      theme={theme}
      onClose={() => {
        if (!busy) onClose()
      }}
    >
      <text fg={theme.mutedForeground}>
        {description}
        {confirm ? ` Type ${confirm} to confirm.` : ''}
      </text>
      <Prompt
        id='agent-rail-dialog'
        value={text}
        onChange={setText}
        onSubmit={(value) => {
          if ((!confirm && value.trim()) || value === confirm) void onSubmit(value.trim())
        }}
        theme={theme}
        disabled={busy}
      />
      {busy && <LoadingState theme={theme} label='Applying change…' />}
      {error && <text fg={theme.destructive}>{error}</text>}
    </Dialog>
  )
}
