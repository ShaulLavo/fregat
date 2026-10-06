import { randomBytes } from 'node:crypto'
import { lstatSync, writeSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { vi } from 'vitest'

const MAX_RECORDS = 32
const MAX_BYTES = 16_384
const MAX_LINE_BYTES = 1_024
const boundaries = [
  'bridge',
  'client',
  'server',
  'app',
  'database',
  'workspace',
  'state-home',
  'removals',
  'observer',
] as const
const stages = ['before', 'after', 'rejected', 'limit'] as const
const availability = ['available', 'absent', 'unavailable', 'unobserved'] as const
type Boundary = (typeof boundaries)[number]
type Stage = (typeof stages)[number]
type Availability = (typeof availability)[number]
type Sink = (line: string) => number
const observers = new WeakMap<object, ReturnType<typeof createCleanupObservation>>()

function fakeTimerState() {
  try {
    return vi.isFakeTimers() ? 'fake' : 'real'
  } catch {
    return 'unavailable'
  }
}

export function fixtureDirectoryAvailability(directory: string): Availability {
  try {
    return lstatSync(directory).isDirectory() ? 'available' : 'unavailable'
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
      return 'absent'
    return 'unavailable'
  }
}

export function createCleanupObservation(sink: Sink = (line) => writeSync(2, line)) {
  const id = randomBytes(6).toString('hex')
  let records = 0
  let bytes = 0
  let reportedWrittenBytes = 0
  let refused = 0
  let unavailable = 0
  let lost = 0
  let truncated = false
  let boundary: Boundary = 'observer'
  let stage: Stage = 'before'
  let resource: Availability = 'unobserved'
  const snapshot = () =>
    Object.freeze({
      id,
      pid: process.pid,
      boundary,
      stage,
      resource,
      monotonicMs: performance.now(),
      fakeTimers: fakeTimerState(),
      records,
      bytes,
      reportedWrittenBytes,
      refused,
      unavailable,
      lost,
      truncated,
    })
  const point = (
    nextBoundary: Boundary,
    nextStage: Stage,
    nextResource: Availability = 'unobserved',
  ) => {
    if (
      !boundaries.includes(nextBoundary) ||
      !stages.includes(nextStage) ||
      !availability.includes(nextResource)
    ) {
      refused++
      lost++
      return snapshot()
    }
    if (truncated) {
      lost++
      return snapshot()
    }
    boundary = nextBoundary
    stage = nextStage
    resource = nextResource
    let line = '[dom-cleanup-observation] ' + JSON.stringify(snapshot()) + '\n'
    if (
      records >= MAX_RECORDS - 1 ||
      bytes + Buffer.byteLength(line) + MAX_LINE_BYTES > MAX_BYTES
    ) {
      truncated = true
      lost++
      boundary = 'observer'
      stage = 'limit'
      resource = 'unobserved'
      line = '[dom-cleanup-observation] ' + JSON.stringify(snapshot()) + '\n'
    }
    const length = Buffer.byteLength(line)
    if (length > MAX_LINE_BYTES || bytes + length > MAX_BYTES) {
      refused++
      lost++
      truncated = true
      return snapshot()
    }
    records++
    bytes += length
    try {
      const written = sink(line)
      if (Number.isInteger(written) && written >= 0 && written <= length)
        reportedWrittenBytes += written
      if (written !== length) {
        unavailable++
        lost++
      }
    } catch {
      unavailable++
      lost++
    }
    return snapshot()
  }
  return { point, snapshot }
}

export function cleanupObservation(owner: object | undefined, sink?: Sink) {
  if (!owner) return createCleanupObservation(sink)
  const existing = observers.get(owner)
  if (existing) return existing
  const observation = createCleanupObservation(sink)
  observers.set(owner, observation)
  return observation
}

export function observeFixtureRemoval<T>(
  promise: Promise<T>,
  observation: ReturnType<typeof createCleanupObservation>,
  boundary: 'workspace' | 'state-home',
  directory: string,
) {
  void promise.then(
    () => observation.point(boundary, 'after', fixtureDirectoryAvailability(directory)),
    () => observation.point(boundary, 'rejected', fixtureDirectoryAvailability(directory)),
  )
  return promise
}
