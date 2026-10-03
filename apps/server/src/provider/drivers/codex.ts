import path from 'node:path'
import { homedir } from 'node:os'
import { DEFAULT_CODEX_PROVIDER_SETTINGS } from '@workspace/contracts'
import * as v from 'valibot'
import { CODEX_ADAPTER_CAPABILITIES, CodexProviderAdapter } from '../adapters/codex'
import type { ProviderDriver, ProviderEnvironmentVariable } from '../driver'

/**
 * `home` is the account boundary: Codex keeps `auth.json` and its rollout state
 * under `CODEX_HOME`, so two instances pointed at two homes are two accounts.
 * Absent means "the user's default `~/.codex`".
 */
const codexConfigSchema = v.object({
  binary: v.optional(v.pipe(v.string(), v.trim(), v.minLength(1))),
  home: v.optional(v.pipe(v.string(), v.trim(), v.minLength(1))),
})

export type CodexDriverConfig = v.InferOutput<typeof codexConfigSchema>

export const codexDriver: ProviderDriver<CodexDriverConfig> = {
  capabilities: { ...CODEX_ADAPTER_CAPABILITIES, multiInstance: true },
  credentialPaths: ({ env }) => [path.join(codexHome(env), 'auth.json')],
  create: async (input) => {
    const adapter = new CodexProviderAdapter({
      env: codexSpawnEnvironment(input.env, input.binaryPath),
      displayLabel: input.displayLabel,
      enabled: input.enabled,
      providerInstanceId: input.providerInstanceId,
    })

    return { adapter, dispose: () => adapter.stopAll() }
  },
  defaultConfig: () => ({}),
  displayName: DEFAULT_CODEX_PROVIDER_SETTINGS.displayLabel,
  driverKind: DEFAULT_CODEX_PROVIDER_SETTINGS.driverKind,
  environment: (config) => codexEnvironment(config),
  parseConfig: (config) => v.parse(codexConfigSchema, config ?? {}),
}

function codexEnvironment(config: CodexDriverConfig): ProviderEnvironmentVariable[] {
  const variables: ProviderEnvironmentVariable[] = []
  if (config.home) variables.push({ name: 'CODEX_HOME', value: config.home })
  if (config.binary) variables.push({ name: 'PLATFORM_CODEX_BINARY', value: config.binary })

  return variables
}

/** The settings-level binary override loses to an explicit driver config entry. */
function codexSpawnEnvironment(env: NodeJS.ProcessEnv, binaryPath: string | undefined) {
  if (!binaryPath) return env
  if (env.PLATFORM_CODEX_BINARY) return env

  return { ...env, PLATFORM_CODEX_BINARY: binaryPath }
}

function codexHome(env: NodeJS.ProcessEnv) {
  return env.CODEX_HOME ?? path.join(env.HOME ?? homedir(), '.codex')
}
