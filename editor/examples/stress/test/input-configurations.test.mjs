import { expect, test } from 'vitest'
import {
  analysisLimitCodeUnits,
  inputConsumerConfiguration,
  minimapLimitCodeUnits,
} from '../input-configurations.mjs'
import { assertConsumerReadiness } from '../input-output.mjs'

const owner = { lifecycle: 'ready', pendingRequests: 0, lastError: null }
const worker = (name, extra = {}) => ({
  url: `/assets/${name}.worker-x.js`,
  minimap: name === 'minimap',
  terminated: false,
  sourceUpdates: 0,
  latestRender: 0,
  acceptedRender: 0,
  ...extra,
})
const minimap = (sourceUpdates = 1) =>
  worker('minimap', { sourceUpdates, latestRender: 3, acceptedRender: 3 })

const session = (kind, extra = {}) => ({
  kind,
  current: true,
  answered: true,
  failed: false,
  requestedVersion: kind === 'treeSitter' ? 2 : null,
  answeredVersion: kind === 'treeSitter' ? 2 : null,
  ...extra,
})

function readiness(id, overrides = {}) {
  const configuration = inputConsumerConfiguration(id, 'ordinary', 4469)
  const syntax = configuration.treeSitter || configuration.shiki
  return {
    configuration,
    tree: configuration.treeSitter ? owner : null,
    shiki: configuration.shiki
      ? { ...owner, maxTokenizationLineLength: 20_000, untokenizedLines: 0 }
      : null,
    sessions: [
      ...(configuration.treeSitter ? [session('treeSitter')] : []),
      ...(configuration.shiki ? [session('shiki')] : []),
    ],
    minimaps: configuration.minimap ? [{ current: true, renderedAfterSource: true }] : [],
    overLimitLines: 0,
    lineCount: 1,
    rowColor: 'rgb(225, 228, 232)',
    highlights: syntax ? [{ name: 'editor-shared-token-0', ranges: 4 }] : [],
    views: [
      {
        initialHighlightStatus: syntax ? 'painted' : 'plain',
        visible: true,
        tokenRanges: syntax ? 4 : 0,
        minimapElements: configuration.minimap ? 1 : 0,
        gutterElements: configuration.platform ? 2 : 0,
      },
    ],
    workers: [
      ...(configuration.treeSitter ? [worker('treeSitter')] : []),
      ...(configuration.shiki ? [worker('shiki')] : []),
      ...(configuration.minimap ? [minimap()] : []),
    ],
    ...overrides,
  }
}

test('accepts each configuration when exactly its consumers produced output', () => {
  for (const id of ['disabled', 'tree-sitter', 'shiki', 'minimap', 'all', 'platform'])
    expect(() =>
      assertConsumerReadiness(readiness(id), id, 'ordinary', 4469, 'single', 'typing', null),
    ).not.toThrow()
})

test('rejects a missing, extra, stalled or silent consumer', () => {
  const cases = [
    ['minimap', { workers: [] }],
    ['minimap', { minimaps: [{ current: true, renderedAfterSource: false }] }],
    ['tree-sitter', { tree: { ...owner, pendingRequests: 1 } }],
    ['shiki', { highlights: [] }],
    ['disabled', { workers: [worker('shiki')] }],
    [
      'platform',
      {
        views: [
          {
            initialHighlightStatus: 'painted',
            visible: true,
            minimapElements: 1,
            gutterElements: 0,
          },
        ],
      },
    ],
  ]
  for (const [id, overrides] of cases)
    expect(() =>
      assertConsumerReadiness(
        readiness(id, overrides),
        id,
        'ordinary',
        4469,
        'single',
        'typing',
        null,
      ),
    ).toThrow(/Consumer readiness/)
})

test('rejects one stale minimap view while another holds the current text', () => {
  const views = (count) =>
    Array.from({ length: count }, (_, index) => ({
      initialHighlightStatus: 'plain',
      visible: index < 2,
      tokenRanges: 0,
      minimapElements: 1,
      gutterElements: 0,
    }))
  const three = (receipts) =>
    readiness('minimap', {
      views: views(3),
      workers: [minimap(), minimap(), minimap()],
      minimaps: receipts,
    })
  const ok = { current: true, renderedAfterSource: true }
  const assert = (state) => () =>
    assertConsumerReadiness(state, 'minimap', 'ordinary', 4469, 'multiple', 'typing', null)
  expect(assert(three([ok, ok, ok]))).not.toThrow()
  expect(assert(three([ok, { ...ok, current: false }, ok]))).toThrow(
    /minimap 1 holds text that differs/,
  )
  expect(assert(three([ok, ok, { ...ok, renderedAfterSource: false }]))).toThrow(
    /minimap 2 has no accepted render/,
  )
  expect(assert(three([ok, ok]))).toThrow(/minimap receipts 2 for 3 workers/)
})

test('pauses analysis consumers above the Platform analysis limit', () => {
  const paused = inputConsumerConfiguration('platform', 'short-lines', analysisLimitCodeUnits + 1)
  expect(paused).toMatchObject({ analysis: false, treeSitter: false, shiki: false, minimap: true })
  expect(inputConsumerConfiguration('all', 'long-line', minimapLimitCodeUnits + 1)).toMatchObject({
    minimap: false,
  })
})

