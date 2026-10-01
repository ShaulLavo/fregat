import { chmodSync, existsSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import * as v from 'valibot'
import { afterAll, assert, describe, expect, it } from 'vitest'

import {
  DEFAULT_PROVIDER_INSTANCES,
  HARNESS_REAL_PROVIDERS_ENV,
  productProviderDrivers,
} from '../../apps/server/src/provider/drivers/built-in'
import {
  providerInstanceIdSchema,
  providerListResultSchema,
} from '../../packages/contracts/src/index'
import { isolatedServerEnv, startIsolatedServer } from './isolated-server'
import { providerAccessRefusal } from './provider-access'
import { scenarios } from './scenarios/index'

const ACCOUNT_ENV = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_CONFIG_DIR',
  'CODEX_API_KEY',
  'CODEX_HOME',
  'OPENAI_API_KEY',
]
const scratch = mkdtempSync(path.join(tmpdir(), 'fregat-provider-access-'))
const outside = mkdtempSync(path.join(tmpdir(), 'fregat-provider-access-outside-'))

afterAll(() => {
  rmSync(scratch, { force: true, recursive: true })
  rmSync(outside, { force: true, recursive: true })
})

function serverEnv(realProviders: boolean) {
  return isolatedServerEnv({
    home: path.join(scratch, 'home'),
    logs: path.join(scratch, 'logs'),
    port: 1,
    productionRoot: path.join(scratch, 'production'),
    realProviders,
    scratchRoot: scratch,
    webOrigin: new URL('http://localhost:5214'),
  })
}

function script(directory: string, name: string) {
  const file = path.join(directory, name)
  writeFileSync(file, '#!/bin/sh\nexit 1\n')
  chmodSync(file, 0o755)
  return file
}

function realDrivers(env: NodeJS.ProcessEnv) {
  return productProviderDrivers(env).filter((driver) => driver.driverKind !== 'mock')
}

async function create(
  env: NodeJS.ProcessEnv,
  driverKind: string,
  instance: { binaryPath?: string; env?: NodeJS.ProcessEnv } = {},
) {
  const driver = realDrivers(env).find((entry) => entry.driverKind === driverKind)
  assert(driver, `No ${driverKind} driver`)
  const handle = await driver.create({
    ...(instance.binaryPath ? { binaryPath: instance.binaryPath } : {}),
    config: driver.defaultConfig(),
    displayLabel: driverKind,
    enabled: true,
    env: { ...env, ...instance.env },
    providerInstanceId: v.parse(providerInstanceIdSchema, `${driverKind}-fixture`),
    services: { cwd: process.cwd() },
  })
  await handle.dispose()
}

