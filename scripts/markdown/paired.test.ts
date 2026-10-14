import type { blockToHast } from '../../packages/markdown/src/utils/hast'
import { expect, test } from 'vitest'
import { createMarkdownSession } from '../../packages/markdown/src/utils/session'
import {
  digestProjection,
  mismatchedRevisions,
  nativePairWorkloads,
  pairedConfidence,
  pairedTrialOrders,
  runNativeTrial,
  type NativeRevision,
} from './paired-native'

type Root = ReturnType<typeof blockToHast>

test('seeded AB/BA orders are balanced across twenty fresh paired trials', () => {
  const orders = pairedTrialOrders(20, 176)
  expect(orders).toEqual(pairedTrialOrders(20, 176))
  expect(orders.filter((order) => order[0] === 'remark')).toHaveLength(10)
  expect(orders.every((order, index) => index === 0 || order[0] !== orders[index - 1][0])).toBe(
    true,
  )
  expect(() => pairedTrialOrders(0, 1)).toThrow()
})

test('complete HAST digests preserve nesting, destinations and every ordered child', () => {
  const root: Root = {
    type: 'root',
    children: [
      {
        type: 'element',
        tagName: 'a',
        properties: { href: 'https://example.test/a', title: 'A' },
        children: [{ type: 'text', value: 'label' }],
      },
    ],
  }
  const reordered: Root = {
    type: 'root',
    children: [
      {
        type: 'element',
        tagName: 'a',
        properties: { title: 'A', href: 'https://example.test/a' },
        children: [{ type: 'text', value: 'label' }],
      },
    ],
  }
  const changed: Root = {
    type: 'root',
    children: [
      {
        type: 'element',
        tagName: 'a',
        properties: { href: 'https://example.test/b', title: 'A' },
        children: [{ type: 'text', value: 'label' }],
      },
    ],
  }
  expect(digestProjection(root)).toBe(digestProjection(reordered))
  expect(digestProjection(root)).not.toBe(digestProjection(changed))
  expect(digestProjection(root)).not.toBe(digestProjection({ type: 'root', children: [] }))
})

test('paired bootstrap rejects regression and intervals crossing the frozen budget', () => {
  const baseline = Array.from({ length: 20 }, () => 10)
  const faster = baseline.map(() => 5)
  const slower = baseline.map(() => 20)
  const ambiguous = baseline.map((_, index) => (index === 19 ? 30 : 10))
  const compare = (candidate: number[]) =>
    pairedConfidence({
      workload: 'control',
      metric: 'updateP95',
      baseline,
      candidate,
      seed: 176,
      resamples: 2048,
    })
  expect(compare(faster).status).toBe('passed')
  expect(compare(slower).status).toBe('failed')
  expect(compare(ambiguous).status).toBe('inconclusive')
  expect(compare(ambiguous)).toEqual(compare(ambiguous))
  expect(
    pairedConfidence({
      workload: 'control',
      metric: 'streamCpu',
      baseline: [10, 10, 10],
      candidate: [1, 1, 1],
      seed: 176,
      resamples: 256,
    }).status,
  ).toBe('inconclusive')
  expect(() => compare(baseline.concat([10]))).toThrow()
  expect(() => compare(baseline.map(() => Number.NaN))).toThrow()
})

test('native projection runs each revision and clears real sessions on release', () => {
  const workload = nativePairWorkloads('quick').find((entry) => entry.id === 'stream-mixed-256/24')
  expect(workload).toBeDefined()
  if (!workload) return
  const owned: ReturnType<typeof createMarkdownSession>[] = []
  const factory = () => {
    const session = createMarkdownSession()
    owned.push(session)
    return session
  }
  const input = { factory, workload, trial: 0, extensions: { raw: null, math: null } }
  const left = runNativeTrial({ ...input, engine: 'remark' })
  const right = runNativeTrial({ ...input, engine: 'tree-sitter' })
  expect(mismatchedRevisions(left.revisions, right.revisions)).toEqual([])
  expect(left.revisions.at(-1)?.phase).toBe('settlement')
  expect(left.revisions.at(-1)?.offset).toBe(workload.source.length)
  expect(left.revisions.some((revision) => revision.reusedBlocks > 0)).toBe(true)
  expect(owned.every((session) => session.update('', { heal: false }).length === 0)).toBe(true)
  expect(left.streamCpuMs).toBeGreaterThanOrEqual(
    left.revisions.reduce((sum, revision) => sum + revision.cpuMs, 0),
  )
})

test('retained old output, skipped revisions and changed coverage fail pair comparison', () => {
  const revision: NativeRevision = {
    revision: 0,
    offset: 10,
    phase: 'update',
    parseMs: 1,
    projectionMs: 1,
    wallMs: 2,
    cpuMs: 2,
    convertedBlocks: 1,
    reusedBlocks: 0,
    outputDigest: 'new',
    unchangedProjection: false,
  }
  expect(mismatchedRevisions([revision], [{ ...revision, outputDigest: 'old' }])).toEqual([0])
  expect(mismatchedRevisions([revision], [])).toEqual([0])
  expect(mismatchedRevisions([revision], [{ ...revision, revision: 1 }])).toEqual([0])
  expect(mismatchedRevisions([revision], [{ ...revision, offset: 9 }])).toEqual([0])
  expect(mismatchedRevisions([revision], [{ ...revision, phase: 'settlement' }])).toEqual([0])
})
