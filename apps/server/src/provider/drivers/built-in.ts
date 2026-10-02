import { realpathSync } from 'node:fs'
import path from 'node:path'
import * as v from 'valibot'
import {
  DEFAULT_CLAUDE_PROVIDER_SETTINGS,
  DEFAULT_CURSOR_PROVIDER_SETTINGS,
  DEFAULT_CODEX_PROVIDER_SETTINGS,
  providerInstanceIdSchema,
} from '@workspace/contracts'
import type { AnyProviderDriver, ProviderInstanceConfig } from '../driver'
import { sessionIdentityErrors } from '../structured-errors'
import { claudeDriver } from './claude'
import { codexDriver } from './codex'
import { mockDriver } from './mock'
import { cursorDriver } from './cursor'
import { opencodeDriver } from './opencode'

/**
 * Every driver this build knows how to instantiate. A settings entry naming a
 * driver absent from this list is not an error — the registry surfaces it as an
 * unavailable snapshot so downgrading a fork does not wipe the user's config.
 *
 * The mock driver is deliberately absent: it is registered explicitly by tests
 * and by the deterministic harness, never by the product default.
 */
const BUILT_IN_PROVIDER_DRIVERS: readonly AnyProviderDriver[] = [
  codexDriver,
  claudeDriver,
  cursorDriver,
  opencodeDriver,
]

/** The agent browser harness sets this on its throwaway server to reach the mock driver. */
const HARNESS_ENV = 'PLATFORM_AGENT_HARNESS'
/** Set only by `agent:browser --real-providers`: the owner lets this run use real accounts. */
export const HARNESS_REAL_PROVIDERS_ENV = 'PLATFORM_AGENT_REAL_PROVIDERS'
/** The folder harness fixture binaries live under; a native instance runs nothing else. */
export const HARNESS_FIXTURE_ROOT_ENV = 'PLATFORM_AGENT_FIXTURE_ROOT'

export function productProviderDrivers(env: NodeJS.ProcessEnv = process.env) {
  if (env[HARNESS_ENV] !== '1') return BUILT_IN_PROVIDER_DRIVERS
  if (env[HARNESS_REAL_PROVIDERS_ENV] === '1') return [...BUILT_IN_PROVIDER_DRIVERS, mockDriver]

  const fixtureRoot = env[HARNESS_FIXTURE_ROOT_ENV]
  return [
    ...BUILT_IN_PROVIDER_DRIVERS.map((driver) => fixtureOnlyDriver(driver, fixtureRoot)),
    mockDriver,
  ]
}

/**
 * A harness driver that refuses before its adapter exists, so neither a turn nor a status
 * probe can start the machine's own CLI. A binary resolved from PATH or the SDK is refused.
 */
function fixtureOnlyDriver(
  driver: AnyProviderDriver,
  fixtureRoot: string | undefined,
): AnyProviderDriver {
  return {
    ...driver,
    create: async (input) => {
      const binary =
        driver.driverKind === codexDriver.driverKind
          ? (input.env.PLATFORM_CODEX_BINARY ?? input.binaryPath)
          : input.binaryPath
      const refusal =
        driver.driverKind === opencodeDriver.driverKind && input.config.serverUrl
          ? 'external-server-url'
          : fixtureRefusal(binary, fixtureRoot)
      if (refusal)
        throw sessionIdentityErrors.HARNESS_FIXTURES_ONLY({
          internal: { driverKind: driver.driverKind, refusal },
        })

      return driver.create(input)
    },
  }
}

function fixtureRefusal(binary: string | undefined, fixtureRoot: string | undefined) {
  if (!fixtureRoot) return 'no-fixture-root'
  if (!binary || !path.isAbsolute(binary)) return 'binary-from-path'
  try {
    // A symlink inside the fixture folder may still point at the installed CLI.
    const resolved = realpathSync(binary)
    if (!resolved.startsWith(`${realpathSync(fixtureRoot)}${path.sep}`))
      return 'binary-outside-fixture-root'
  } catch {
    return 'binary-unresolved'
  }

  return null
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
  { ...DEFAULT_CURSOR_PROVIDER_SETTINGS },
  {
    displayLabel: opencodeDriver.displayName,
    driverKind: opencodeDriver.driverKind,
    enabled: false,
    providerInstanceId: v.parse(providerInstanceIdSchema, 'opencode'),
  },
]