describe('a scenario run without --real-providers', () => {
  it('registers OpenCode with discovery disabled by default', () => {
    expect(productProviderDrivers({}).some((driver) => driver.driverKind === 'opencode')).toBe(true)
    expect(
      DEFAULT_PROVIDER_INSTANCES.find((instance) => instance.driverKind === 'opencode'),
    ).toMatchObject({ enabled: false })
  })

  it('refuses every scenario declared realProviders and nothing else on its own server', () => {
    for (const scenario of scenarios) {
      const refusal = providerAccessRefusal({
        scenario,
        isolatedServer: true,
        realProviders: false,
      })
      expect(refusal !== null, scenario.name).toBe(scenario.realProviders === true)
      expect(
        providerAccessRefusal({ scenario, isolatedServer: true, realProviders: true }),
        scenario.name,
      ).toBeNull()
    }
  })

  it('refuses a writing scenario on a server whose providers the run does not own', () => {
    for (const scenario of scenarios) {
      const refusal = providerAccessRefusal({
        scenario,
        isolatedServer: false,
        realProviders: false,
      })
      const safe = Boolean(scenario.readOnly || scenario.surface) && !scenario.realProviders
      expect(refusal === null, scenario.name).toBe(safe)
    }
  })

  it('drops an inherited opt-in from the throwaway server', () => {
    const inherited = process.env[HARNESS_REAL_PROVIDERS_ENV]
    process.env[HARNESS_REAL_PROVIDERS_ENV] = '1'
    try {
      expect(serverEnv(false)[HARNESS_REAL_PROVIDERS_ENV]).toBeUndefined()
      expect(serverEnv(true)[HARNESS_REAL_PROVIDERS_ENV]).toBe('1')
    } finally {
      if (inherited === undefined) delete process.env[HARNESS_REAL_PROVIDERS_ENV]
      else process.env[HARNESS_REAL_PROVIDERS_ENV] = inherited
    }
  })

  it('refuses to create a native instance that would run the installed CLI', async () => {
    const env = serverEnv(false)
    expect(realDrivers(env).map((driver) => driver.driverKind)).toEqual([
      'codex',
      'claude',
      'cursor',
      'opencode',
    ])
    const linked = path.join(scratch, 'linked-cli')
    symlinkSync(script(outside, 'cli'), linked)
    for (const provider of DEFAULT_PROVIDER_INSTANCES) {
      const kind = provider.driverKind
      await expect(create(env, kind), kind).rejects.toThrow('fixture providers only')
      await expect(create(env, kind, { binaryPath: kind }), kind).rejects.toThrow(
        'fixture providers only',
      )
      await expect(create(env, kind, { binaryPath: script(outside, kind) }), kind).rejects.toThrow(
        'fixture providers only',
      )
      await expect(create(env, kind, { binaryPath: linked }), kind).rejects.toThrow(
        'fixture providers only',
      )
    }
    // Codex reads its binary from the environment ahead of the settings path.
    await expect(
      create(env, 'codex', {
        binaryPath: script(scratch, 'codex-fixture'),
        env: { PLATFORM_CODEX_BINARY: 'codex' },
      }),
    ).rejects.toThrow('fixture providers only')
  })

  it('creates native instances that run a fixture binary', async () => {
    const env = serverEnv(false)
    await create(env, 'codex', { binaryPath: script(scratch, 'codex.mjs') })
    await create(env, 'claude', { binaryPath: script(scratch, 'claude.mjs') })
    await create(env, 'opencode', { binaryPath: script(scratch, 'opencode') })
  })

  it('refuses external OpenCode servers even with an authorized fixture binary', async () => {
    const driver = realDrivers(serverEnv(false)).find((entry) => entry.driverKind === 'opencode')!
    await expect(
      driver.create({
        binaryPath: script(scratch, 'opencode-external'),
        config: driver.parseConfig({ serverUrl: 'http://127.0.0.1:1' }),
        displayLabel: 'External',
        enabled: true,
        env: serverEnv(false),
        providerInstanceId: v.parse(providerInstanceIdSchema, 'opencode-external'),
        services: { cwd: process.cwd() },
      }),
    ).rejects.toThrow('fixture providers only')
  })

  it('spawns no provider CLI, even for a built-in instance a scenario enables', async () => {
    // Stand-ins shadow the installed CLIs on PATH and record any call, so a regression shows here.
    const bin = mkdtempSync(path.join(outside, 'bin-'))
    const calls = path.join(outside, 'calls.log')
    for (const name of ['codex', 'claude', 'opencode'])
      writeFileSync(path.join(bin, name), `#!/bin/sh\necho "${name} $*" >> ${calls}\nexit 1\n`, {
        mode: 0o755,
      })
    const webOrigin = 'http://localhost:5215'
    // Should the guard regress, the SDK's bundled Claude CLI would still start; give it no account.
    const inherited = ['HOME', ...ACCOUNT_ENV].map((name) => [name, process.env[name]] as const)
    process.env.HOME = mkdtempSync(path.join(outside, 'home-'))
    for (const name of ACCOUNT_ENV) delete process.env[name]
    const server = await startIsolatedServer(new URL(webOrigin), {
      pathPrefix: bin,
      scratchRoot: scratch,
    }).finally(() => {
      for (const [name, value] of inherited) {
        if (value === undefined) delete process.env[name]
        else process.env[name] = value
      }
    })
    try {
      const written = await fetch(`${server.origin}/settings/write`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: webOrigin },
        body: JSON.stringify({
          target: 'user',
          mutationId: crypto.randomUUID(),
          operations: DEFAULT_PROVIDER_INSTANCES.map((provider) => ({
            kind: 'provider.setEnabled',
            providerInstanceId: provider.providerInstanceId,
            enabled: true,
          })),
        }),
      })
      expect(written.ok).toBe(true)
      const refused = async () => {
        const response = await fetch(`${server.origin}/providers`, {
          headers: { origin: webOrigin },
        })
        const { providers } = v.parse(providerListResultSchema, await response.json())
        return providers
          .filter((provider) => provider.driverKind !== 'mock')
          .map((provider) => [
            provider.providerInstanceId,
            provider.message?.includes('fixture providers only') ?? false,
          ])
          .sort()
      }
      await expect
        .poll(refused, { timeout: 10_000 })
        .toEqual(
          DEFAULT_PROVIDER_INSTANCES.map((provider) => [provider.providerInstanceId, true]).sort(),
        )
      // Probes run in the background after a settings change; give them time to show.
      await new Promise((resolve) => setTimeout(resolve, 1_000))
      expect(existsSync(calls)).toBe(false)
    } finally {
      await server.stop()
    }
  }, 60_000)
})
