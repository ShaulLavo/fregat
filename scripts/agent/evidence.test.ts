import { readFile, rm } from 'node:fs/promises'
import { expect, it, vi } from 'vitest'
import { createEvidence } from './evidence'

it('keeps concurrent runs with the same label and start second in separate directories', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
  const runs = await Promise.all(
    Array.from({ length: 12 }, () => createEvidence('scenario', 'concurrent isolation')),
  )
  try {
    expect(new Set(runs.map((run) => run.dir)).size).toBe(runs.length)
    await Promise.all(runs.map((run, index) => run.json('identity.json', { index })))
    const identities = await Promise.all(
      runs.map((run) => readFile(run.file('identity.json'), 'utf8')),
    )
    expect(identities.map((identity) => JSON.parse(identity))).toEqual(
      runs.map((_, index) => ({ index })),
    )
  } finally {
    vi.useRealTimers()
    await Promise.all(runs.map((run) => rm(run.dir, { recursive: true, force: true })))
  }
})
