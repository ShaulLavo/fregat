import type { Location } from '@/navigation/state/history'
import { useKeyboard, useTerminalDimensions } from '@opentui/react'
import { useSyncExternalStore } from 'react'

import { LoadingState } from '@/components/loading-state'
import { Failure } from '@/connection/components/failure'
import type { SettingsSession } from '@/connection/state/session'
import { Foundation } from '@/components/foundation'
import { usePaletteLibrary } from '@/theme/hooks/use-palette-library'
import { useTheme } from '@/theme/hooks/use-theme'
import { useSettingValue } from '@/settings/hooks/use-setting-value'
import { HostActionsContext, type HostActions } from '@/host/providers/actions-context'

type ApplicationProps = {
  initialLocation?: Location
  session: SettingsSession
  noColor?: boolean
  onExit: () => void
  onSuspend?: () => void
  onEditText?: HostActions['editText']
  onAttachTerminal?: HostActions['attachTerminal']
  onReadClipboardImage?: HostActions['readClipboardImage']
}

export function Application({
  session,
  initialLocation,
  noColor = false,
  onExit,
  onSuspend,
  onEditText,
  onAttachTerminal,
  onReadClipboardImage,
}: ApplicationProps) {
  const { height } = useTerminalDimensions()
  const short = height < 20
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot)
  const owner = state.kind === 'ready' ? state.owner : null
  const mode = useSettingValue(owner, 'workbench.colorTheme')
  const paletteId = useSettingValue(owner, 'workbench.palette')
  const palette = usePaletteLibrary(state.kind === 'ready' ? state.client : null, paletteId)
  const reducedMotion = useSettingValue(owner, 'workbench.reduceMotion')
  const theme = useTheme(mode, noColor, { palette, reducedMotion })
  useKeyboard((event) => {
    if (state.kind === 'ready') return
    if (event.ctrl && event.name === 'c') {
      event.preventDefault()
      onExit()
    }
    if (event.ctrl && event.name === 'r') {
      event.preventDefault()
      void session.refresh()
    }
  })
  return (
    <box width='100%' height='100%' backgroundColor={theme.background} flexDirection='column'>
      <box
        height={short ? 1 : 2}
        flexShrink={0}
        paddingX={2}
        alignItems='center'
        gap={2}
        backgroundColor={theme.background}
        flexDirection='row'
      >
        <text fg={theme.primary}>
          <strong>PLATFORM</strong>
        </text>
        <text fg={theme.mutedForeground}>workspace</text>
      </box>
      {state.kind === 'loading' && <LoadingState theme={theme} />}
      {state.kind === 'failed' && <Failure failure={state.failure} theme={theme} />}
      {state.kind === 'ready' && state.connection.kind === 'offline' && (
        <text fg={theme.warning} paddingX={2} flexShrink={0}>
          {short
            ? 'Offline · cached view'
            : 'Connection lost. Your draft is retained. Reconnect to continue.'}
        </text>
      )}
      {state.kind === 'ready' && (
        <HostActionsContext
          value={{
            quit: onExit,
            suspend: onSuspend,
            editText: onEditText,
            attachTerminal: onAttachTerminal,
            readClipboardImage: onReadClipboardImage,
          }}
        >
          <Foundation
            session={session}
            state={state}
            theme={theme}
            initialLocation={initialLocation}
          />
        </HostActionsContext>
      )}
      {state.kind !== 'ready' && (
        <box height={3} paddingX={2} paddingTop={1} flexShrink={0}>
          <text fg={theme.mutedForeground}>{session.origin} · Ctrl+R retry · Ctrl+C quit</text>
        </box>
      )}
    </box>
  )
}