test('accepts one plain line painted across two uniformly coloured rendered chunks', () => {
  const plain = readiness('shiki', {
    shiki: { ...owner, maxTokenizationLineLength: 20_000, untokenizedLines: 1 },
    overLimitLines: 1,
    highlights: [{ name: 'editor-shared-token-0', ranges: 2, color: '#e1e4e8' }],
    views: [
      {
        initialHighlightStatus: 'painted',
        visible: true,
        tokenRanges: 2,
        plainCoverage: { chunks: 2, covered: 2 },
        minimapElements: 0,
        gutterElements: 0,
      },
    ],
  })
  expect(() =>
    assertConsumerReadiness(plain, 'shiki', 'ordinary', 4469, 'single', 'typing', null),
  ).not.toThrow()
})

test('rejects missing plain coverage, wrong colour, range accounting, counts and limit', () => {
  const shiki = { ...owner, maxTokenizationLineLength: 20_000, untokenizedLines: 1 }
  const view = {
    initialHighlightStatus: 'painted',
    visible: true,
    tokenRanges: 2,
    plainCoverage: { chunks: 2, covered: 2 },
    minimapElements: 0,
    gutterElements: 0,
  }
  const base = {
    shiki,
    overLimitLines: 1,
    highlights: [{ name: 'editor-shared-token-0', ranges: 2, color: '#e1e4e8' }],
    views: [view],
  }
  const cases = [
    { views: [{ ...view, plainCoverage: { chunks: 2, covered: 1 } }] },
    { views: [{ ...view, plainCoverage: { chunks: 0, covered: 0 } }] },
    { views: [{ ...view, plainCoverage: null }] },
    { highlights: [{ name: 'editor-shared-token-0', ranges: 2, color: '#ff0000' }] },
    { highlights: [{ name: 'editor-shared-token-0', ranges: 1, color: '#e1e4e8' }] },
    { shiki: { ...shiki, untokenizedLines: 0 } },
    { shiki: { ...shiki, untokenizedLines: 2 } },
    { overLimitLines: 0 },
    {
      highlights: [
        { name: 'editor-shared-token-0', ranges: 1, color: '#e1e4e8' },
        { name: 'editor-shared-token-1', ranges: 1, color: '#ff0000' },
      ],
    },
    { shiki: { ...shiki, maxTokenizationLineLength: null } },
  ]
  for (const overrides of cases)
    expect(() =>
      assertConsumerReadiness(
        readiness('shiki', { ...base, ...overrides }),
        'shiki',
        'ordinary',
        4469,
        'single',
        'typing',
        null,
      ),
    ).toThrow(/Consumer readiness/)
})

test('rejects a consumer session that is stale, unanswered, failed or missing for a view', () => {
  const cases = [
    ['tree-sitter', { sessions: [session('treeSitter', { current: false })] }],
    ['tree-sitter', { sessions: [session('treeSitter', { answered: false })] }],
    ['tree-sitter', { sessions: [session('treeSitter', { failed: true })] }],
    ['tree-sitter', { sessions: [session('treeSitter', { answeredVersion: 1 })] }],
    ['tree-sitter', { sessions: [] }],
    ['shiki', { sessions: [] }],
    ['tree-sitter-shiki', { sessions: [session('shiki')] }],
    ['disabled', { sessions: [session('shiki')] }],
  ]
  for (const [id, overrides] of cases)
    expect(() =>
      assertConsumerReadiness(
        readiness(id, overrides),
        id,
        'ordinary',
        4469,
        'single',
        'typing',
        null,
      ),
    ).toThrow(/Consumer readiness/)
})

test('rejects a visible view without token ranges while another view has them', () => {
  const view = (tokenRanges) => ({
    initialHighlightStatus: 'painted',
    visible: true,
    tokenRanges,
    minimapElements: 0,
    gutterElements: 0,
  })
  const two = readiness('tree-sitter', {
    views: [view(4), view(0), { ...view(0), visible: false }],
  })
  expect(() =>
    assertConsumerReadiness(two, 'tree-sitter', 'ordinary', 4469, 'multiple', 'typing', null),
  ).toThrow(/view 1 has no token ranges/)
  const both = readiness('tree-sitter', {
    views: [view(4), view(3), { ...view(0), visible: false }],
  })
  expect(() =>
    assertConsumerReadiness(both, 'tree-sitter', 'ordinary', 4469, 'multiple', 'typing', null),
  ).not.toThrow()
})

test('scopes the pending minimap exception to final short-lines undo source equality', () => {
  const stale = readiness('minimap', {
    minimaps: [{ current: false, renderedAfterSource: true }],
  })
  const assert =
    (fixture, scenario, opened, pending = true) =>
    () =>
      assertConsumerReadiness(stale, 'minimap', fixture, 4469, 'single', scenario, opened, pending)
  expect(assert('short-lines', 'undo', {})).not.toThrow()
  expect(assert('short-lines', 'undo', {}, false)).toThrow(/holds text that differs/)
  expect(assert('short-lines', 'undo', null)).toThrow(/holds text that differs/)
  expect(assert('ordinary', 'undo', {})).toThrow(/holds text that differs/)
  expect(assert('short-lines', 'typing', {})).toThrow(/holds text that differs/)
  stale.minimaps[0].renderedAfterSource = false
  expect(assert('short-lines', 'undo', {})).toThrow(/has no accepted render/)
})
