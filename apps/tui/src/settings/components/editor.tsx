import type { SettingsOwner } from '@workspace/client-core/settings/owner'
import { useTerminalDimensions } from '@opentui/react'
import {
  descriptorFor,
  errorStringField,
  type SettingId,
  type SettingsSnapshot,
  type SettingsWriteTarget,
} from '@workspace/contracts'
import { useRef, useState } from 'react'

import { Dialog } from '@/components/dialog'
import { Prompt } from '@/components/prompt'
import { TextPrompt } from '@/components/text-prompt'
import { Select } from '@/components/select'
import { SaveFeedback } from '@/settings/components/save-feedback'
import { useCommands } from '@/commands/hooks/use-commands'
import { useCommandFocus } from '@/commands/hooks/use-command-focus'
import { useCommandHandlers } from '@/commands/hooks/use-command-handlers'
import { settingChoices, settingDraft, saveSettingDraft, choiceDraft } from '@/settings/utils/edit'
import type { Theme } from '@/theme/utils/theme'
import { commandShortcut } from '@/commands/utils/bindings'
import { useEditorLifetime } from '@/settings/hooks/use-editor-lifetime'

export function SettingsEditor({
  id,
  snapshot,
  owner,
  target,
  theme,
  onClose,
}: {
  readonly id: SettingId
  readonly snapshot: SettingsSnapshot
  readonly owner: SettingsOwner
  readonly target: SettingsWriteTarget
  readonly theme: Theme
  readonly onClose: () => void
}) {
  const [base] = useState(snapshot)
  const [mode] = useState(theme.appearance)
  const lifetime = useEditorLifetime(onClose)
  const { height } = useTerminalDimensions()
  const short = height < 20
  const [draft, setDraft] = useState(() => settingDraft(id, base, target, mode))
  const draftRef = useRef(draft)
  const changeDraft = (value: string) => {
    draftRef.current = value
    setDraft(value)
  }
  const [failure, setFailure] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const choices = settingChoices(id)
  const widget = descriptorFor(id).widget
  const multiline = !choices && !['number', 'string', 'font'].includes(widget)
  const commands = useCommands()
  useCommandFocus(
    {
      ...commands.focus.getSnapshot().scope,
      id: 'settings-editor',
      area: 'dialog',
      overlay: true,
      textEntry: !choices,
      focus: () => true,
    },
    true,
  )

  const save = async (input: string) => {
    if (pending || lifetime.signal.aborted) return
    setFailure(null)
    setPending(true)
    try {
      const outcome = await saveSettingDraft({
        id,
        draft: input,
        snapshot: base,
        target,
        owner,
        signal: lifetime.signal,
        mode,
      })
      if (lifetime.signal.aborted) return
      if (outcome !== 'acknowledged') {
        setFailure('Save failed. Your draft is kept; retry or cancel to inspect the failure.')
        return
      }
      lifetime.close()
    } catch (error) {
      if (lifetime.signal.aborted) return
      const conflict = errorStringField(error, 'code') === 'settings.RAW_REVISION_STALE'
      setFailure(
        conflict
          ? 'Settings changed elsewhere. Cancel and reopen to load the current value.'
          : (errorStringField(error, 'message') ??
              'Invalid value. Check the type and allowed range.'),
      )
    } finally {
      if (!lifetime.signal.aborted) setPending(false)
    }
  }
  useCommandHandlers({
    'dialog.confirm': {
      disabledReason: () => (pending ? 'Settings are being saved.' : null),
      run: () => save(draftRef.current),
    },
  })

  return (
    <Dialog
      title={`${id} · ${target}`}
      theme={theme}
      onClose={lifetime.close}
      footer={
        multiline ? `${commandShortcut(commands.bindings, 'dialog.confirm')} save` : 'Enter save'
      }
    >
      {!short && <text fg={theme.mutedForeground}>{descriptorFor(id).description}</text>}
      {id === 'providers.instances' && (
        <text fg={theme.warning}>
          Only enabled flags can be changed here. Provider configuration and secrets remain managed
          by the provider setup.
        </text>
      )}
      {choices && (
        <Select
          id='settings-editor'
          options={choices.map((value) => ({ name: value, description: '', value }))}
          focused={!pending}
          textColor={theme.foreground}
          selectedTextColor={theme.primary}
          selectedBackgroundColor={theme.accent}
          showDescription={false}
          selectedIndex={choices.indexOf(draft.replaceAll('"', ''))}
          onChange={(index) => {
            const value = choices[index]
            if (value !== undefined) changeDraft(choiceDraft(id, value))
          }}
          onSelect={(index) => {
            const value = choices[index]
            if (value !== undefined) void save(choiceDraft(id, value))
          }}
        />
      )}
      {!choices && !multiline && (
        <Prompt
          id='settings-editor'
          value={draft}
          onChange={changeDraft}
          onSubmit={(value) => void save(value)}
          theme={theme}
          disabled={pending}
        />
      )}
      {multiline && (
        <TextPrompt
          id='settings-editor'
          value={draft}
          onChange={changeDraft}
          onSubmit={(value) => void save(value)}
          theme={theme}
          disabled={pending}
          height={short ? 4 : 10}
          language={widget === 'multiline' ? undefined : 'json'}
        />
      )}
      <SaveFeedback failure={failure} pending={pending} theme={theme} label='Saving…' />
    </Dialog>
  )
}
