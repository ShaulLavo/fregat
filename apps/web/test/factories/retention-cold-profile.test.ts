import { test, expect } from '../fixtures'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  addColdDuration,
  coldHistogram,
  parseColdFact,
  coldProfilePrefix,
  safeColdObserve,
  beginColdProfile,
  markColdProfile,
  publishColdProfile,
  acceptColdFact,
  observeColdPromise,
  readColdWire,
} from './retention-cold-profile'

const arm = { syntax: 'plain', font: 'normal', saved: 'absent' }
const browser = () => ({
  kind: 'browser',
  phase: 'load',
  utcMs: 100,
  timeOriginMs: 50,
  monotonicMs: 50,
  resources: coldHistogram(),
  resourceReason: null,
  navigation: null,
  longTasks: null,
  bytes: 0,
  reason: 'unsupported',
  observerMs: 0,
})
test('cold profile aggregates every retained duration, including deliberate slow and invalid controls', () => {
  const value = coldHistogram()
  for (const ms of [0, 1, 2, 3, 100, 40000]) addColdDuration(value, ms)
  for (const ms of [NaN, Infinity, -1]) addColdDuration(value, ms)
  expect(value.count).toBe(6)
  expect(value.sumMs).toBe(40106)
  expect(value.maxMs).toBe(40000)
  expect(value.buckets.reduce((sum, count) => sum + count, 0)).toBe(6)
  expect(value.buckets[15]).toBe(1)
})
test('cold external packet strips private fields and refuses missing or invalid clocks and labels', () => {
  const parsed = parseColdFact(
    coldProfilePrefix +
      JSON.stringify({
        ...browser(),
        url: 'private-sentinel',
        source: 'private-sentinel',
        environment: 'private-sentinel',
      }),
  )
  expect(parsed).toEqual(browser())
  expect(JSON.stringify(parsed)).not.toContain('private-sentinel')
  expect(
    parseColdFact(coldProfilePrefix + JSON.stringify({ ...browser(), phase: 'private-sentinel' })),
  ).toBeNull()
  expect(
    parseColdFact(coldProfilePrefix + JSON.stringify({ ...browser(), monotonicMs: null })),
  ).toBeNull()
  expect(parseColdFact(coldProfilePrefix + '{')).toBeNull()
  expect(parseColdFact(coldProfilePrefix + 'x'.repeat(20000))).toBeNull()
})
test('failing observational boundary preserves the operation result and thrown identity', async () => {
  const primary = { controlled: true }
  const operation = (fails: boolean) => {
    safeColdObserve(() => {
      throw primary
    })
    if (fails) throw primary
    return 17
  }
  await expect(
    observeColdPromise(
      async () => 17,
      () => {
        throw primary
      },
    ),
  ).resolves.toBe(17)
  await expect(
    observeColdPromise(
      async () => {
        throw primary
      },
      () => {
        throw { observer: true }
      },
    ),
  ).rejects.toBe(primary)
  expect(operation(false)).toBe(17)
  expect(() => operation(true)).toThrow()
  try {
    operation(true)
  } catch (error) {
    expect(error).toBe(primary)
  }
  globalThis.__retentionColdCost = undefined
  expect(beginColdProfile(false, arm, 'unused')).toBe(false)
  expect(beginColdProfile(true, arm, 'unused')).toBe(false)
  globalThis.__retentionColdCost = undefined
  const output = await mkdtemp(join(tmpdir(), 'retention-cold-pure-'))
  try {
    expect(beginColdProfile(true, arm, output)).toBe(true)
    expect(beginColdProfile(true, arm, output)).toBe(false)
    markColdProfile('start')
    acceptColdFact(coldProfilePrefix + JSON.stringify(browser()))
    await publishColdProfile()
    const saved = JSON.parse(await readFile(join(output, 'cold-cost.json'), 'utf8'))
    expect(saved.phases).toHaveLength(1)
    expect(saved.browser[0]).toEqual(browser())
    expect(saved.server).toBeNull()
    expect(saved.missingServerReason).toBe('unavailable')
    globalThis.__retentionColdCost = undefined
    expect(beginColdProfile(true, arm, join(output, 'absent'))).toBe(true)
    await expect(publishColdProfile()).resolves.toBeUndefined()
  } finally {
    globalThis.__retentionColdCost = undefined
    await rm(output, { recursive: true, force: true })
  }
})

