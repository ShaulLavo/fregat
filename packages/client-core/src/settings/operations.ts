import type { ProviderInstanceConfig, SettingsOperation } from '@workspace/contracts'

export function providerEnabledOperation(
  instance: ProviderInstanceConfig,
  enabled: boolean,
): SettingsOperation {
  return {
    createIfMissing: {
      binaryPath: instance.binaryPath,
      config: instance.config,
      displayLabel: instance.displayLabel,
      driverKind: instance.driverKind,
      environment: instance.environment.map(({ name }) => ({ name, value: '' })),
    },
    enabled,
    kind: 'provider.setEnabled',
    providerInstanceId: instance.providerInstanceId,
  }
}
