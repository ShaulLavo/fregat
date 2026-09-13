import { matchingSettingIds } from '@workspace/client-core/settings/search'
import { useKeyboard, useTerminalDimensions } from '@opentui/react'
import type { SettingsOwner } from '@workspace/client-core/settings/owner'
import {
  settingRowIds,
  errorStringField,
  type SettingId,
  type SettingsWriteTarget,
} from '@workspace/contracts'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'

import { Select } from '@/components/select'
import { Details } from '@/settings/components/details'
import { Diagnostics } from '@/settings/components/diagnostics'
import { SettingsEditor } from '@/settings/components/editor'
import { KeybindingEditor } from '@/settings/components/keybinding-editor'
import { RawSettingsEditor } from '@/settings/components/raw-editor'
import { useHostActions } from '@/host/hooks/use-host-actions'
import { commandShortcut } from '@/commands/utils/bindings'
import { Dialog } from '@/components/dialog'
import { Spinner } from '@/components/spinner'
import { useCommands } from '@/commands/hooks/use-commands'
import { useCommandFocus } from '@/commands/hooks/use-command-focus'
import { useCommandHandlers } from '@/commands/hooks/use-command-handlers'
import type { FocusToken } from '@/commands/state/focus'
import type { CommandContext } from '@/commands/state/bus'
import { settingEditDisabledReason } from '@/settings/utils/edit'
import { settingOptions } from '@/settings/utils/rows'
import { nextFocus, type SettingsFocus } from '@/settings/utils/focus'
import type { Theme } from '@/theme/utils/theme'
import { settingsIssues, settingsRepairHint } from '@/settings/utils/diagnostics'

