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
