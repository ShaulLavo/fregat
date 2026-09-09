import { useEffect, useState } from 'react'
import { useCommandFocus } from '@/commands/hooks/use-command-focus'
import { useCommands } from '@/commands/hooks/use-commands'
import { Dialog } from '@/components/dialog'
import { Select } from '@/components/select'
import { LoadingState } from '@/components/loading-state'
import { readCompletions, type Completion } from '@/agent-stage/state/completions'
import type { SettingsSession } from '@/connection/state/session'
import type { ModelSelection } from '@workspace/contracts'
import type { Theme } from '@/theme/utils/theme'
import { connectionFailure } from '@/connection/utils/failure'

export function CompletionPicker({
  session,
  text,
  cwd,
  selection,
  theme,
  onSelect,
  onClose,
}: {
  readonly session: SettingsSession
  readonly text: string
  readonly cwd: string
  readonly selection: ModelSelection | null
  readonly theme: Theme
  readonly onSelect: (text: string) => void
  readonly onClose: () => void
}) {
  const [items, setItems] = useState<readonly Completion[] | null>(null)
  const [error, setError] = useState('')
  const commands = useCommands()
  useCommandFocus(
    {
      ...commands.focus.getSnapshot().scope,
      id: 'agent-completions',
      area: 'dialog',
      textEntry: false,
      overlay: true,
      focus: () => true,
    },
    true,
  )
  useEffect(() => {
    const controller = new AbortController()
    void readCompletions({ session, text, cwd, selection, signal: controller.signal })
      .then(setItems)
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) setError(connectionFailure(failure).message)
      })
    return () => controller.abort()
  }, [session, text, cwd, selection])
  return (
    <Dialog title='Complete prompt' theme={theme} onClose={onClose}>
      {(!items || items.length === 0) && (
        <scrollbox id='agent-completions' focused height={3}>
          {!items && !error && <LoadingState theme={theme} label='Finding completions…' />}
          {error && <text fg={theme.destructive}>{error}</text>}
          {items?.length === 0 && (
            <text fg={theme.mutedForeground}>No matching files, commands, or skills.</text>
          )}
        </scrollbox>
      )}
      {items && items.length > 0 && (
        <Select
          id='agent-completions'
          options={items.map((item) => ({
            name: item.label,
            description: item.description,
            value: item.text,
          }))}
          height={Math.min(12, items.length * 2)}
          showDescription
          focused
          textColor={theme.foreground}
          selectedTextColor={theme.primaryForeground}
          selectedBackgroundColor={theme.primary}
          onSelect={(index) => {
            const item = items[index]
            if (item) {
              onSelect(item.text)
              onClose()
            }
          }}
        />
      )}
    </Dialog>
  )
}
