import { agentHome } from '@/agent/utils/target'
import { rememberedAgent } from '@/agent/utils/location'
import type { Location } from '@/navigation/state/history'
import { CommandProvider } from '@/commands/providers/command-provider'
import { Workspace } from '@/components/workspace'
import { connectionFailure } from '@/connection/utils/failure'
import type { SessionState, SettingsSession } from '@/connection/state/session'
import { recordRecentCommand } from '@/storage/recents'
import type { Theme } from '@/theme/utils/theme'
import { useSettingValue } from '@/settings/hooks/use-setting-value'
import { useRenderer } from '@opentui/react'
import { useState, useSyncExternalStore } from 'react'
import { createHistory } from '@/navigation/state/history'
import { rememberedWorkbench } from '@/workbench/utils/location'
import { Toast } from '@/components/toast'
import { EditorProvider } from '@/editor/providers/editor-provider'
import { Status } from '@/components/status'

export function Foundation({
  session,
  state,
  theme,
  initialLocation,
}: {
  session: SettingsSession
  state: Extract<SessionState, { kind: 'ready' }>
  theme: Theme
  initialLocation?: Location
}) {
  const overrides = useSettingValue(state.owner, 'keybindings.overrides')
  const renderer = useRenderer()
  const [failure, setFailure] = useState<string | null>(null)
  const [history] = useState(() =>
    createHistory(
      initialLocation ??
        rememberedAgent(state.storage) ??
        rememberedWorkbench(state.storage) ??
        agentHome,
    ),
  )
  const { current } = useSyncExternalStore(history.subscribe, history.getSnapshot)
  return (
    <CommandProvider
      signal={session.signal}
      scope={{
        screen: current.kind,
        environmentId: state.descriptor.environmentId,
        projectId: current.kind === 'workbench' ? current.rootPath : null,
      }}
      handlers={{}}
      overrides={overrides}
      kitty={renderer.capabilities?.kitty_keyboard ?? false}
      onExecuted={(id) => recordRecentCommand(state.storage, id)}
      onError={(error) => {
        const reason = connectionFailure(error)
        setFailure(reason.message)
        session.record({ action: 'tui.command.failed', ...reason })
      }}
    >
      <EditorProvider theme={theme}>
        <Workspace session={session} state={state} theme={theme} history={history} />
      </EditorProvider>
      {failure && (
        <Toast message={failure} tone='error' theme={theme} onDismiss={() => setFailure(null)} />
      )}
      <Status state={state} theme={theme} />
    </CommandProvider>
  )
}