export function SettingsBrowser({
  owner,
  theme,
  enabled = true,
  writable = true,
  initialQuery = '',
  onDialogChange,
  onQueryChange,
}: {
  readonly owner: SettingsOwner
  readonly theme: Theme
  readonly enabled?: boolean
  readonly writable?: boolean
  readonly initialQuery?: string
  readonly onDialogChange?: (open: boolean) => void
  readonly onQueryChange?: (query: string) => void
}) {
  const state = useSyncExternalStore(owner.subscribe, owner.getSnapshot)
  const snapshot = {
    ...state.snapshot,
    values: state.projection.values,
    diagnostics: state.projection.diagnostics,
  }
  const issues = settingsIssues(snapshot)
  const [query, setQuery] = useState(initialQuery)
  const [selected, setSelected] = useState(0)
  const [focus, setFocus] = useState<SettingsFocus>('search')
  const [target, setTarget] = useState<SettingsWriteTarget>('user')
  const [editing, setEditing] = useState<SettingId | 'choose' | 'raw' | null>(null)
  const host = useHostActions()
  useEffect(() => {
    setQuery(initialQuery)
    setSelected(0)
    setFocus('search')
  }, [initialQuery])
  const { width, height } = useTerminalDimensions()
  const short = height < 20
  const ids = matchingSettingIds(query)
  const selectedId = ids[Math.min(selected, Math.max(0, ids.length - 1))]
  const compact = width < 80
  const fields = selectedId ? settingRowIds(selectedId) : []
  const commands = useCommands()
  const scope = useSyncExternalStore(commands.focus.subscribe, commands.focus.getSnapshot).scope
  const returnFocus = useRef<FocusToken | null>(null)
  const [restoreAfterClose, setRestoreAfterClose] = useState(false)
  useEffect(() => {
    if (issues.length === 0 && focus === 'diagnostics') setFocus('details')
  }, [issues.length, focus])
  const closeEditor = () => {
    setEditing(null)
    onDialogChange?.(false)
    setRestoreAfterClose(true)
  }
  useEffect(() => {
    if (!restoreAfterClose || editing || !enabled) return
    commands.focus.restore(returnFocus.current)
    setRestoreAfterClose(false)
  }, [restoreAfterClose, editing, enabled, commands.focus])
  useCommandFocus(
    {
      ...scope,
      id: 'settings-diagnostics',
      area: 'settings',
      textEntry: false,
      focus: () => {
        if (!enabled || editing || issues.length === 0) return false
        setFocus('diagnostics')
        return true
      },
    },
    enabled && !editing && focus === 'diagnostics' && issues.length > 0,
  )
  useCommandFocus(
    {
      ...scope,
      id: 'settings-search',
      area: 'settings',
      textEntry: true,
      focus: () => {
        if (!enabled || editing) return false
        setFocus('search')
        return true
      },
    },
    enabled && !editing && focus === 'search',
  )
  useCommandFocus(
    {
      ...scope,
      id: 'settings-list',
      area: 'settings',
      textEntry: false,
      focus: () => {
        if (!enabled || editing) return false
        setFocus('list')
        return true
      },
    },
    enabled && !editing && focus === 'list',
  )
  useCommandFocus(
    {
      ...scope,
      id: 'settings-details',
      area: 'settings',
      textEntry: false,
      focus: () => {
        if (!enabled || editing) return false
        setFocus('details')
        return true
      },
    },
    enabled && !editing && focus === 'details',
  )
  useCommandFocus(
    {
      ...scope,
      id: 'settings-fields',
      area: 'dialog',
      textEntry: false,
      overlay: true,
      focus: () => editing === 'choose',
    },
    editing === 'choose',
  )
  const settingsDisabled = (context: CommandContext) => {
    if (editing) return 'Finish editing this setting first.'
    if (context.target?.area !== 'settings') return 'Focus settings first.'
    return null
  }
  const editDisabled = (context: CommandContext) =>
    settingsDisabled(context) ?? settingEditDisabledReason(selectedId, target, writable)
  useCommandHandlers({
    'settings.editRaw': {
      disabledReason: (context) =>
        settingsDisabled(context) ??
        (!writable ? 'Reconnect before editing settings.' : null) ??
        (!host.editText ? 'Editor is unavailable.' : null),
      run: ({ origin }) => {
        returnFocus.current = origin
        setEditing('raw')
        onDialogChange?.(true)
      },
    },
    'settings.edit': {
      disabledReason: editDisabled,
      run: ({ origin }) => {
        if (!selectedId) return false
        returnFocus.current = origin
        setEditing(fields.length > 1 ? 'choose' : selectedId)
        onDialogChange?.(true)
      },
    },
    'settings.nextScope': {
      disabledReason: settingsDisabled,
      run: () => setTarget((current) => (current === 'user' ? 'workspace' : 'user')),
    },
    'settings.reset': {
      disabledReason: editDisabled,
      run: () => {
        if (selectedId)
          owner.submit(
            target,
            [{ kind: 'reset', keys: settingRowIds(selectedId) }],
            'tui.settings.reset',
          )
      },
    },
    'settings.retry': {
      disabledReason: (context) => {
        const reason = settingsDisabled(context)
        if (reason) return reason
        if (!writable) return 'Reconnect before retrying settings writes.'
        return state.failures.length ? null : 'There are no failed settings writes.'
      },
      run: () => {
        for (const entry of state.failures) owner.retry(entry.intentId)
      },
    },
    'settings.discard': {
      disabledReason: (context) =>
        settingsDisabled(context) ??
        (state.failures.length ? null : 'There are no failed settings writes.'),
      run: () => {
        for (const entry of state.failures) owner.discard(entry.intentId)
      },
    },
  })

  useKeyboard((event) => {
    if (!enabled || editing || event.defaultPrevented) return
    if (event.name === 'tab') {
      event.preventDefault()
      setFocus((current) => nextFocus(current, event.shift, issues.length > 0))
    }
    if (event.name === 'escape') setFocus('search')
  })

  return (
    <box
      flexGrow={1}
      minHeight={0}
      flexDirection='column'
      gap={short ? 0 : 1}
      paddingX={1}
      overflow='hidden'
    >
      <box
        border={!short}
        borderColor={focus === 'search' ? theme.primary : theme.border}
        paddingX={1}
        height={short ? 1 : 3}
      >
        <input
          id='settings-search'
          placeholder='Search settings by name, key, or description…'
          value={query}
          focused={enabled && !editing && focus === 'search'}
          textColor={theme.foreground}
          backgroundColor={theme.background}
          focusedBackgroundColor={theme.background}
          focusedTextColor={theme.foreground}
          onSubmit={() => setFocus('details')}
          onInput={(value) => {
            setQuery(value)
            onQueryChange?.(value)
            setSelected(0)
          }}
        />
      </box>
      <text fg={theme.mutedForeground}>
        {ids.length} {ids.length === 1 ? 'setting' : 'settings'} · {target} ·{' '}
        {commandShortcut(commands.bindings, 'settings.edit')} edit ·{' '}
        {commandShortcut(commands.bindings, 'settings.nextScope')} scope
        {!short &&
          !compact &&
          ` · ${commandShortcut(commands.bindings, 'settings.reset')} reset · Tab focus`}
      </text>
      {state.pendingCount > 0 && (
        <box flexDirection='row' gap={1}>
          <Spinner theme={theme} />
          <text fg={theme.mutedForeground}>Saving {state.pendingCount}…</text>
        </box>
      )}
      {state.failures.length > 0 && (
        <text fg={theme.destructive}>
          {errorStringField(state.failures.at(-1)?.error, 'message') ??
            'Settings could not be saved.'}{' '}
          {commandShortcut(commands.bindings, 'settings.retry')} retry ·{' '}
          {commandShortcut(commands.bindings, 'settings.discard')} discard
        </text>
      )}
      {issues.length > 0 && (
        <Diagnostics
          issues={issues}
          focused={enabled && !editing && focus === 'diagnostics'}
          short={short}
          repairHint={settingsRepairHint({
            target,
            writable,
            editorAvailable: Boolean(host.editText),
            paletteShortcut: commandShortcut(commands.bindings, 'workspace.showCommandPalette'),
            scopeShortcut: commandShortcut(commands.bindings, 'settings.nextScope'),
          })}
          theme={theme}
        />
      )}
      {ids.length === 0 && <text fg={theme.foreground}>No settings match "{query}".</text>}
      <box flexGrow={1} minHeight={0} flexDirection='row' overflow='hidden'>
        {(!compact || focus !== 'details') && (
          <Select
            id='settings-list'
            key={query}
            options={settingOptions(ids)}
            width={compact ? '100%' : 34}
            flexShrink={0}
            minHeight={0}
            flexGrow={compact ? 1 : 0}
            focused={enabled && !editing && focus === 'list'}
            navigateFromInput={enabled && !editing && focus === 'search'}
            showDescription={false}
            selectedIndex={selected}
            backgroundColor={theme.background}
            focusedBackgroundColor={theme.background}
            textColor={theme.foreground}
            focusedTextColor={theme.foreground}
            selectedBackgroundColor={theme.accent}
            selectedTextColor={theme.primary}
            onChange={(index) => setSelected(index)}
            onSelect={() => setFocus('details')}
          />
        )}
        {selectedId && (!compact || focus === 'details') && (
          <Details
            id={selectedId}
            snapshot={snapshot}
            theme={theme}
            focused={enabled && !editing && focus === 'details'}
            target={target}
          />
        )}
      </box>
      {editing === 'choose' && (
        <Dialog title='Choose setting to edit' theme={theme} onClose={closeEditor}>
          <Select
            id='settings-fields'
            options={fields.map((id) => ({ name: id, description: id, value: id }))}
            focused
            textColor={theme.foreground}
            selectedTextColor={theme.primary}
            selectedBackgroundColor={theme.accent}
            showDescription={false}
            onSelect={(index) => {
              const id = fields[index]
              if (id) setEditing(id)
            }}
          />
        </Dialog>
      )}
      {editing === 'raw' && host.editText && (
        <RawSettingsEditor
          owner={owner}
          target={target}
          editText={host.editText}
          theme={theme}
          onClose={closeEditor}
        />
      )}
      {editing === 'keybindings.overrides' && (
        <KeybindingEditor owner={owner} theme={theme} onClose={closeEditor} />
      )}
      {editing &&
        editing !== 'choose' &&
        editing !== 'raw' &&
        editing !== 'keybindings.overrides' && (
          <SettingsEditor
            id={editing}
            snapshot={state.snapshot}
            owner={owner}
            target={target}
            theme={theme}
            onClose={closeEditor}
          />
        )}
    </box>
  )
}
