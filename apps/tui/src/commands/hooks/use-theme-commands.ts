import type { SettingsOwner } from '@workspace/client-core/settings/owner'

import { useCommandHandlers } from '@/commands/hooks/use-command-handlers'
import { setThemePreference } from '@/commands/utils/theme'

export function useThemeCommands(owner: SettingsOwner, writable: boolean) {
  const disabledReason = () => (writable ? null : 'Reconnect before changing light / dark mode.')
  useCommandHandlers({
    'workspace.setDarkTheme': {
      disabledReason,
      run: () =>
        setThemePreference(owner, { kind: 'set', key: 'workbench.colorTheme', value: 'dark' }),
    },
    'workspace.setLightTheme': {
      disabledReason,
      run: () =>
        setThemePreference(owner, { kind: 'set', key: 'workbench.colorTheme', value: 'light' }),
    },
    'workspace.setSystemTheme': {
      disabledReason,
      run: () =>
        setThemePreference(owner, { kind: 'set', key: 'workbench.colorTheme', value: 'system' }),
    },
  })
}
