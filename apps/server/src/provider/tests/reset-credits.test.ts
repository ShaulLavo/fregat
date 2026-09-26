import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, test, vi } from 'vitest'
import * as v from 'valibot'
import { providerInstanceIdSchema, type ProviderResetCreditOutcome } from '@workspace/contracts'
import { createMetadataDatabase } from '../../db/client'
import { initializePlatformDatabase } from '../../db/initialize'
import { providerResetCreditAttempts } from '../../db/schema'
import { MockProviderAdapter } from '../adapters/mock'
import { ProviderResetCredits } from '../reset-credits'
import { sessionIdentityErrors } from '../structured-errors'
import type { ProviderAdapter } from '../types'

const INSTANCE = v.parse(providerInstanceIdSchema, 'codex-a')
const OTHER = v.parse(providerInstanceIdSchema, 'codex-b')
const ACCOUNT = 'opaque-account'
const START = Date.parse('2026-09-25T10:00:00Z')
const input = {
  accountKey: ACCOUNT,
  checkedAt: new Date(START).toISOString(),
  confirmed: true as const,
  creditId: 'fixture-credit',
}
const cleanups: Array<() => Promise<void> | void> = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

async function fixture(consume: (key: string) => Promise<ProviderResetCreditOutcome>) {
  const root = await mkdtemp(path.join(tmpdir(), 'reset-credit-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  const databasePath = path.join(root, 'fixture.sqlite')
  let handle = createMetadataDatabase({ databasePath })
  initializePlatformDatabase(handle.db)
  const adapter: ProviderAdapter = new MockProviderAdapter()
  const nativeCalls: Array<Parameters<NonNullable<ProviderAdapter['consumeResetCredit']>>[0]> = []
  adapter.consumeResetCredit = (input) => {
    nativeCalls.push(input)
    return consume(input.idempotencyKey)
  }
  const state = {
    enabled: true,
    accountKey: ACCOUNT,
    nativeAccountKey: ACCOUNT,
    splitHomes: false,
    creditId: 'fixture-credit',
    available: 1,
    now: START + 1000,
  }
  adapter.readUsage = async () => ({
    kind: 'reading',
    update: { planType: 'pro', windows: [] },
    resetCredits: {
      available: state.available,
      accountKey: state.nativeAccountKey,
      creditId: state.creditId,
    },
  })
  const registry = {
    adapter: () => adapter,
    usageAccount: (instance: typeof INSTANCE) => ({
      accountKey: state.splitHomes && instance === OTHER ? 'different-home' : state.accountKey,
      driverKind: adapter.driverKind,
      enabled: state.enabled,
    }),
  }
  const usage = { read: async () => ({ accounts: [] }), refreshAccount: vi.fn(async () => true) }
  let service = new ProviderResetCredits(handle.db, registry, usage, () => state.now)
  cleanups.push(() => {
    service.close()
    handle.close()
  })
  return {
    get service() {
      return service
    },
    state,
    nativeCalls,
    usage,
    adapter,
    rows: () => handle.db.select().from(providerResetCreditAttempts).all(),
    restart() {
      service.close()
      handle.close()
      handle = createMetadataDatabase({ databasePath })
      initializePlatformDatabase(handle.db)
      service = new ProviderResetCredits(handle.db, registry, usage, () => state.now)
    },
  }
}

test('two instances sharing an account consume only once and both receive the result', async () => {
  let release!: (result: ProviderResetCreditOutcome) => void
  const consume = vi.fn(
    () =>
      new Promise<ProviderResetCreditOutcome>((resolve) => {
        release = resolve
      }),
  )
  const f = await fixture(consume)
  const first = f.service.redeem(INSTANCE, input)
  const second = f.service.redeem(OTHER, input)
  await vi.waitFor(() => expect(consume).toHaveBeenCalledTimes(1))
  release('reset')
  expect(await first).toMatchObject({ outcome: 'reset', refresh: 'confirmed' })
  expect(await second).toMatchObject({ outcome: 'reset', refresh: 'confirmed' })
  expect(consume).toHaveBeenCalledTimes(1)
})

test('an ambiguous timeout survives restart and reuses the native idempotency key', async () => {
  const keys: string[] = []
  const spent = new Set<string>()
  const f = await fixture(async (key) => {
    keys.push(key)
    if (spent.has(key)) return 'alreadyRedeemed'
    spent.add(key)
    throw new Error('native transport closed after spending; secret-account-id')
  })
  await expect(f.service.redeem(INSTANCE, input)).rejects.toThrow(
    'The reset outcome is unconfirmed',
  )
  expect(f.rows()[0]?.outcome).toBeNull()
  f.restart()
  expect(await f.service.redeem(OTHER, input)).toMatchObject({
    outcome: 'alreadyRedeemed',
    refresh: 'confirmed',
  })
  expect(keys).toHaveLength(2)
  expect(keys[0]).toBe(keys[1])
  expect(spent.size).toBe(1)
  f.restart()
  await f.service.redeem(INSTANCE, input)
  expect(keys).toHaveLength(2)
})

test('a declined attempt is cleared so the next confirmation can redeem', async () => {
  const keys: string[] = []
  const f = await fixture(async (key) => {
    keys.push(key)
    if (keys.length === 1)
      throw sessionIdentityErrors.RESET_CREDIT_REJECTED({ reason: 'Fixture declined the credit.' })
    return 'reset'
  })
  await expect(f.service.redeem(INSTANCE, input)).rejects.toThrow('Fixture declined the credit.')
  expect(f.rows()).toHaveLength(0)
  expect(await f.service.redeem(INSTANCE, input)).toMatchObject({ outcome: 'reset' })
  expect(keys).toHaveLength(2)
  expect(keys[0]).not.toBe(keys[1])
})

test('a refresh failure preserves the settled outcome and retry cannot spend again', async () => {
  const consume = vi.fn(async (_key: string) => 'reset' as const)
  const f = await fixture(consume)
  f.usage.refreshAccount.mockRejectedValueOnce(new Error('probe failed'))
  expect(await f.service.redeem(INSTANCE, input)).toMatchObject({
    outcome: 'reset',
    refresh: 'unconfirmed',
  })
  expect(await f.service.redeem(OTHER, input)).toMatchObject({
    outcome: 'reset',
    refresh: 'confirmed',
  })
  expect(consume).toHaveBeenCalledTimes(1)
})

test('disabled, unsupported and changed accounts reject before calling the provider', async () => {
  const consume = vi.fn(async (_key: string) => 'reset' as const)
  const f = await fixture(consume)
  f.state.enabled = false
  await expect(f.service.redeem(INSTANCE, input)).rejects.toThrow('unavailable')
  f.state.enabled = true
  f.state.nativeAccountKey = 'another-account'
  await expect(f.service.redeem(INSTANCE, input)).rejects.toThrow('account changed')
  f.state.nativeAccountKey = ACCOUNT
  f.adapter.consumeResetCredit = undefined
  await expect(f.service.redeem(INSTANCE, input)).rejects.toThrow('unavailable')
  expect(consume).not.toHaveBeenCalled()
  expect(f.rows()).toEqual([])
})

test('a new confirmation after settlement can create a distinct attempt', async () => {
  const consume = vi.fn(async (_key: string) => 'noCredit' as const)
  const f = await fixture(consume)
  await f.service.redeem(INSTANCE, input)
  f.state.now += 5000
  await f.service.redeem(INSTANCE, {
    ...input,
    checkedAt: new Date(f.state.now - 1000).toISOString(),
  })
  expect(consume).toHaveBeenCalledTimes(2)
  expect(consume.mock.calls[0]?.[0]).not.toBe(consume.mock.calls[1]?.[0])
})

test('refuses an account switch inside the same credential home before consuming', async () => {
  const consume = vi.fn(async (_key: string) => 'reset' as const)
  const f = await fixture(consume)
  f.state.nativeAccountKey = 'new-native-account'
  await expect(f.service.redeem(INSTANCE, input)).rejects.toThrow()
  expect(consume).not.toHaveBeenCalled()
})

test('two homes with the same verified account join one native attempt', async () => {
  const consume = vi.fn(async (_key: string) => 'reset' as const)
  const f = await fixture(consume)
  f.state.splitHomes = true
  const outcomes = await Promise.all([
    f.service.redeem(INSTANCE, input),
    f.service.redeem(OTHER, input),
  ])
  expect(outcomes.map((result) => result.outcome)).toEqual(['reset', 'reset'])
  expect(consume).toHaveBeenCalledTimes(1)
})

test('malformed confirmation timestamps never reach the provider', async () => {
  const consume = vi.fn(async (_key: string) => 'reset' as const)
  const f = await fixture(consume)
  await expect(f.service.redeem(INSTANCE, { ...input, checkedAt: 'z' })).rejects.toThrow()
  await expect(f.service.redeem(INSTANCE, { ...input, checkedAt: 'z' })).rejects.toThrow()
  expect(consume).not.toHaveBeenCalled()
})

test('timezone-equivalent confirmations cannot create a second reset', async () => {
  const consume = vi.fn(async (_key: string) => 'reset' as const)
  const f = await fixture(consume)
  await f.service.redeem(INSTANCE, input)
  await f.service.redeem(OTHER, { ...input, checkedAt: '2026-09-25T12:00:00.000+02:00' })
  expect(consume).toHaveBeenCalledTimes(1)
})

test('restart retries preserve the confirmed credit when the provider advertises another', async () => {
  let calls = 0
  const f = await fixture(async () => {
    calls += 1
    if (calls === 1) throw new Error('fixture timeout after native consumption')
    return 'alreadyRedeemed'
  })
  await expect(f.service.redeem(INSTANCE, input)).rejects.toThrow('unconfirmed')
  f.restart()
  f.state.creditId = 'newly-advertised-credit'
  f.state.available = 0
  await f.service.redeem(OTHER, { ...input, creditId: 'newly-advertised-credit' })
  expect(f.nativeCalls).toHaveLength(2)
  expect(f.nativeCalls[1]).toEqual(f.nativeCalls[0])
  expect(f.nativeCalls[1]?.creditId).toBe('fixture-credit')
})
