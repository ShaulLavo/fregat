import type { SettingsOperation } from '@workspace/contracts'

export const settingsMutationKeys = {
  write: (operations: readonly SettingsOperation[]) =>
    operations.some((operation) => operation.kind.startsWith('keybinding.'))
      ? (['settings', 'mutation', 'keybindings'] as const)
      : (['settings', 'mutation'] as const),
}
