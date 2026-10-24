import { expect, test } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { preserveInputCapture, readInputArtifact } from '../input-artifacts.mjs'
import { fail } from '../errors.mjs'

test('archives original cleaned sides and schedule before a later validation failure', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'input-capture-'))
  const path = resolve(directory, 'raw.json.gz')
  const results = { candidate: { reset: { sourceCurrent: false } } }
  const schedule = [{ group: 'ordinary/multiple/typing', repetition: 0 }]
  try {
    const received = await preserveInputCapture(path, results, async () => {
      results.candidate.cleanup = { contextClosed: true, retainedObjects: 0 }
      return schedule
    })
    expect(received).toBe(schedule)
    expect(() => fail('Reset consumer source is incomplete')).toThrow()
    const saved = await readInputArtifact(path)
    expect(saved.captureComplete).toBe(true)
    expect(saved.results).toEqual(results)
    expect(saved.schedule).toEqual(schedule)
    expect(saved.failure).toBeNull()
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('archives available receipts when capture or cleanup rejects and rethrows its failure', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'input-capture-failed-'))
  const path = resolve(directory, 'raw.json.gz')
  const results = { candidate: { cleanup: { pendingFrames: 1 } } }
  try {
    await expect(
      preserveInputCapture(path, results, async () => fail('Cleanup has a pending frame')),
    ).rejects.toThrow()
    const saved = await readInputArtifact(path)
    expect(saved.captureComplete).toBe(false)
    expect(saved.results).toEqual(results)
    expect(saved.schedule).toEqual([])
    expect(saved.failure).toContain('Cleanup has a pending frame')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
