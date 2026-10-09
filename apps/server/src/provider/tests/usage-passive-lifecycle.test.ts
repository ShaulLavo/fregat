import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createClaudeUsageLifecycleFixture } from '../../../test/factories/claude-usage-lifecycle'

const fixtures: Awaited<ReturnType<typeof createClaudeUsageLifecycleFixture>>[] = []
afterEach(async () => {
  for (const fixture of fixtures.splice(0)) await fixture.close()
})

const nativeTransports: {
  name: string
  env: Record<string, string>
  auth: string | null
  accepted: boolean
}[] = [
  { name: 'direct native OAuth with current none init', env: {}, auth: 'none', accepted: true },
]
const transports = nativeTransports.concat(
  [
    'CLAUDE_CODE_USE_BEDROCK',
    'CLAUDE_CODE_USE_VERTEX',
    'CLAUDE_CODE_USE_FOUNDRY',
    'CLAUDE_CODE_USE_ANTHROPIC_AWS',
    'CLAUDE_CODE_USE_ANTHROPIC_GOOGLE_CLOUD',
    'CLAUDE_CODE_USE_MANTLE',
    'CLAUDE_CODE_USE_GATEWAY',
  ].map((name, index) => ({
    name,
    env: { [name]: ['1', 'true', 'yes', 'on'][index % 4]! },
    auth: 'none',
    accepted: false,
  })),
  [
    {
      name: 'gateway transport with current none init',
      env: { ANTHROPIC_BASE_URL: 'https://gateway.example.test' },
      auth: 'none',
      accepted: false,
    },
    {
      name: 'API-key transport',
      env: { ANTHROPIC_API_KEY: 'synthetic-fixture-key' },
      auth: 'ANTHROPIC_API_KEY',
      accepted: false,
    },
    {
      name: 'token transport with current none init',
      env: { ANTHROPIC_AUTH_TOKEN: 'synthetic-fixture-token' },
      auth: 'none',
      accepted: false,
    },
    { name: 'unattributed pre-init frame', env: {}, auth: null, accepted: false },
  ],
)

describe('native Claude usage subscription lifecycle', () => {
  it('rejects an old runtime epoch before the usage subscription sees numeric quota', async () => {
    const f = await createClaudeUsageLifecycleFixture()
    fixtures.push(f)
    const before = await f.store.read()
    f.init('none')
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
    f.init('none')
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
