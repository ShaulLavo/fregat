import { providerDriverKindSchema } from '@workspace/contracts'
import * as v from 'valibot'
import { MOCK_ADAPTER_CAPABILITIES, MockProviderAdapter } from '../adapters/mock'
import type { ProviderDriver, ProviderEnvironmentVariable } from '../driver'

export const MOCK_DRIVER_KIND = v.parse(providerDriverKindSchema, 'mock')

/**
 * Deterministic driver used to exercise the multi-instance seam end to end.
 * `credentialsPath` stands in for a CLI's credentials file: the adapter reports
 * `authenticated` once that file exists, which is what makes an out-of-band
 * sign-in observable without spawning anything.
 */
const mockConfigSchema = v.object({
  credentialsPath: v.optional(v.pipe(v.string(), v.trim(), v.minLength(1))),
  responseText: v.optional(v.pipe(v.string(), v.minLength(1))),
  script: v.optional(v.picklist(['turn-anatomy'])),
  stepDelayMs: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0))),
})

export type MockDriverConfig = v.InferOutput<typeof mockConfigSchema>

export const mockDriver: ProviderDriver<MockDriverConfig> = {
  capabilities: { ...MOCK_ADAPTER_CAPABILITIES, multiInstance: true },
  credentialPaths: ({ config }) => (config.credentialsPath ? [config.credentialsPath] : []),
  create: async (input) => {
    const adapter = new MockProviderAdapter({
      displayLabel: input.displayLabel,
      driverKind: MOCK_DRIVER_KIND,
      enabled: input.enabled,
      env: input.env,
      providerInstanceId: input.providerInstanceId,
      ...(input.config.responseText ? { responseText: input.config.responseText } : {}),
      ...(input.config.script ? { script: input.config.script } : {}),
      ...(input.config.stepDelayMs === undefined ? {} : { stepDelayMs: input.config.stepDelayMs }),
    })

    return { adapter, dispose: () => adapter.stopAll() }
  },
  defaultConfig: () => ({}),
  displayName: 'Mock',
  driverKind: MOCK_DRIVER_KIND,
  environment: (config) => mockEnvironment(config),
  parseConfig: (config) => v.parse(mockConfigSchema, config ?? {}),
}

function mockEnvironment(config: MockDriverConfig): ProviderEnvironmentVariable[] {
  if (!config.credentialsPath) return []

  return [{ name: 'PLATFORM_MOCK_CREDENTIALS', value: config.credentialsPath }]
}
