import path from 'node:path'
import { homedir } from 'node:os'
import { DEFAULT_CLAUDE_PROVIDER_SETTINGS } from '@workspace/contracts'
import * as v from 'valibot'
import { CLAUDE_ADAPTER_CAPABILITIES, ClaudeProviderAdapter } from '../adapters/claude'
import type { ProviderDriver, ProviderEnvironmentVariable } from '../driver'

/**
 * `configDir` maps to `CLAUDE_CONFIG_DIR`, the only supported way to give a
 * second Claude account its own credentials. Overriding `HOME` would move the
 * macOS keychain lookup with it and break sign-in for both instances.
 */
const claudeConfigSchema = v.object({
  configDir: v.optional(v.pipe(v.string(), v.trim(), v.minLength(1))),
})

export type ClaudeDriverConfig = v.InferOutput<typeof claudeConfigSchema>

export const claudeDriver: ProviderDriver<ClaudeDriverConfig> = {
  capabilities: { ...CLAUDE_ADAPTER_CAPABILITIES, multiInstance: true },
  credentialPaths: ({ config }) => [path.join(claudeConfigDir(config), '.credentials.json')],
  create: async (input) => {
    const adapter = new ClaudeProviderAdapter({
      ...(input.services.agentDiagnostics
        ? { agentDiagnostics: input.services.agentDiagnostics }
        : {}),
      ...(input.binaryPath ? { binaryPath: input.binaryPath } : {}),
      displayLabel: input.displayLabel,
      enabled: input.enabled,
      env: input.env,
      providerInstanceId: input.providerInstanceId,
    })

    return { adapter, dispose: () => adapter.stopAll() }
  },
  defaultConfig: () => ({}),
  displayName: DEFAULT_CLAUDE_PROVIDER_SETTINGS.displayLabel,
  driverKind: DEFAULT_CLAUDE_PROVIDER_SETTINGS.driverKind,
  environment: (config) => claudeEnvironment(config),
  parseConfig: (config) => v.parse(claudeConfigSchema, config ?? {}),
}

function claudeEnvironment(config: ClaudeDriverConfig): ProviderEnvironmentVariable[] {
  if (!config.configDir) return []

  return [{ name: 'CLAUDE_CONFIG_DIR', value: config.configDir }]
}

function claudeConfigDir(config: ClaudeDriverConfig) {
  return config.configDir ?? path.join(homedir(), '.claude')
}
