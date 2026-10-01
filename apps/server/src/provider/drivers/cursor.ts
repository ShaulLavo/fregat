import path from 'node:path'
import * as v from 'valibot'
import { DEFAULT_CURSOR_PROVIDER_SETTINGS } from '@workspace/contracts'
import { platformHomePath } from '../../home'
import { CursorProviderAdapter } from '../adapters/cursor'
import { acpErrors } from '../acp/structured-errors'
import type { ProviderDriver } from '../driver'

const configSchema = v.object({
  configHome: v.optional(
    v.pipe(v.string(), v.check(path.isAbsolute, 'Use an absolute configuration directory')),
  ),
})
type CursorDriverConfig = v.InferOutput<typeof configSchema>

export const cursorDriver: ProviderDriver<CursorDriverConfig> = {
  driverKind: DEFAULT_CURSOR_PROVIDER_SETTINGS.driverKind,
  displayName: DEFAULT_CURSOR_PROVIDER_SETTINGS.displayLabel,
  capabilities: {
    conversationRollback: false,
    sessionModelSwitch: 'in-session',
    signIn: false,
    listCommands: false,
    multiInstance: true,
  },
  defaultConfig: () => ({}),
  parseConfig: (config) => v.parse(configSchema, config ?? {}),
  credentialPaths: ({ config }) =>
    config.configHome ? [path.join(config.configHome, 'cursor', 'cli-config.json')] : [],
  environment: (config) =>
    config.configHome ? [{ name: 'XDG_CONFIG_HOME', value: config.configHome }] : [],
  create: async (input) => {
    const operationTimeoutMs = input.services.acpOperationTimeoutMs
    if (!operationTimeoutMs)
      throw acpErrors.SERVICE_UNAVAILABLE({
        internal: { driverKind: 'cursor', service: 'operation-timeout' },
      })
    const adapter = new CursorProviderAdapter({
      settings: {
        ...DEFAULT_CURSOR_PROVIDER_SETTINGS,
        displayLabel: input.displayLabel,
        enabled: input.enabled,
        providerInstanceId: input.providerInstanceId,
      },
      binaryPath:
        input.binaryPath || Bun.which('cursor-agent', { PATH: input.env.PATH }) || 'cursor-agent',
      env: {
        ...input.env,
        XDG_CONFIG_HOME:
          input.config.configHome ??
          platformHomePath('providers', 'cursor', input.providerInstanceId),
      },
      operationTimeoutMs,
    })
    return { adapter, dispose: () => adapter.stopAll() }
  },
}
