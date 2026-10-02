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
    oauthAccount: { accountUuid: 'fixture-current', organizationType: 'claude_max' },
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
        windows: [
          { id: 'five_hour', usedPercent: 19 },
          { id: 'seven_day', usedPercent: 77 },
        ],
      },
    },
  })
  expect(JSON.stringify(reading)).not.toContain('fixture-current')
  expect(JSON.stringify(reading)).not.toContain('undocumented')
})

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