test('cold settlement returns the original promise without re-reading a fulfilled accessor', async () => {
  let reads = 0,
    terminals = 0
  const secondRead = { control: 'second-then-read' }
  const value = Object.defineProperty({}, 'then', {
    get() {
      if (++reads === 1) return undefined
      throw secondRead
    },
  })
  const original = Promise.resolve(value)
  expect(await original).toBe(value)
  const observed = observeColdPromise(
    () => original,
    () => {
      terminals++
    },
  )
  expect(observed).toBe(original)
  expect(await observed).toBe(value)
  expect(reads).toBe(1)
  expect(terminals).toBe(1)
  for (const value of [undefined, null, false, 0, '']) {
    const promise = Promise.resolve(value)
    expect(
      observeColdPromise(
        () => promise,
        () => {
          throw secondRead
        },
      ),
    ).toBe(promise)
    expect(await promise).toBe(value)
  }
  const rejected = Promise.reject(secondRead)
  expect(
    observeColdPromise(
      () => rejected,
      () => {
        throw { observer: true }
      },
    ),
  ).toBe(rejected)
  await expect(rejected).rejects.toBe(secondRead)
  const refusal = Promise.resolve(9)
  Object.defineProperty(refusal, 'then', {
    get() {
      throw secondRead
    },
  })
  expect(
    observeColdPromise(
      () => refusal,
      () => {
        terminals++
      },
    ),
  ).toBe(refusal)
  expect(await refusal).toBe(9)
  expect(() =>
    observeColdPromise(
      () => {
        throw secondRead
      },
      () => {},
    ),
  ).toThrow()
})

test('cold wire records split, oversized, invalid, incomplete and post-EOF input at real byte and file boundaries', async () => {
  globalThis.__retentionColdCost = undefined
  const output = await mkdtemp(join(tmpdir(), 'retention-cold-wire-'))
  try {
    beginColdProfile(true, arm, output)
    const wire = readColdWire(true)
    const frame = Buffer.from(coldProfilePrefix + JSON.stringify(browser()) + '\n')
    const oversized = Buffer.from(coldProfilePrefix + 'x'.repeat(20000))
    wire(oversized.subarray(0, 15000))
    wire(oversized.subarray(15000))
    wire(Buffer.from('inner-' + coldProfilePrefix + JSON.stringify(browser()) + '\n'))
    wire(frame.subarray(0, 13))
    wire(frame.subarray(13))
    wire(Buffer.concat([Buffer.from(coldProfilePrefix), Buffer.from([255, 10])]))
    wire(Buffer.from(coldProfilePrefix + '{'))
    wire.finish()
    wire.finish()
    wire(frame)
    await publishColdProfile()
    const saved = JSON.parse(await readFile(join(output, 'cold-cost.json'), 'utf8'))
    expect(saved.browser).toHaveLength(1)
    expect(saved.refused).toBe(3)
    expect(saved.wire.oversizedFrames).toBe(1)
    expect(saved.wire.incompleteFrames).toBe(1)
    expect(saved.wire.decodeFailures).toBe(1)
    expect(saved.wire.afterEofBytes).toBe(frame.length)
    expect(saved.wireComplete).toBe(false)
    expect(saved.wireReason).toBe('loss-observed')
    expect(saved.wire.discardedBytes).toBeGreaterThan(20000)
  } finally {
    globalThis.__retentionColdCost = undefined
    await rm(output, { recursive: true, force: true })
  }
})

test('cold wire clean EOF is complete and an unobserved EOF stays unknown', async () => {
  const output = await mkdtemp(join(tmpdir(), 'retention-cold-clean-'))
  try {
    globalThis.__retentionColdCost = undefined
    beginColdProfile(true, arm, output)
    const wire = readColdWire(true),
      frame = Buffer.from(coldProfilePrefix + JSON.stringify(browser()) + '\n')
    for (const byte of frame) wire(Buffer.from([byte]))
    wire(Buffer.from('ordinary bounded control\n'))
    wire.finish()
    await publishColdProfile()
    const saved = JSON.parse(await readFile(join(output, 'cold-cost.json'), 'utf8'))
    expect(saved.wire.bytesSeen).toBe(
      frame.length + Buffer.byteLength('ordinary bounded control\n'),
    )
    expect(saved.wire.acceptedFrames).toBe(1)
    expect(saved.refused).toBe(0)
    expect(saved.wireComplete).toBe(true)
    expect(saved.wireReason).toBeNull()
    globalThis.__retentionColdCost = undefined
    beginColdProfile(true, arm, output)
    readColdWire(true)(frame)
    await publishColdProfile()
    const pending = JSON.parse(await readFile(join(output, 'cold-cost.json'), 'utf8'))
    expect(pending.wireComplete).toBeNull()
    expect(pending.wireReason).toBe('eof-unobserved')
  } finally {
    globalThis.__retentionColdCost = undefined
    await rm(output, { recursive: true, force: true })
  }
})
