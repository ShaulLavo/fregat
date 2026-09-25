import {
  DEFAULT_CLAUDE_PROVIDER_SETTINGS,
  DEFAULT_CODEX_PROVIDER_SETTINGS,
} from '@workspace/contracts'
import type { AnyProviderDriver, ProviderInstanceConfig } from '../driver'
import { claudeDriver } from './claude'
import { codexDriver } from './codex'
import { mockDriver } from './mock'

/**
 * Every driver this build knows how to instantiate. A settings entry naming a
 * driver absent from this list is not an error — the registry surfaces it as an
 * unavailable snapshot so downgrading a fork does not wipe the user's config.
 *
 * The mock driver is deliberately absent: it is registered explicitly by tests
 * and by the deterministic harness, never by the product default.
 */
export const BUILT_IN_PROVIDER_DRIVERS: readonly AnyProviderDriver[] = [codexDriver, claudeDriver]

/** The agent browser harness sets this on its throwaway server to reach the mock driver. */
const HARNESS_ENV = 'PLATFORM_AGENT_HARNESS'

export function productProviderDrivers(env: NodeJS.ProcessEnv = process.env) {
  if (env[HARNESS_ENV] !== '1') return BUILT_IN_PROVIDER_DRIVERS

  return [...BUILT_IN_PROVIDER_DRIVERS, mockDriver]
}

/**
 * The instance map a fresh install starts from — one instance per built-in
 * driver, each on the driver's default home. Once settings ship, this is the
 * fallback for an empty `providerInstances`.
 */
export const DEFAULT_PROVIDER_INSTANCES: readonly ProviderInstanceConfig[] = [
  {
    displayLabel: DEFAULT_CODEX_PROVIDER_SETTINGS.displayLabel,
    driverKind: DEFAULT_CODEX_PROVIDER_SETTINGS.driverKind,
    enabled: DEFAULT_CODEX_PROVIDER_SETTINGS.enabled,
    providerInstanceId: DEFAULT_CODEX_PROVIDER_SETTINGS.providerInstanceId,
  },
  {
    displayLabel: DEFAULT_CLAUDE_PROVIDER_SETTINGS.displayLabel,
    driverKind: DEFAULT_CLAUDE_PROVIDER_SETTINGS.driverKind,
    enabled: DEFAULT_CLAUDE_PROVIDER_SETTINGS.enabled,
    providerInstanceId: DEFAULT_CLAUDE_PROVIDER_SETTINGS.providerInstanceId,
  },
]
