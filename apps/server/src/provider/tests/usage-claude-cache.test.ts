import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { readClaudeUsageCache } from '../usage-claude-cache'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function cacheFile(value: unknown) {
  const root = await mkdtemp(path.join(tmpdir(), 'claude-usage-cache-'))
  roots.push(root)
  const file = path.join(root, '.claude.json')
  await writeFile(file, JSON.stringify(value))
  return file
}

const observedAtMs = Date.parse('2026-10-02T22:14:00Z')
function snapshot(accountUuid = 'fixture-current') {
  return {
    oauthAccount: {
      accountUuid: 'fixture-current',
      organizationType: 'claude_max',
      emailAddress: 'fixture.person@example.test',
    },
    cachedUsageUtilization: {
      accountUuid,
      fetchedAtMs: observedAtMs,
      utilization: {
        five_hour: { utilization: 19, resets_at: '2026-10-02T22:59:59Z' },
        seven_day: { utilization: 77, resets_at: '2026-10-07T16:59:59Z' },
        undocumented: { utilization: 25, resets_at: null },
      },
    },
  }
}

test('preserves native percentage scale and observation time without exporting account records', async () => {
  const reading = await readClaudeUsageCache(await cacheFile(snapshot()), observedAtMs + 60_000)
  expect(reading).toMatchObject({
    observedAt: new Date(observedAtMs).toISOString(),
    probe: {
      kind: 'reading',
      update: {
        label: 'fixture.person',
        windows: [
          { id: 'five_hour', usedPercent: 19 },
          { id: 'seven_day', usedPercent: 77 },
        ],
      },
    },
  })
  expect(JSON.stringify(reading)).not.toContain('fixture-current')
  expect(JSON.stringify(reading)).not.toContain('undocumented')
  expect(JSON.stringify(reading)).not.toContain('@example.test')
})

test.each([
  { monthly_limit: 50, used_credits: 5, utilization: 10 },
  { monthly_limit: null, used_credits: null, utilization: null },
])('preserves validated extra usage coverage without exporting raw fields: %j', async (extra) => {
  const cached = snapshot()
  cached.cachedUsageUtilization.utilization.five_hour.utilization = 100
  const file = await cacheFile({
    ...cached,
    cachedUsageUtilization: {
      ...cached.cachedUsageUtilization,
      utilization: {
        ...cached.cachedUsageUtilization.utilization,
        extra_usage: {
          ...extra,
          is_enabled: true,
          accountUuid: 'fixture-extra-private-account',
          raw: 'fixture-extra-private-token',
        },
      },
    },
  })
  const reading = await readClaudeUsageCache(file, observedAtMs + 60_000)
  expect(reading).toMatchObject({
    observedAt: new Date(observedAtMs).toISOString(),
    probe: {
      kind: 'reading',
      update: {
        windows: expect.arrayContaining([
          expect.objectContaining({ id: 'five_hour', usedPercent: 100, status: 'warning' }),
        ]),
      },
    },
  })
  if (reading?.probe.kind !== 'reading') return
  const extraWindow = reading.probe.update.windows.find((window) => window.id === 'extra_usage')
  if (extra.utilization === null) expect(extraWindow).toBeUndefined()
  else expect(extraWindow).toMatchObject({ id: 'extra_usage', usedPercent: 10, kind: 'other' })
  expect(JSON.stringify(reading)).not.toContain('fixture-extra-private')
  expect(JSON.stringify(reading)).not.toContain('fixture-current')
})

test.each([
  { is_enabled: false, monthly_limit: 50, used_credits: 5, utilization: 10 },
  { is_enabled: 'true', monthly_limit: 50, used_credits: 5, utilization: 10 },
  { is_enabled: true, monthly_limit: -1, used_credits: 5, utilization: 10 },
  { is_enabled: true, monthly_limit: 50, used_credits: '5', utilization: 10 },
  { is_enabled: true, monthly_limit: 50, used_credits: 5, utilization: 101 },
  { is_enabled: true },
])(
  'keeps exhausted windows rejected for disabled or invalid extra usage: %j',
  async (extra_usage) => {
    const cached = snapshot()
    cached.cachedUsageUtilization.utilization.five_hour.utilization = 100
    const file = await cacheFile({
      ...cached,
      cachedUsageUtilization: {
        ...cached.cachedUsageUtilization,
        utilization: { ...cached.cachedUsageUtilization.utilization, extra_usage },
      },
    })
    const reading = await readClaudeUsageCache(file, observedAtMs + 60_000)
    expect(reading?.probe.kind === 'reading' && reading.probe.update.windows).toEqual([
      expect.objectContaining({ id: 'five_hour', usedPercent: 100, status: 'rejected' }),
      expect.objectContaining({ id: 'seven_day', usedPercent: 77 }),
    ])
  },
)

test('rejects an account mismatch, future observation, malformed percentage and absent cache', async () => {
  expect(
    await readClaudeUsageCache(await cacheFile(snapshot('fixture-old')), observedAtMs + 1000),
  ).toBeNull()
  expect(await readClaudeUsageCache(await cacheFile(snapshot()), observedAtMs - 1)).toBeNull()
  const malformed = snapshot()
  malformed.cachedUsageUtilization.utilization.five_hour.utilization = -1
  malformed.cachedUsageUtilization.utilization.seven_day.utilization = Number.NaN
  expect(await readClaudeUsageCache(await cacheFile(malformed), observedAtMs + 1000)).toBeNull()
  expect(
    await readClaudeUsageCache(path.join(tmpdir(), 'missing-fixture-claude.json'), observedAtMs),
  ).toBeNull()
})

test.each([
  undefined,
  'unsafe name@example.test',
  'local@@example.test',
  'person\u200b@example.test',
])('invalid or absent metadata preserves valid matched quota: %j', async (emailAddress) => {
  const value = snapshot()
  const file = await cacheFile({ ...value, oauthAccount: { ...value.oauthAccount, emailAddress } })
  const reading = await readClaudeUsageCache(file, observedAtMs + 60_000)
  expect(reading).toMatchObject({
    probe: { kind: 'reading', update: { windows: [{ usedPercent: 19 }, { usedPercent: 77 }] } },
  })
  expect(reading?.probe.kind === 'reading' && reading.probe.update).not.toHaveProperty(
    'label',
    expect.any(String),
  )
})
