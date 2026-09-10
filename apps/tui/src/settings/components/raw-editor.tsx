import type { SettingsOwner } from '@workspace/client-core/settings/owner'
import type { SettingsWriteTarget } from '@workspace/contracts'
import { useEffect, useState, useSyncExternalStore } from 'react'

import { useCommands } from '@/commands/hooks/use-commands'
import { useCommandFocus } from '@/commands/hooks/use-command-focus'
import { Dialog } from '@/components/dialog'
import { Select } from '@/components/select'
import { Spinner } from '@/components/spinner'
import type { EditTextRequest } from '@/host/providers/actions-context'
import { createRawSettingsEditor } from '@/settings/state/raw-editor'
import type { Theme } from '@/theme/utils/theme'
import { useEditorLifetime } from '@/settings/hooks/use-editor-lifetime'

export function RawSettingsEditor({
  owner,
  target,
  editText,
  theme,
  onClose,
}: {
  readonly owner: SettingsOwner
  readonly target: SettingsWriteTarget
  readonly editText: (request: EditTextRequest) => Promise<string | null>
  readonly theme: Theme
  readonly onClose: () => void
}) {
  const lifetime = useEditorLifetime(onClose)
  const [editor] = useState(() =>
    createRawSettingsEditor({ owner, target, editText, signal: lifetime.signal }),
  )
  const state = useSyncExternalStore(editor.subscribe, editor.getSnapshot)
  const commands = useCommands()
  useEffect(() => {
    void editor.edit()
    return () => editor.dispose()
  }, [editor])
  useEffect(() => {
    if (state.phase === 'done') lifetime.close()
  }, [state.phase, lifetime])
  useCommandFocus(
    {
      ...commands.focus.getSnapshot().scope,
      id: 'settings-raw-editor',
      area: 'dialog',
      overlay: true,
      textEntry: false,
      focus: () => state.phase === 'failed',
    },
    state.phase === 'failed',
  )
  return (
    <Dialog
      title={`Settings JSON · ${target}`}
      theme={theme}
      onClose={lifetime.close}
      dismissLabel='discard draft'
    >
      {state.phase !== 'failed' && (
        <box flexDirection='row' gap={1}>
          <Spinner theme={theme} />
          <text fg={theme.foreground}>
            {state.phase === 'saving' ? 'Saving settings…' : 'Waiting for editor…'}
          </text>
        </box>
      )}
      {state.error && <text fg={theme.destructive}>{state.error}</text>}
      {state.phase === 'failed' && (
        <Select
          id='settings-raw-editor'
          focused
          height={3}
          showDescription={false}
          textColor={theme.foreground}
          selectedTextColor={theme.primary}
          selectedBackgroundColor={theme.accent}
          options={[
            { name: 'Edit kept draft again', description: '', value: 'edit' },
            { name: 'Discard draft; edit current settings', description: '', value: 'reload' },
            { name: 'Discard draft and close', description: '', value: 'close' },
          ]}
          onSelect={(index) => {
            if (index === 2) return lifetime.close()
            void editor.edit(index === 1)
          }}
        />
      )}
    </Dialog>
  )
}
