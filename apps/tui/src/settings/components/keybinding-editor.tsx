import type { SettingsOwner } from '@workspace/client-core/settings/owner'
import { useTerminalDimensions } from '@opentui/react'
import { useLayoutEffect, useState, useSyncExternalStore } from 'react'

import { useCommands } from '@/commands/hooks/use-commands'
import { useCommandFocus } from '@/commands/hooks/use-command-focus'
import { useCommandHandlers } from '@/commands/hooks/use-command-handlers'
import { commandShortcut, effectiveTerminalBindings } from '@/commands/utils/bindings'
import { Dialog } from '@/components/dialog'
import { Prompt } from '@/components/prompt'
import { Select } from '@/components/select'
import { SaveFeedback } from '@/settings/components/save-feedback'
import {
  matchingCommands,
  recordedKeysLabel,
  recordKey,
  type KeybindingEditorState,
} from '@/settings/utils/recording'
import type { Theme } from '@/theme/utils/theme'
import { useEditorLifetime } from '@/settings/hooks/use-editor-lifetime'

export function KeybindingEditor({
  owner,
  theme,
  onClose,
}: {
  readonly owner: SettingsOwner
  readonly theme: Theme
  readonly onClose: () => void
}) {
  const commands = useCommands()
  const lifetime = useEditorLifetime(onClose)
  const { height } = useTerminalDimensions()
  const short = height < 20
  const settings = useSyncExternalStore(owner.subscribe, owner.getSnapshot)
  const overrides = settings.projection.values['keybindings.overrides']
  const [state, setState] = useState<KeybindingEditorState>({ kind: 'select' })
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const [pending, setPending] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const rows = matchingCommands(query)
  const active = state.kind !== 'select' ? state.command : null
  const recorded = state.kind === 'review' ? state.keys : undefined
  const resolution = effectiveTerminalBindings(overrides, commands.kitty)
  const nextOverrides = { ...overrides }
  if (active && recorded === undefined) delete nextOverrides[active]
  if (active && recorded !== undefined) nextOverrides[active] = recorded
  const preview = effectiveTerminalBindings(nextOverrides, commands.kitty)
  const diagnostics =
    state.kind === 'review'
      ? preview.diagnostics.filter(
          (entry) => entry.command === active || entry.reason === `Replaced by ${active}.`,
        )
      : []
  const recording = state.kind === 'record'
  let footer = 'Enter select'
  if (recording)
    footer = short
      ? 'Enter review · Esc cancel'
      : 'Enter review · Backspace remove stroke · Esc cancel recording'
  useLayoutEffect(() => {
    if (!recording) return
    return commands.keymap.captureKeys((event) =>
      setState((current) => recordKey(current, event, commands.kitty)),
    )
  }, [recording, commands.keymap, commands.kitty])
  useCommandFocus(
    {
      ...commands.focus.getSnapshot().scope,
      id: 'keybinding-search',
      area: 'dialog',
      overlay: true,
      textEntry: true,
      focus: () => state.kind === 'select',
    },
    state.kind === 'select',
  )
  useCommandFocus(
    {
      ...commands.focus.getSnapshot().scope,
      id: 'keybinding-actions',
      area: 'dialog',
      overlay: true,
      textEntry: false,
      focus: () => state.kind !== 'select' && !pending,
    },
    state.kind !== 'select' && !pending,
  )
  const save = async () => {
    if (state.kind !== 'review' || pending || lifetime.signal.aborted) return
    setPending(true)
    setFailure(null)
    const operation =
      state.keys === undefined
        ? { kind: 'keybinding.remove' as const, command: state.command }
        : { kind: 'keybinding.set' as const, command: state.command, keys: state.keys }
    const submission = owner.submit('user', [operation], 'tui.settings.recorder')
    const result = submission.kind === 'submitted' ? await submission.settled : 'discarded'
    if (lifetime.signal.aborted) return
    setPending(false)
    if (result === 'acknowledged') return setState({ kind: 'actions', command: state.command })
    setFailure('Shortcut could not be saved. Your draft is kept; retry or cancel.')
  }
  useCommandHandlers({
    'dialog.confirm': {
      disabledReason: () =>
        state.kind !== 'review' || pending ? 'Review a recorded shortcut first.' : null,
      run: save,
    },
  })
  return (
    <Dialog
      title={active && !short ? `Shortcut · ${active}` : 'Keyboard shortcuts'}
      theme={theme}
      onClose={lifetime.close}
      footer={footer}
      dismissLabel={recording ? null : 'close'}
    >
      {state.kind === 'select' && (
        <Prompt
          id='keybinding-search'
          value={query}
          onChange={(value) => {
            setQuery(value)
            setSelected(0)
          }}
          onSubmit={(value) => {
            const command = matchingCommands(value)[value === query ? selected : 0]
            if (command) setState({ kind: 'actions', command: command.id })
          }}
          theme={theme}
          placeholder='Search every command by name or ID…'
        />
      )}
      {state.kind === 'select' && (
        <Select
          key={query}
          height={short ? 4 : 10}
          minHeight={1}
          navigateFromInput
          options={rows.map((command) => ({
            name: command.title,
            description: `${command.id} · ${commandShortcut(resolution.bindings, command.id)}`,
            value: command.id,
          }))}
          selectedIndex={selected}
          textColor={theme.foreground}
          selectedTextColor={theme.primary}
          selectedBackgroundColor={theme.accent}
          onChange={setSelected}
          onSelect={(index) => {
            const command = rows[index]
            if (command) setState({ kind: 'actions', command: command.id })
          }}
        />
      )}
      {state.kind === 'select' && rows.length === 0 && (
        <text fg={theme.mutedForeground}>No commands match “{query}”.</text>
      )}
      {active && (!short || state.kind === 'actions') && (
        <text fg={theme.mutedForeground}>
          Current: {commandShortcut(resolution.bindings, active)} ·{' '}
          {active in overrides ? 'User override' : 'Default'}
        </text>
      )}
      {state.kind === 'record' && (
        <text fg={theme.primary}>
          {state.strokes.join('  ').replaceAll('Mod+', 'Ctrl+') ||
            'Press one shortcut, or a Control chord with two strokes…'}
        </text>
      )}
      {state.kind === 'record' && state.error && <text fg={theme.destructive}>{state.error}</text>}
      {state.kind === 'review' && (
        <text fg={theme.primary}>New shortcut: {recordedKeysLabel(recorded)}</text>
      )}
      {diagnostics.map((entry) => (
        <text key={entry.command} fg={theme.warning}>
          {entry.command}: {entry.reason}
        </text>
      ))}
      {state.kind === 'review' && (
        <text fg={theme.mutedForeground}>
          After saving: {commandShortcut(preview.bindings, state.command)}
        </text>
      )}
      {state.kind === 'actions' && (
        <Select
          id='keybinding-actions'
          focused={!pending}
          height={4}
          showDescription={false}
          textColor={theme.foreground}
          selectedTextColor={theme.primary}
          selectedBackgroundColor={theme.accent}
          options={[
            { name: 'Record shortcut', description: '', value: 'record' },
            { name: 'Disable shortcut', description: '', value: 'disable' },
            { name: 'Restore default shortcut', description: '', value: 'reset' },
            { name: 'Choose another command', description: '', value: 'back' },
          ]}
          onSelect={(index) => {
            setFailure(null)
            if (index === 3) return setState({ kind: 'select' })
            if (index === 0)
              return setState({ kind: 'record', command: state.command, strokes: [], error: null })
            setState({
              kind: 'review',
              command: state.command,
              keys: index === 1 ? null : undefined,
            })
          }}
        />
      )}
      {state.kind === 'record' && (
        <Select
          id='keybinding-actions'
          focused
          height={1}
          showDescription={false}
          textColor={theme.foreground}
          selectedTextColor={theme.primary}
          options={[{ name: 'Recording keys…', description: '', value: 'recording' }]}
        />
      )}
      {state.kind === 'review' && (
        <Select
          id='keybinding-actions'
          focused={!pending}
          height={2}
          showDescription={false}
          textColor={theme.foreground}
          selectedTextColor={theme.primary}
          selectedBackgroundColor={theme.accent}
          options={[
            { name: 'Save shortcut', description: '', value: 'save' },
            { name: 'Cancel change', description: '', value: 'cancel' },
          ]}
          onSelect={(index) => {
            if (index === 0) {
              void save()
              return
            }
            setState({ kind: 'actions', command: state.command })
          }}
        />
      )}
      <SaveFeedback failure={failure} pending={pending} theme={theme} label='Saving shortcut…' />
    </Dialog>
  )
}
