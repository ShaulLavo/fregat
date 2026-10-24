import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'
import { readLiveCheck } from '../../apps/server/src/update/staged-release'
import { liveVerdict } from './live-verdict.mjs'

test('shared log noise cannot fail a healthy candidate when a group crosses its daily budget', () => {
  expect(
    liveVerdict(
      {
        failures: [],
        logNoise: { failures: ['log noise: warn environments machine.events -'] },
      },
      [],
    ),
  ).toEqual({ status: 'passed', fresh: [] })
})

test('every console warning stays fatal even when the baseline contains it', () => {
  const warning = 'console warnings: ["renderer warning"]'
  expect(liveVerdict({ failures: [warning] }, [warning])).toEqual({
    status: 'failed',
    fresh: [warning],
  })
})

test('a terminal check failure stays fatal even when the baseline contains it', () => {
  const failure = 'terminal check: shell prompt did not render'
  expect(liveVerdict({ failures: [failure] }, [failure])).toEqual({
    status: 'failed',
    fresh: [failure],
  })
})

test('a failed candidate check remains visible alongside shared diagnostics', () => {
  expect(
    liveVerdict(
      {
        failures: ['no successful /health response', 'known failure'],
        logNoise: { failures: ['log noise: warn environments machine.events -'] },
      },
      ['known failure'],
    ),
  ).toEqual({ status: 'failed', fresh: ['no successful /health response'] })
})

test('a standalone verdict identifies the observed served release', () => {
  expect(liveVerdict({ failures: [], served: { release: 'standalone-release' } }, [])).toEqual({
    release: 'standalone-release',
    status: 'passed',
    fresh: [],
  })
})

test('a standalone verdict is readable as the current release live check', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'live-check-standalone-'))
  const current = path.join(root, 'releases', 'standalone-release')
  try {
    await mkdir(current, { recursive: true })
    await symlink(current, path.join(root, 'current'))
    const verdict = liveVerdict({ failures: [], served: { release: 'standalone-release' } }, [])
    await writeFile(
      path.join(current, 'live-check.json'),
      JSON.stringify({ ...verdict, checkedAt: '2026-10-24T19:21:48.103Z' }),
    )

    expect(readLiveCheck(root)).toEqual({
      release: 'standalone-release',
      status: 'passed',
      at: '2026-10-24T19:21:48.103Z',
      error: null,
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
