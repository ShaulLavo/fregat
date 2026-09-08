import { useState } from 'react'
import { useCommandFocus } from '@/commands/hooks/use-command-focus'
import { useCommands } from '@/commands/hooks/use-commands'
import { Dialog } from '@/components/dialog'
import { Prompt } from '@/components/prompt'
import { OrbitLoader } from '@/components/orbit-loader'
import { connectionFailure } from '@/connection/utils/failure'
import type { Theme } from '@/theme/utils/theme'

export function PathDialog({
  title,
  initial = '',
  theme,
  onSubmit,
  onClose,
}: {
  readonly title: string
  readonly initial?: string
  readonly theme: Theme
  readonly onSubmit: (value: string) => Promise<void>
  readonly onClose: () => void
}) {
  const [value, setValue] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const commands = useCommands()
  useCommandFocus(
    {
      ...commands.focus.getSnapshot().scope,
      id: 'agent-path',
      area: 'dialog',
      textEntry: true,
      overlay: true,
      focus: () => true,
    },
    true,
  )
  async function submit(path: string) {
    if (busy || !path.trim()) return
    setBusy(true)
    setError('')
    try {
      await onSubmit(path.trim())
      onClose()
    } catch (failure) {
      setError(connectionFailure(failure).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      title={title}
      theme={theme}
      onClose={() => {
        if (!busy) onClose()
      }}
    >
      <Prompt
        id='agent-path'
        value={value}
        onChange={setValue}
        onSubmit={(path) => {
          void submit(path)
        }}
        theme={theme}
        disabled={busy}
      />
      {busy && <OrbitLoader theme={theme} />}
      {error && <text fg={theme.destructive}>{error}</text>}
    </Dialog>
  )
}
