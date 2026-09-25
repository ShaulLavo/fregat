import path from 'node:path'
import {
  providerInstanceIdSchema,
  sessionIdSchema,
  type ProviderInstanceId,
  type ProviderUsageWindow,
} from '@workspace/contracts'
import * as v from 'valibot'
import { afterEach, describe, expect, it } from 'vitest'
import { createInternalError } from '../../observability/structured-errors'
import { MOCK_DRIVER_KIND, mockDriver } from '../drivers/mock'
import { ProviderAdapterRegistry } from '../provider-adapter-registry'
import type { ProviderRuntimeEvent } from '../types'
import { ProviderUsageStore } from '../usage-store'
import type { ProviderUsageProbe, ProviderUsageReading } from '../utils/usage-windows'

const WORK = v.parse(providerInstanceIdSchema, 'mock-work')
const WORK_AGAIN = v.parse(providerInstanceIdSchema, 'mock-work-again')
const PERSONAL = v.parse(providerInstanceIdSchema, 'mock-personal')
const HOME = path.join('/nonexistent', 'usage-store')
const START_MS = Date.parse('2026-09-24T10:00:00.000Z')
const registries: ProviderAdapterRegistry[] = []

afterEach(async () => {
  await Promise.all(registries.splice(0).map((registry) => registry.dispose()))
})

describe('provider usage store', () => {
  it('shares one meter between instances on the same credentials', async () => {
    const { store } = await usageFixture()
    store.accept(limitsEvent(WORK, [window('five_hour', 40)]))
    store.accept(limitsEvent(WORK_AGAIN, [window('seven_day', 70)]))
    store.accept(limitsEvent(PERSONAL, [window('five_hour', 5)]))

    const { accounts } = await store.read()
    expect(accounts).toHaveLength(2)
    expect(accounts[0]).toMatchObject({
      driverKind: MOCK_DRIVER_KIND,
      providerInstanceIds: [WORK, WORK_AGAIN],
      windows: [
        { id: 'five_hour', usedPercent: 40 },
        { id: 'seven_day', usedPercent: 70 },
      ],
    })
    expect(accounts[1]).toMatchObject({
      providerInstanceIds: [PERSONAL],
      windows: [{ id: 'five_hour', usedPercent: 5 }],
    })
    expect(accounts[0]?.accountKey).not.toContain(HOME)
  })

  it('probes once per account while fresh, replacing what the events built', async () => {
    const fixture = await usageFixture()
    const calls = stubUsage(fixture.registry, WORK, async () => reading([window('seven_day', 12)]))
    fixture.store.accept(limitsEvent(WORK, [window('five_hour', 40)]))

    await fixture.store.read()
    await fixture.store.read()
    const { accounts } = await fixture.store.read()

    expect(calls.count).toBe(1)
    expect(accounts[0]?.windows).toEqual([expect.objectContaining({ id: 'seven_day' })])

    fixture.clock.ms += 5 * 60_000
    await fixture.store.read()
    expect(calls.count).toBe(2)
  })

  it('keeps the known windows when a probe fails', async () => {
    const fixture = await usageFixture()
    stubUsage(fixture.registry, WORK, async () => {
      throw createInternalError('probe failed')
    })
    fixture.store.accept(limitsEvent(WORK, [window('five_hour', 40)]))

    expect((await fixture.store.read()).accounts[0]?.windows).toEqual([
      expect.objectContaining({ id: 'five_hour', usedPercent: 40 }),
    ])
  })

  it('shows nothing for an account without plan limits, events included', async () => {
    const fixture = await usageFixture()
    stubUsage(fixture.registry, PERSONAL, async () => ({ kind: 'unsupported' }))
    await fixture.store.read()
    fixture.store.accept(limitsEvent(PERSONAL, [window('five_hour', 5)]))

    expect((await fixture.store.read()).accounts).toEqual([])
  })

  it('drops a window once its reset has passed', async () => {
    const fixture = await usageFixture()
    const resetsAt = new Date(START_MS + 60_000).toISOString()
    fixture.store.accept(limitsEvent(PERSONAL, [{ ...window('five_hour', 100), resetsAt }]))
    expect((await fixture.store.read()).accounts).toHaveLength(1)

    fixture.clock.ms += 2 * 60_000
    expect((await fixture.store.read()).accounts).toEqual([])
  })

  it('drops the meter of an instance that settings removed', async () => {
    const { registry, store } = await usageFixture()
    store.accept(limitsEvent(PERSONAL, [window('five_hour', 5)]))
    await registry.reconcile([instance(WORK, 'work.json')])

    expect((await store.read()).accounts).toEqual([])
  })
})

async function usageFixture() {
  const registry = new ProviderAdapterRegistry({ drivers: [mockDriver] })
  registries.push(registry)
  await registry.reconcile([
    instance(WORK, 'work.json'),
    instance(WORK_AGAIN, 'work.json'),
    instance(PERSONAL, 'personal.json'),
  ])
  const clock = { ms: START_MS }

  return { clock, registry, store: new ProviderUsageStore(registry, { now: () => clock.ms }) }
}

/** The mock driver reads no plan; a test gives one instance a `readUsage` of its own. */
function stubUsage(
  registry: ProviderAdapterRegistry,
  providerInstanceId: ProviderInstanceId,
  readUsage: () => Promise<ProviderUsageProbe>,
) {
  const calls = { count: 0 }
  Object.assign(registry.getByInstance(providerInstanceId), {
    readUsage: () => {
      calls.count += 1
      return readUsage()
    },
  })

  return calls
}

function reading(windows: ProviderUsageReading[]): ProviderUsageProbe {
  return { kind: 'reading', update: { planType: 'max', windows } }
}

function instance(providerInstanceId: ProviderInstanceId, credentials: string) {
  return {
    config: { credentialsPath: path.join(HOME, credentials) },
    displayLabel: providerInstanceId,
    driverKind: MOCK_DRIVER_KIND,
    providerInstanceId,
  }
}

function window(id: string, usedPercent: number): ProviderUsageWindow {
  return {
    id,
    kind: id === 'five_hour' ? 'session' : 'weekly',
    label: id,
    resetsAt: null,
    status: 'allowed',
    usedPercent,
    windowMinutes: id === 'five_hour' ? 300 : 10_080,
  }
}

function limitsEvent(
  providerInstanceId: ProviderInstanceId,
  windows: ProviderUsageWindow[],
): ProviderRuntimeEvent {
  return {
    createdAt: new Date(START_MS).toISOString(),
    eventId: `limits-${providerInstanceId}`,
    payload: { planType: null, windows },
    providerInstanceId,
    runtimeEpoch: 'epoch-1',
    sessionId: v.parse(sessionIdSchema, 'ee84050b-1b17-5fe8-9f71-0983f1fceccc'),
    type: 'account.rate-limits.updated',
  }
}
