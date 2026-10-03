import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  DEFAULT_RUNTIME_MODE,
  providerDriverKindSchema,
  providerInstanceIdSchema,
  sessionIdSchema,
  type ProviderInstanceId,
} from '@workspace/contracts'
import * as v from 'valibot'
import { afterEach, describe, expect, it } from 'vitest'
import { createInternalError } from '../../observability/structured-errors'
import type { MockProviderAdapter } from '../adapters/mock'
import type { ProviderInstanceConfig } from '../driver'
import type { ProviderRuntimeStartInput } from '../types'
import { claudeDriver } from '../drivers/claude'
import { codexDriver } from '../drivers/codex'
import { MOCK_DRIVER_KIND, mockDriver } from '../drivers/mock'
import { ProviderAdapterRegistry } from '../provider-adapter-registry'
import { ProviderStatusCache } from '../status-cache'
import { resolveProviderInstanceEnvironment } from '../utils/instance-environment'

const WORK = v.parse(providerInstanceIdSchema, 'mock-work')
const PERSONAL = v.parse(providerInstanceIdSchema, 'mock-personal')
const roots: string[] = []
const registries: ProviderAdapterRegistry[] = []

afterEach(async () => {
  await Promise.all(registries.splice(0).map((registry) => registry.dispose()))
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

describe('provider driver registry', () => {
  it('hands the explicit execution cwd unchanged to each driver instance', async () => {
    const cwd = await fixtureRoot()
    const received: string[] = []
    const registry = new ProviderAdapterRegistry({
      services: { cwd },
      drivers: [
        {
          ...mockDriver,
          create: async (input) => {
            received.push(input.services.cwd)
            return mockDriver.create(input)
          },
        },
      ],
    })
    registries.push(registry)

    await registry.reconcile([instance(WORK, {}), instance(PERSONAL, {})])

    expect(received).toEqual([cwd, cwd])
  })

  it('lists import-capable instances with default or explicit enablement and excludes disabled instances', async () => {
    const registry = new ProviderAdapterRegistry({
      services: { cwd: process.cwd() },
      drivers: [
        {
          ...mockDriver,
          create: async (input) => {
            const handle = await mockDriver.create(input)
            Object.assign(handle.adapter, {
              discoverSessions: async () => [],
              readSessionHistory: async () => [],
            })
            return handle
          },
        },
      ],
    })
    registries.push(registry)
    await registry.reconcile([
      { driverKind: MOCK_DRIVER_KIND, providerInstanceId: WORK },
      { driverKind: MOCK_DRIVER_KIND, providerInstanceId: PERSONAL, enabled: true },
    ])
    expect(registry.importSources().map((source) => source.providerInstanceId)).toEqual([
      WORK,
      PERSONAL,
    ])

    await registry.reconcile([
      { driverKind: MOCK_DRIVER_KIND, providerInstanceId: WORK, enabled: false },
      { driverKind: MOCK_DRIVER_KIND, providerInstanceId: PERSONAL, enabled: true },
    ])
    expect(registry.importSources().map((source) => source.providerInstanceId)).toEqual([PERSONAL])
  })

  it('keeps two instances of one driver isolated', async () => {
    const home = await fixtureRoot()
    const registry = createRegistry()
    await registry.reconcile([
      instance(WORK, { credentialsPath: path.join(home, 'work.json') }),
      instance(PERSONAL, { credentialsPath: path.join(home, 'personal.json') }),
    ])

    const work = adapterFor(registry, WORK)
    const personal = adapterFor(registry, PERSONAL)
    await writeFile(path.join(home, 'work.json'), 'work@example.com')
    await work.startRuntime(sessionInput(WORK))

    expect(work).not.toBe(personal)
    expect(work.env.PLATFORM_MOCK_CREDENTIALS).toBe(path.join(home, 'work.json'))
    expect(personal.env.PLATFORM_MOCK_CREDENTIALS).toBe(path.join(home, 'personal.json'))
    // The session started on one account is invisible to the other.
    expect(await work.hasRuntime({ sessionId: sessionId() })).toBe(true)
    expect(await personal.hasRuntime({ sessionId: sessionId() })).toBe(false)
    expect(await registry.refreshSnapshot(WORK)).toMatchObject({
      auth: { label: 'work@example.com', status: 'authenticated' },
      displayLabel: 'mock-work',
      providerInstanceId: WORK,
    })
    expect(await registry.refreshSnapshot(PERSONAL)).toMatchObject({
      auth: { status: 'unauthenticated' },
      providerInstanceId: PERSONAL,
    })
  })

  it('reconciles a settings change into live instances without a restart', async () => {
    const home = await fixtureRoot()
    const registry = createRegistry()
    await registry.reconcile([instance(WORK, { credentialsPath: path.join(home, 'work.json') })])
    const work = adapterFor(registry, WORK)
    await work.startRuntime(sessionInput(WORK))

    await registry.reconcile([
      instance(WORK, { credentialsPath: path.join(home, 'work.json') }),
      instance(PERSONAL, { credentialsPath: path.join(home, 'personal.json') }),
    ])

    // An untouched entry keeps its adapter, so its running sessions survive.
    expect(adapterFor(registry, WORK)).toBe(work)
    expect(await work.hasRuntime({ sessionId: sessionId() })).toBe(true)
    expect(registry.listInstances()).toEqual([WORK, PERSONAL])

    await registry.reconcile([instance(PERSONAL, { credentialsPath: path.join(home, 'p.json') })])

    expect(registry.listInstances()).toEqual([PERSONAL])
    expect(registry.adapter(WORK)).toBeNull()
    // Removal disposes the instance, which stops everything it was running.
    expect(await work.hasRuntime({ sessionId: sessionId() })).toBe(false)
  })

  it('keeps an adapter when only provider config key order changes', async () => {
    const home = await fixtureRoot()
    const credentialsPath = path.join(home, 'work.json')
    const registry = createRegistry()
    await registry.reconcile([instance(WORK, { credentialsPath, responseText: 'same' })])
    const before = adapterFor(registry, WORK)

    await registry.reconcile([instance(WORK, { responseText: 'same', credentialsPath })])

    expect(adapterFor(registry, WORK)).toBe(before)
  })

  it('rebuilds an instance whose config changed', async () => {
    const home = await fixtureRoot()
    const registry = createRegistry()
    await registry.reconcile([instance(WORK, { credentialsPath: path.join(home, 'a.json') })])
    const before = adapterFor(registry, WORK)

    await registry.reconcile([instance(WORK, { credentialsPath: path.join(home, 'b.json') })])
    const after = adapterFor(registry, WORK)

    expect(after).not.toBe(before)
    expect(after.env.PLATFORM_MOCK_CREDENTIALS).toBe(path.join(home, 'b.json'))
  })

  it('reflects an out-of-band credential change within seconds', async () => {
    const home = await fixtureRoot()
    const credentialsPath = path.join(home, 'work.json')
    const registry = createRegistry()
    await registry.reconcile([instance(WORK, { credentialsPath })])
    const changes: ProviderInstanceId[][] = []
    registry.subscribeChanges((change) => {
      changes.push(change.providerInstanceIds)
    })

    expect(await registry.snapshot(WORK)).toMatchObject({ auth: { status: 'unauthenticated' } })
    await writeFile(credentialsPath, 'signed-in@example.com')
    await waitFor(async () => {
      const snapshot = await registry.snapshot(WORK)
      return snapshot.auth.status === 'authenticated'
    })

    expect(await registry.snapshot(WORK)).toMatchObject({
      auth: { label: 'signed-in@example.com', status: 'authenticated' },
    })
    expect(changes).toContainEqual([WORK])
  })

  it('surfaces an entry whose driver this build does not ship as unavailable', async () => {
    const registry = createRegistry()
    await registry.reconcile([
      instance(WORK, {}),
      {
        driverKind: v.parse(providerDriverKindSchema, 'opencode'),
        providerInstanceId: v.parse(providerInstanceIdSchema, 'opencode'),
      },
    ])

    const { providers } = await registry.listProviders()

    expect(registry.listInstances()).toEqual([WORK])
    expect(providers).toContainEqual(
      expect.objectContaining({
        availability: 'unavailable',
        message: "Driver 'opencode' is not registered.",
        providerInstanceId: 'opencode',
      }),
    )
  })

  it('keeps the last known model list when a probe comes back empty', async () => {
    const registry = createRegistry()
    await registry.reconcile([instance(WORK, {})])
    const good = await registry.refreshSnapshot(WORK)
    adapterFor(registry, WORK).probeError = 'codex model list failed'

    expect(await registry.refreshSnapshot(WORK)).toMatchObject({
      message: 'codex model list failed',
      models: good.models,
      status: 'error',
    })
  })
})

describe.each([
  {
    driver: claudeDriver,
    configKey: 'configDir',
    envKey: 'CLAUDE_CONFIG_DIR',
    directory: '.claude',
    file: '.credentials.json',
  },
  {
    driver: codexDriver,
    configKey: 'home',
    envKey: 'CODEX_HOME',
    directory: '.codex',
    file: 'auth.json',
  },
])('$driver.driverKind credential paths', ({ driver, configKey, envKey, directory, file }) => {
  it('observes the credential home derived from driver config', async () => {
    const root = await fixtureRoot()
    const home = path.join(root, 'configured')
    const config = driver.parseConfig({ [configKey]: home })
    const env = resolveProviderInstanceEnvironment({
      base: { HOME: root },
      derived: driver.environment(config, WORK),
    })

    expect(driver.credentialPaths({ config, env })).toEqual([path.join(home, file)])
  })

  it('observes explicit environment overrides of driver config', async () => {
    const root = await fixtureRoot()
    const home = path.join(root, 'effective')
    const config = driver.parseConfig({ [configKey]: path.join(root, 'configured') })
    const env = resolveProviderInstanceEnvironment({
      base: { HOME: root },
      derived: driver.environment(config, WORK),
      overrides: [{ name: envKey, value: home }],
    })

    expect(driver.credentialPaths({ config, env })).toEqual([path.join(home, file)])
  })

  it('uses the effective HOME for the native default credential directory', async () => {
    const root = await fixtureRoot()
    const config = driver.defaultConfig()
    const env = resolveProviderInstanceEnvironment({
      base: { HOME: root },
      derived: driver.environment(config, WORK),
    })

    expect(driver.credentialPaths({ config, env })).toEqual([path.join(root, directory, file)])
  })

  it('isolates effective account homes and fingerprints across registries', async () => {
    const root = await fixtureRoot()
    const configured = path.join(root, 'configured')
    const work = path.join(root, 'work')
    const personal = path.join(root, 'personal')
    await Promise.all([configured, work, personal].map((home) => mkdir(home)))
    await Promise.all(
      [configured, work, personal].map((home) => writeFile(path.join(home, file), 'fixture')),
    )
    const first = new ProviderAdapterRegistry({ services: { cwd: root }, drivers: [driver] })
    const second = new ProviderAdapterRegistry({ services: { cwd: root }, drivers: [driver] })
    registries.push(first, second)
    await first.reconcile([
      {
        providerInstanceId: WORK,
        driverKind: driver.driverKind,
        config: { [configKey]: configured },
        environment: [{ name: envKey, value: work }],
      },
    ])
    await second.reconcile([
      {
        providerInstanceId: WORK,
        driverKind: driver.driverKind,
        config: { [configKey]: configured },
        environment: [{ name: envKey, value: personal }],
      },
    ])
    expect(first.updateTarget(WORK).env[envKey]).toBe(work)
    expect(second.updateTarget(WORK).env[envKey]).toBe(personal)
    const workAccount = first.usageAccount(WORK)
    const personalAccount = second.usageAccount(WORK)
    expect(workAccount).not.toBeNull()
    expect(personalAccount).not.toBeNull()
    expect(workAccount?.accountKey).not.toBe(personalAccount?.accountKey)

    await writeFile(path.join(configured, file), 'changed configured fixture')
    expect(first.usageAccount(WORK)).toEqual(workAccount)
    expect(second.usageAccount(WORK)).toEqual(personalAccount)
    await writeFile(path.join(work, file), 'changed effective fixture')
    expect(first.usageAccount(WORK)?.accountKey).toBe(workAccount?.accountKey)
    expect(first.usageAccount(WORK)?.credentialFingerprint).not.toBe(
      workAccount?.credentialFingerprint,
    )
    expect(second.usageAccount(WORK)).toEqual(personalAccount)
  })
})

describe('provider status cache', () => {
  it('hydrates a cold process from disk and refuses a mismatched identity', async () => {
    const directory = await fixtureRoot()
    const registry = createRegistry(new ProviderStatusCache({ directory }))
    await registry.reconcile([instance(WORK, {})])
    const written = await registry.refreshSnapshot(WORK)

    const cold = new ProviderStatusCache({ directory })

    expect(cold.hydrate(WORK, MOCK_DRIVER_KIND)).toMatchObject({
      providerInstanceId: WORK,
      version: written.version,
    })
    expect(cold.hydrate(WORK, v.parse(providerDriverKindSchema, 'codex'))).toBeNull()
    expect(cold.hydrate(PERSONAL, MOCK_DRIVER_KIND)).toBeNull()
    expect(await readdir(directory)).toEqual([`${WORK}.json`])
  })

  it('seeds the first registry read on boot while the live probe refreshes behind it', async () => {
    const directory = await fixtureRoot()
    const warm = createRegistry(new ProviderStatusCache({ directory }))
    await warm.reconcile([instance(WORK, {})])
    const written = await warm.refreshSnapshot(WORK)
    await warm.dispose()

    const cold = createRegistry(new ProviderStatusCache({ directory }))
    await cold.reconcile([instance(WORK, {})])
    adapterFor(cold, WORK).probeError = 'Fixture probe failure'

    expect(await cold.snapshot(WORK)).toMatchObject({
      status: 'ready',
      checkedAt: written.checkedAt,
    })
    await expect.poll(async () => (await cold.snapshot(WORK)).status).toBe('error')
  })

  it.each(['replacement', 'removed-id', 'new-id'])(
    'probes a live %s before returning persisted state',
    async (change) => {
      const directory = await fixtureRoot()
      const registry = createRegistry(new ProviderStatusCache({ directory }))
      await registry.reconcile([{ ...instance(WORK, {}), displayLabel: 'Original fixture' }])
      await registry.refreshSnapshot(WORK)
      if (change !== 'replacement') await registry.reconcile([])
      if (change === 'new-id') {
        const seed = createRegistry(new ProviderStatusCache({ directory }))
        await seed.reconcile([instance(PERSONAL, {})])
        await seed.refreshSnapshot(PERSONAL)
        await seed.dispose()
      }
      const id = change === 'new-id' ? PERSONAL : WORK

      await registry.reconcile([{ ...instance(id, {}), displayLabel: 'Live fixture' }])

      expect(await registry.snapshot(id)).toMatchObject({ displayLabel: 'Live fixture' })
    },
  )

  it('releases cache invalidation after failed creation and probes its later replacement', async () => {
    const directory = await fixtureRoot()
    const cache = new ProviderStatusCache({ directory })
    const registry = createRegistry(cache)
    await registry.reconcile([instance(WORK, {})])
    await registry.refreshSnapshot(WORK)

    await registry.reconcile([instance(WORK, { responseText: 42 })])

    expect(registry.adapter(WORK)).toBeNull()
    expect(cache.get(WORK)).toBeNull()
    expect(cache.hydrate(WORK, MOCK_DRIVER_KIND)).toMatchObject({ status: 'ready' })
    expect((await registry.listProviders()).providers).toContainEqual(
      expect.objectContaining({ providerInstanceId: WORK, availability: 'unavailable' }),
    )

    await registry.reconcile([{ ...instance(WORK, {}), displayLabel: 'Recovered fixture' }])

    expect(await registry.snapshot(WORK)).toMatchObject({ displayLabel: 'Recovered fixture' })
  })

  it('removes its temp file when the snapshot cannot replace the target', async () => {
    const directory = await fixtureRoot()
    await mkdir(path.join(directory, `${WORK}.json`))
    const registry = createRegistry(new ProviderStatusCache({ directory }))
    await registry.reconcile([instance(WORK, {})])

    await registry.refreshSnapshot(WORK)

    expect(await readdir(directory)).toEqual([`${WORK}.json`])
  })
})

describe('provider registry change stream', () => {
  it('yields registry changes in order until its signal aborts', async () => {
    const registry = createRegistry()
    const controller = new AbortController()
    const changes = registry.streamChanges(controller.signal)[Symbol.asyncIterator]()
    const first = changes.next()

    await registry.reconcile([instance(WORK, {})])
    await registry.reconcile([instance(WORK, {}), instance(PERSONAL, {})])

    expect(await first).toEqual({
      done: false,
      value: { providerInstanceIds: [WORK], type: 'providers.changed' },
    })
    expect(await changes.next()).toEqual({
      done: false,
      value: { providerInstanceIds: [WORK, PERSONAL], type: 'providers.changed' },
    })

    controller.abort()
    expect(await changes.next()).toEqual({ done: true, value: undefined })
  })

  it('releases every consumer parked in next() when its signal aborts', async () => {
    const registry = createRegistry()
    const controller = new AbortController()
    const changes = registry.streamChanges(controller.signal)[Symbol.asyncIterator]()
    const parked = changes.next()
    const queued = changes.next()

    controller.abort()

    expect(await Promise.all([parked, queued])).toEqual([
      { done: true, value: undefined },
      { done: true, value: undefined },
    ])
  })

  it('ends at once when its signal is already aborted', async () => {
    const registry = createRegistry()
    const changes = registry.streamChanges(AbortSignal.abort())[Symbol.asyncIterator]()

    expect(await changes.next()).toEqual({ done: true, value: undefined })
  })

  it('ends a parked consumer when the registry is disposed', async () => {
    const registry = createRegistry()
    const changes = registry.streamChanges(new AbortController().signal)[Symbol.asyncIterator]()
    const parked = changes.next()

    await registry.dispose()

    expect(await parked).toEqual({ done: true, value: undefined })
    const late = registry.streamChanges(new AbortController().signal)[Symbol.asyncIterator]()
    expect(await late.next()).toEqual({ done: true, value: undefined })
  })
})

function createRegistry(statusCache?: ProviderStatusCache) {
  const registry = new ProviderAdapterRegistry({
    services: { cwd: process.cwd() },
    drivers: [mockDriver],
    ...(statusCache ? { statusCache } : {}),
  })
  registries.push(registry)

  return registry
}

function adapterFor(registry: ProviderAdapterRegistry, providerInstanceId: ProviderInstanceId) {
  return registry.getByInstance(providerInstanceId) as MockProviderAdapter
}

function instance(
  providerInstanceId: ProviderInstanceId,
  config: Record<string, unknown>,
): ProviderInstanceConfig {
  return {
    config,
    displayLabel: providerInstanceId,
    driverKind: MOCK_DRIVER_KIND,
    providerInstanceId,
  }
}

function sessionInput(providerInstanceId: ProviderInstanceId): ProviderRuntimeStartInput {
  return {
    cwd: '/workspace',
    modelSelection: { model: 'gpt-5.5', providerInstanceId },
    providerInstanceId,
    runtimeMode: DEFAULT_RUNTIME_MODE,
    runtimeEpoch: 'epoch-driver',
    sessionId: sessionId(),
  }
}

function sessionId() {
  return v.parse(sessionIdSchema, 'ee84050b-1b17-5fe8-9f71-0983f1fceccc')
}

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (await predicate()) return
    if (Date.now() > deadline) {
      throw createInternalError('Timed out waiting for provider availability.')
    }

    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

async function fixtureRoot() {
  const root = await mkdtemp(path.join(tmpdir(), 'provider-registry-'))
  roots.push(root)

  return root
}
