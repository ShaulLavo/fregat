import path from 'node:path'
import { homedir } from 'node:os'
import * as v from 'valibot'
import {
  OPENCODE_ADAPTER_CAPABILITIES,
  OPENCODE_DRIVER_KIND,
  OpenCodeProviderAdapter,
} from '../adapters/opencode'
import type { ProviderDriver } from '../driver'

const configSchema = v.object({
  serverUrl: v.optional(
    v.pipe(
      v.string(),
      v.url(),
      v.check(
        (value) => ['http:', 'https:'].includes(new URL(value).protocol),
        'Use an HTTP or HTTPS server URL.',
      ),
    ),
  ),
  dataHome: v.optional(
    v.pipe(v.string(), v.check(path.isAbsolute, 'Use an absolute data directory.')),
  ),
})

export type OpenCodeDriverConfig = v.InferOutput<typeof configSchema>

export const opencodeDriver: ProviderDriver<OpenCodeDriverConfig> = {
  capabilities: { ...OPENCODE_ADAPTER_CAPABILITIES, multiInstance: true },
  driverKind: OPENCODE_DRIVER_KIND,
  displayName: 'OpenCode',
  defaultConfig: () => ({}),
  parseConfig: (config) => v.parse(configSchema, config ?? {}),
  environment: (config) =>
    config.dataHome ? [{ name: 'XDG_DATA_HOME', value: config.dataHome }] : [],
  credentialPaths: ({ config, env }) => [
    path.join(
      config.dataHome ?? env.XDG_DATA_HOME ?? path.join(homedir(), '.local/share'),
      'opencode/auth.json',
    ),
  ],
  create: async (input) => {
    const adapter = new OpenCodeProviderAdapter({
      binaryPath: input.binaryPath,
      env: input.env,
      serverUrl: input.config.serverUrl,
      providerInstanceId: input.providerInstanceId,
      displayLabel: input.displayLabel,
      enabled: input.enabled,
    })
    return { adapter, dispose: () => adapter.stopAll() }
  },
}
