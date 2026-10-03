import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createClaudeUsageLifecycleFixture } from '../../../test/factories/claude-usage-lifecycle'

const fixtures: Awaited<ReturnType<typeof createClaudeUsageLifecycleFixture>>[] = []
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.close()
})

const transports = [
  { name: 'direct native OAuth', env: {}, auth: 'oauth', accepted: true },
  {
    name: 'gateway transport despite OAuth-shaped init',
    env: { ANTHROPIC_BASE_URL: 'https://gateway.example.test' },
    auth: 'oauth',
    accepted: false,
  },
  {
    name: 'API-key transport',
    env: { ANTHROPIC_API_KEY: 'synthetic-fixture-key' },
    auth: 'apiKey',
    accepted: false,
  },
  {
    name: 'token transport despite OAuth-shaped init',
    env: { ANTHROPIC_AUTH_TOKEN: 'synthetic-fixture-token' },
    auth: 'oauth',
    accepted: false,
  },
  { name: 'unattributed pre-init frame', env: {}, auth: null, accepted: false },
]

describe('native Claude usage subscription lifecycle', () => {
  it('rejects an old runtime epoch before the usage subscription sees numeric quota', async () => {
    const f = await createClaudeUsageLifecycleFixture()
    fixtures.push(f)
    const before = await f.store.read()
    f.init('oauth')
    await f.rateLimit()
    const held = await f.store.read()
    const binding = f.directory.getBinding(f.input.sessionId)!
    f.directory.upsert({ ...binding, runtimeEpoch: 'fixture-replaced-epoch' })
    await f.rateLimit({ rateLimitType: 'five_hour', status: 'allowed', utilization: 0.41 })
    expect(await f.store.read()).toEqual(held)
    expect(f.events.filter((event) => event.type === 'account.rate-limits.updated')).toHaveLength(1)
    expect(
      held.accounts.find((account) => account.providerInstanceIds.includes(f.providerInstanceId))!
        .windows[0]!.observedAt,
    ).toBe(f.observedAt)
    expect(
      held.accounts.find((account) => account.providerInstanceIds.includes(f.otherId)),
    ).toEqual(before.accounts.find((account) => account.providerInstanceIds.includes(f.otherId)))
    f.directory.upsert(binding)
  })

  it('rejects numeric passive quota after the effective home credential generation changes', async () => {
    const f = await createClaudeUsageLifecycleFixture()
    fixtures.push(f)
    const before = await f.store.read()
    const other = before.accounts.find((account) =>
      account.providerInstanceIds.includes(f.otherId),
    )!
    const generation = f.registry.usageAccount(f.providerInstanceId)!.credentialFingerprint
    await writeFile(
      path.join(f.configDir, '.credentials.json'),
      'synthetic-new-credential-generation',
    )
    expect(f.registry.usageAccount(f.providerInstanceId)!.credentialFingerprint).not.toBe(
      generation,
    )
    f.init('oauth')
    await f.rateLimit({ rateLimitType: 'five_hour', status: 'allowed', utilization: 0.41 })
    const after = await f.store.read()
    expect(
      after.accounts.find((account) => account.providerInstanceIds.includes(f.providerInstanceId))!
        .windows,
    ).toEqual([])
    expect(f.events.filter((event) => event.type === 'account.rate-limits.updated')).toHaveLength(1)
    expect(after.accounts.find((account) => account.accountKey === other.accountKey)).toEqual(other)
  })

  it.each(transports)(
    'retains genuine status-only quota age for $name through actual adapter and ProviderService',
    async ({ env, auth, accepted }) => {
      const f = await createClaudeUsageLifecycleFixture(env)
      fixtures.push(f)
      const before = await f.store.read()
      const native = before.accounts.find((account) =>
        account.providerInstanceIds.includes(f.providerInstanceId),
      )!
      const other = before.accounts.find((account) =>
        account.providerInstanceIds.includes(f.otherId),
      )!
      expect(native.windows[0]).toMatchObject({
        usedPercent: 23,
        observedAt: f.observedAt,
        source: 'claude-local-cache',
        status: null,
      })
      if (auth) f.init(auth)
      await f.rateLimit()
      const after = await f.store.read()
      const current = after.accounts.find((account) => account.accountKey === native.accountKey)!
      expect(current.windows[0]).toMatchObject({
        usedPercent: 23,
        observedAt: f.observedAt,
        source: 'claude-local-cache',
        status: accepted ? 'allowed' : null,
      })
      expect(f.events.filter((event) => event.type === 'account.rate-limits.updated')).toHaveLength(
        accepted ? 1 : 0,
      )
      expect(after.accounts.find((account) => account.accountKey === other.accountKey)).toEqual(
        other,
      )
    },
  )

  it.each(transports)(
    'attributes genuine utilization for $name through actual adapter and ProviderService',
    async ({ env, auth, accepted }) => {
      const f = await createClaudeUsageLifecycleFixture(env)
      fixtures.push(f)
      const before = await f.store.read()
      const native = before.accounts.find((account) =>
        account.providerInstanceIds.includes(f.providerInstanceId),
      )!
      const other = before.accounts.find((account) =>
        account.providerInstanceIds.includes(f.otherId),
      )!
      if (auth) f.init(auth)
      await f.rateLimit({ rateLimitType: 'five_hour', status: 'allowed', utilization: 0.41 })
      const after = await f.store.read()
      const current = after.accounts.find((account) => account.accountKey === native.accountKey)!
      const observations = f.events.filter((event) => event.type === 'account.rate-limits.updated')
      expect(observations).toHaveLength(accepted ? 1 : 0)
      if (accepted) {
        expect(current.windows[0]).toMatchObject({
          usedPercent: 41,
          observedAt: observations[0]!.createdAt,
          source: 'rate-limit-event',
          status: 'allowed',
          freshness: 'fresh',
        })
        expect(current.windows[0]!.observedAt).not.toBe(f.observedAt)
      } else {
        expect(current).toEqual(native)
      }
      expect(after.accounts.find((account) => account.accountKey === other.accountKey)).toEqual(
        other,
      )
    },
  )
})
