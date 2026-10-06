import {
  closeSync,
  existsSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeSync,
} from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, vi } from 'vitest'
import { test, expect } from '../fixtures'
import { makeTestServer } from '../server'
import {
  cleanupObservation,
  createCleanupObservation,
  fixtureDirectoryAvailability,
  observeFixtureRemoval,
} from './cleanup-observation'

const directories: string[] = []
afterEach(() => {
  vi.useRealTimers()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function fileSink() {
  const directory = mkdtempSync(path.join(tmpdir(), 'cleanup-observation-'))
  directories.push(directory)
  const file = path.join(directory, 'phases.jsonl')
  const fd = openSync(file, 'wx')
  return { file, fd, sink: (line: string) => writeSync(fd, line) }
}

test('phase records persist through a pending boundary and retain the original promise and Error', async () => {
  const io = fileSink()
  const observation = createCleanupObservation(io.sink)
  const primary = await readFile(path.join(path.dirname(io.file), 'absent')).catch((error) => error)
  let reject: (error: unknown) => void = () => undefined
  const pending = new Promise<void>((_, fail) => {
    reject = fail
  })
  try {
    const before = observation.point('workspace', 'before', 'available')
    const originalLine = readFileSync(io.file, 'utf8')
    expect(originalLine).toContain('"stage":"before"')
    const observed = observeFixtureRemoval(pending, observation, 'workspace', path.dirname(io.file))
    expect(observed).toBe(pending)
    reject(primary)
    await expect(Promise.all([observed, readFile(io.file)])).rejects.toBe(primary)
    expect(before.stage).toBe('before')
    expect(Object.isFrozen(before)).toBe(true)
    const after = readFileSync(io.file, 'utf8')
    expect(after.startsWith(originalLine)).toBe(true)
    expect(after).toContain('"stage":"rejected"')
    expect(after).not.toContain('absent')
    expect(after).not.toContain('ENOENT')
  } finally {
    closeSync(io.fd)
  }
})

test('phase IO failure preserves the native return and primary rejection without retries', async () => {
  const io = fileSink()
  closeSync(io.fd)
  const observation = createCleanupObservation(io.sink)
  const before = observation.point('app', 'before')
  expect(before.unavailable).toBe(1)
  expect(before.lost).toBe(1)
  const primary = await readFile(path.join(path.dirname(io.file), 'absent')).catch((error) => error)
  const rejected = Promise.reject(primary)
  expect(observeFixtureRemoval(rejected, observation, 'state-home', path.dirname(io.file))).toBe(
    rejected,
  )
  await expect(rejected).rejects.toBe(primary)
  expect(observation.snapshot().unavailable).toBe(2)
  expect(observation.snapshot().lost).toBe(2)
  expect(readFileSync(io.file, 'utf8')).toBe('')
})

test('phase record and byte caps refuse private fields and expose truncation and loss', () => {
  const io = fileSink()
  try {
    const observation = createCleanupObservation(io.sink)
    Reflect.apply(observation.point, undefined, ['private-body', 'before', 'available'])
    for (let index = 0; index < 200; index++) observation.point('app', 'before', 'available')
    const final = observation.snapshot()
    const bytes = readFileSync(io.file)
    const lines = bytes.toString().trim().split('\n')
    expect(bytes.byteLength).toBeLessThanOrEqual(16_384)
    expect(lines.length).toBeLessThanOrEqual(32)
    expect(lines.every((line) => Buffer.byteLength(line + '\n') <= 1_024)).toBe(true)
    expect(final.truncated).toBe(true)
    expect(final.refused).toBe(1)
    expect(final.lost).toBeGreaterThan(1)
    expect(lines.at(-1)).toContain('"stage":"limit"')
    expect(bytes.toString()).not.toContain('private-body')
  } finally {
    closeSync(io.fd)
  }
})

test('phase capture reports actual fake timers and qualified directory availability', () => {
  const io = fileSink()
  try {
    const observation = createCleanupObservation(io.sink)
    expect(observation.point('app', 'before').fakeTimers).toBe('real')
    vi.useFakeTimers()
    expect(observation.point('app', 'before').fakeTimers).toBe('fake')
    vi.useRealTimers()
    expect(observation.point('app', 'after').fakeTimers).toBe('real')
    expect(fixtureDirectoryAvailability(path.dirname(io.file))).toBe('available')
    expect(fixtureDirectoryAvailability(path.join(path.dirname(io.file), 'absent'))).toBe('absent')
    expect(fixtureDirectoryAvailability(io.file)).toBe('unavailable')
  } finally {
    closeSync(io.fd)
  }
})

test('actual test-server cleanup retains ordering, primitive facts and an independent sink', async () => {
  const io = fileSink()
  const server = await makeTestServer()
  const observation = cleanupObservation(server.app, io.sink)
  try {
    expect(cleanupObservation(server.app)).toBe(observation)
    await server.cleanup()
    expect(existsSync(server.root)).toBe(false)
    expect(existsSync(server.stateHome)).toBe(false)
    expect(existsSync(io.file)).toBe(true)
    const lines = readFileSync(io.file, 'utf8').trim().split('\n')
    const phases = lines.map((line) => JSON.parse(line.slice('[dom-cleanup-observation] '.length)))
    expect(phases.map((phase) => `${phase.boundary}.${phase.stage}`).slice(0, 5)).toEqual([
      'app.before',
      'app.after',
      'database.before',
      'database.after',
      'removals.before',
    ])
    expect(phases.map((phase) => `${phase.boundary}.${phase.stage}`)).toContain('workspace.after')
    expect(phases.map((phase) => `${phase.boundary}.${phase.stage}`)).toContain('state-home.after')
    expect(phases.at(-1).boundary).toBe('removals')
    expect(phases.at(-1).stage).toBe('after')
    expect(new Set(phases.map((phase) => phase.id)).size).toBe(1)
    expect(phases.every((phase) => phase.fakeTimers === 'real')).toBe(true)
    expect(readFileSync(io.file, 'utf8')).not.toContain(server.root)
    expect(readFileSync(io.file, 'utf8')).not.toContain(server.stateHome)
  } finally {
    closeSync(io.fd)
  }
})
