import type { blockToHast } from '../../packages/markdown/src/utils/hast'
import { expect, test } from 'vitest'
import { createMarkdownSession } from '../../packages/markdown/src/utils/session'
import {
  digestProjection,
  inspectSourceCorrespondence,
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

test('private text segmentation and container padding preserve exact rendered semantics', () => {
  const source = '| cell |'
  const content = {
    start: { line: 1, column: 3, offset: 2 },
    end: { line: 1, column: 7, offset: 6 },
  }
  const wide: Root = {
    type: 'root',
    children: [
      {
        type: 'element',
        tagName: 'th',
        properties: { dataSourceLine: 1, dataSourceEndLine: 1, style: 'text-align: right' },
        position: {
          start: { line: 1, column: 1, offset: 0 },
          end: { line: 1, column: 9, offset: 8 },
        },
        children: [{ type: 'text', value: 'cell', position: content }],
      },
    ],
  }
  const narrow: Root = {
    type: 'root',
    children: [
      {
        type: 'element',
        tagName: 'th',
        properties: { dataSourceLine: 1, dataSourceEndLine: 1, style: 'text-align: right' },
        position: content,
        children: [
          {
            type: 'text',
            value: 'ce',
            position: { start: content.start, end: { line: 1, column: 5, offset: 4 } },
          },
          {
            type: 'text',
            value: 'll',
            position: { start: { line: 1, column: 5, offset: 4 }, end: content.end },
          },
        ],
      },
    ],
  }
  expect(digestProjection(wide)).toBe(digestProjection(narrow))
  const wideSource = inspectSourceCorrespondence(wide, source)
  const narrowSource = inspectSourceCorrespondence(narrow, source)
  expect(wideSource.sourceCoordinateFailures).toEqual([])
  expect(narrowSource.sourceCoordinateFailures).toEqual([])
  expect(wideSource.sourceCoordinatesDigest).not.toBe(narrowSource.sourceCoordinatesDigest)
  const misplaced: Root = {
    type: 'root',
    children: [
      {
        type: 'element',
        tagName: 'th',
        properties: { dataSourceLine: 2, dataSourceEndLine: 2 },
        position: content,
        children: [{ type: 'text', value: 'cell' }],
      },
    ],
  }
  expect(digestProjection(wide)).not.toBe(digestProjection(misplaced))
  expect(inspectSourceCorrespondence(misplaced, source).sourceCoordinateFailures).not.toEqual([])
})

test('canonical projection retains whitespace, ordered nesting, list starts and table alignment', () => {
  const text = (value: string): Root => ({ type: 'root', children: [{ type: 'text', value }] })
  expect(digestProjection(text('x\n y'))).not.toBe(digestProjection(text('x y')))
  const structure = (tagName: string, start: number, alignment: string): Root => ({
    type: 'root',
    children: [
      {
        type: 'element',
        tagName,
        properties: { start },
        children: [
          {
            type: 'element',
            tagName: 'td',
            properties: { align: alignment },
            children: [{ type: 'text', value: 'x' }],
          },
        ],
      },
    ],
  })
  expect(digestProjection(structure('ol', 3, 'right'))).not.toBe(
    digestProjection(structure('ul', 3, 'right')),
  )
  expect(digestProjection(structure('ol', 3, 'right'))).not.toBe(
    digestProjection(structure('ol', 4, 'right')),
  )
  expect(digestProjection(structure('ol', 3, 'right'))).not.toBe(
    digestProjection(structure('ol', 3, 'left')),
  )
  const reversed: Root = {
    type: 'root',
    children: [
      {
        type: 'element',
        tagName: 'em',
        properties: {},
        children: [
          {
            type: 'element',
            tagName: 'strong',
            properties: {},
            children: [{ type: 'text', value: 'x' }],
          },
        ],
      },
    ],
  }
  const original: Root = {
    type: 'root',
    children: [
      {
        type: 'element',
        tagName: 'strong',
        properties: {},
        children: [
          {
            type: 'element',
            tagName: 'em',
            properties: {},
            children: [{ type: 'text', value: 'x' }],
          },
        ],
      },
    ],
  }
  expect(digestProjection(original)).not.toBe(digestProjection(reversed))
})

test('UTF-16 source coordinates are validated separately, including CRLF and generated healing', () => {
  const root: Root = {
    type: 'root',
    children: [
      {
        type: 'text',
        value: 'a',
        position: {
          start: { line: 2, column: 1, offset: 4 },
          end: { line: 2, column: 2, offset: 5 },
        },
      },
    ],
  }
  expect(inspectSourceCorrespondence(root, '😀\r\na').sourceCoordinateFailures).toEqual([])
  expect(inspectSourceCorrespondence(root, '😀\r\n').sourceCoordinateFailures).not.toEqual([])
  const wrongColumn: Root = {
    type: 'root',
    children: [
      {
        type: 'text',
        value: 'a',
        position: {
          start: { line: 2, column: 2, offset: 4 },
          end: { line: 2, column: 2, offset: 5 },
        },
      },
    ],
  }
  expect(inspectSourceCorrespondence(wrongColumn, '😀\r\na').sourceCoordinateFailures).not.toEqual(
    [],
  )
  const healed = runNativeTrial({
    factory: () => createMarkdownSession(),
    engine: 'remark',
    trial: 0,
    workload: {
      id: 'healed-strong',
      source: '**open',
      sourceBytes: 6,
      shape: 'healed-strong',
      family: 'streaming-replay',
      scheduleUnits: 2,
    },
    extensions: { raw: null, math: null },
  })
  expect(healed.revisions.every((revision) => revision.sourceCoordinateFailures.length === 0)).toBe(
    true,
  )
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
  expect(compare(faster)).toMatchObject({ domain: 'native', build: 'source', status: 'passed' })
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
    sourceCoordinatesDigest: 'coordinates',
    sourceCoordinateFailures: [],
    positionedNodes: 1,
    unchangedProjection: false,
  }
  expect(mismatchedRevisions([revision], [{ ...revision, outputDigest: 'old' }])).toEqual([0])
  expect(mismatchedRevisions([revision], [])).toEqual([0])
  expect(mismatchedRevisions([revision], [{ ...revision, revision: 1 }])).toEqual([0])
  expect(
    mismatchedRevisions(
      [revision],
      [{ ...revision, sourceCoordinateFailures: ['Invalid source mapping'] }],
    ),
  ).toEqual([0])
  expect(mismatchedRevisions([revision], [{ ...revision, offset: 9 }])).toEqual([0])
  expect(mismatchedRevisions([revision], [{ ...revision, phase: 'settlement' }])).toEqual([0])
})
