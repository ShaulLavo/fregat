import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'

import { readRefusals, refusalFailures, refusedLogLines } from './live-refusals.mjs'

const release = '20260926T142757Z-6ad8ac64-w2-batch1'
const origin = 'https://omarchy.mesh.shaulavo.dev/platform'

// Shaped after the 2026-09-26 14:49 production lines: an old tab refused after the restart.
function subscriptionError(code: string, overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    timestamp: '2026-09-26T14:49:13.002Z',
    level: 'error',
    version: release,
    action: 'orchestration.ws.subscription.summary',
    area: 'orchestration',
    runtime: 'browser',
    code,
    error: { name: 'EvlogError', code, internal: { origin } },
    ...overrides,
  })
}

test('an identity drift logged by the new release is a refusal', () => {
  const lines = [
    subscriptionError('ORCHESTRATION_WS_ERROR'),
    subscriptionError('ENVIRONMENT_IDENTITY_DRIFT'),
    subscriptionError('ENVIRONMENT_IDENTITY_DRIFT', { version: 'previous-release' }),
    'not json ENVIRONMENT_IDENTITY_DRIFT',
  ]
  const refusals = refusedLogLines(lines, { release, since: '' })
  expect(refusals).toEqual([
    { timestamp: '2026-09-26T14:49:13.002Z', code: 'ENVIRONMENT_IDENTITY_DRIFT', origin },
  ])
  expect(refusalFailures(refusals, release)).toEqual([
    `refused connections on ${release}: 1 ENVIRONMENT_IDENTITY_DRIFT since 2026-09-26T14:49:13.002Z`,
  ])
})

test('without a release, refusals count from the check start', () => {
  const lines = [
    subscriptionError('ENVIRONMENT_PROTOCOL_MISMATCH', { timestamp: '2026-09-26T14:00:00.000Z' }),
    subscriptionError('ENVIRONMENT_PROTOCOL_MISMATCH', { timestamp: '2026-09-26T15:00:00.000Z' }),
  ]
  const refusals = refusedLogLines(lines, { release: undefined, since: '2026-09-26T14:30:00Z' })
  expect(refusals.map((refusal) => refusal.timestamp)).toEqual(['2026-09-26T15:00:00.000Z'])
})

test('reads refusals from the log directory', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'live-refusals-'))
  try {
    writeFileSync(
      join(directory, '2026-09-26.3.jsonl'),
      `${subscriptionError('ENVIRONMENT_IDENTITY_DRIFT')}\n${subscriptionError('ORCHESTRATION_WS_ERROR')}\n`,
    )
    writeFileSync(join(directory, 'notes.txt'), subscriptionError('ENVIRONMENT_IDENTITY_DRIFT'))
    const refusals = await readRefusals(directory, { release, since: '' })
    expect(refusals).toHaveLength(1)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
