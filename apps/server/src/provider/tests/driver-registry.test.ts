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
import { MOCK_DRIVER_KIND, mockDriver } from '../drivers/mock'
import { ProviderAdapterRegistry } from '../provider-adapter-registry'
import { ProviderStatusCache } from '../status-cache'

const WORK = v.parse(providerInstanceIdSchema, 'mock-work')
const PERSONAL = v.parse(providerInstanceIdSchema, 'mock-personal')
const roots: string[] = []
const registries: ProviderAdapterRegistry[] = []

afterEach(async () => {
  await Promise.all(registries.splice(0).map((registry) => registry.dispose()))
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

describe('provider driver registry', () => {
  it('lists import-capable instances with default or explicit enablement and excludes disabled instances', async () => {
    const registry = new ProviderAdapterRegistry({
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
