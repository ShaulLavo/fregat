import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { SessionId } from '@workspace/contracts'
import type { ChatOwner } from '@workspace/client-core/chat/owner'
import { quickAccessMode } from '@workspace/client-core/commands/palette'
import { useTerminalDimensions } from '@opentui/react'
import type { CommandId } from '@workspace/client-core/commands/catalog'
import type { SettingsOwner } from '@workspace/client-core/settings/owner'

import { useCommands } from '@/commands/hooks/use-commands'
import { useCommandFocus } from '@/commands/hooks/use-command-focus'
import type { FocusToken } from '@/commands/state/focus'
import { paletteModeRows } from '@/commands/utils/palette-mode'
import { setThemePreference } from '@/commands/utils/theme'
import { readRecentCommands } from '@/storage/recents'
import type { FileStorage } from '@/storage/files'
import { Dialog } from '@/components/dialog'
import { Prompt } from '@/components/prompt'
import { Select } from '@/components/select'
import type { Theme } from '@/theme/utils/theme'
import { useSettingValue } from '@/settings/hooks/use-setting-value'
import { connectionFailure } from '@/connection/utils/failure'
import { Spinner } from '@/components/spinner'
import { LoadingState } from '@/components/loading-state'

export function CommandPalette({
  origin,
  storage,
  theme,
  onClose,
  onRun,
  onFiles,
  chat,
  onSession,
  owner,
  writable,
  initialQuery = '>',
}: {
  origin: FocusToken | null
  storage: Pick<FileStorage, 'getItem' | 'removeItemIfValue' | 'setItem'>
  theme: Theme
  onClose: () => void
  onRun: (id: CommandId) => void
  onFiles: (query: string) => void
  chat: ChatOwner
  onSession: (id: SessionId) => void
  owner: SettingsOwner
  writable: boolean
  initialQuery?: string
}) {
  const commands = useCommands()
  const snapshot = useSyncExternalStore(chat.subscribe, chat.getSnapshot)
  const captured = commands.bus.capture('palette', origin)
  const [query, setQuery] = useState(initialQuery)
  const [selected, setSelected] = useState(0)
  const selection = useRef(0)
  const [reason, setReason] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const active = useRef(true)
  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
    }
  }, [])
  const colorMode = useSettingValue(owner, 'workbench.colorTheme')
  const palette = useSettingValue(owner, 'workbench.palette')
  const { height } = useTerminalDimensions()
  const paletteInput = {
    captured,
    bindings: commands.bindings,
    recents: readRecentCommands(storage),
    colorMode,
    palette,
    writable,
    chat: snapshot,
  }
  const { title, empty, options } = paletteModeRows({ ...paletteInput, search: query })
  useCommandFocus(
    {
      ...commands.focus.getSnapshot().scope,
      id: 'command-palette',
      area: 'command-palette',
      textEntry: true,
      overlay: true,
      focus: () => true,
    },
    true,
  )
  const run = async (index: number, search = query) => {
    const rows = search === query ? options : paletteModeRows({ ...paletteInput, search }).options
    const row = rows[search === query ? index : 0]
    if (!row || pending) return
    if (row.value.reason) {
      setReason(row.value.reason)
      return
    }
    const action = row.value.action
    if (action.kind === 'command') {
      onRun(action.id)
      return
    }
    if (action.kind === 'files') {
      onFiles(action.query)
      return
    }
    if (action.kind === 'session') {
      onSession(action.sessionId)
      return
    }
    setPending(true)
    try {
      const saved = await setThemePreference(
        owner,
        {
          kind: 'set',
          key: 'workbench.palette',
          value: action.id,
        },
        theme.appearance,
      )
      if (saved && active.current) onClose()
    } catch (error) {
      if (active.current) setReason(connectionFailure(error).message)
    } finally {
      if (active.current) setPending(false)
    }
  }
  return (
    <Dialog
      title={title}
      theme={theme}
      onClose={onClose}
      footer='> commands · sess sessions · view · color · colors · Enter open'
      dismissLabel='close'
      width={90}
    >
      <Prompt
        id='command-palette'
        value={query}
        onChange={(value) => {
          selection.current = 0
          setQuery(value)
          setSelected(0)
          setReason(null)
        }}
        onSubmit={(value) => {
          void run(selection.current, value)
        }}
        theme={theme}
        placeholder='Search files, or use >, sess, view, color, theme…'
      />
      {options.length === 0 &&
        quickAccessMode(query) === 'sessions' &&
        snapshot.status === 'loading' && <LoadingState theme={theme} label='Reading sessions…' />}
      {options.length === 0 &&
        (quickAccessMode(query) !== 'sessions' || snapshot.status !== 'loading') && (
          <text fg={theme.mutedForeground}>{empty}</text>
        )}
      <Select
        options={options}
        selectedIndex={selected}
        onChange={(index) => {
          selection.current = index
          setSelected(index)
        }}
        onSelect={(index) => {
          void run(index)
        }}
        navigateFromInput
        height={Math.max(1, Math.min(options.length * 2, height - 12))}
        textColor={theme.foreground}
        selectedTextColor={theme.primaryForeground}
        selectedBackgroundColor={theme.primary}
      />
      {reason && <text fg={theme.warning}>{reason}</text>}
      {pending && (
        <box flexDirection='row' gap={1}>
          <Spinner theme={theme} />
          <text fg={theme.mutedForeground}>Saving app colors…</text>
        </box>
      )}
    </Dialog>
  )
}
