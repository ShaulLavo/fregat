import { expect, test } from 'vitest'
import {
  analysisLimitCodeUnits,
  assertConsumerReadiness,
  inputConsumerConfiguration,
  minimapLimitCodeUnits,
} from '../input-configurations.mjs'

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
    [
      'minimap',
      { workers: [worker('minimap', { sourceUpdates: 1, latestRender: 4, acceptedRender: 3 })] },
    ],
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

test('requires the minimap to receive the input edit', () => {
  const opened = readiness('minimap')
  expect(() =>
    assertConsumerReadiness(
      readiness('minimap'),
      'minimap',
      'ordinary',
      4469,
      'single',
      'typing',
      opened,
    ),
  ).toThrow(/no edit/)
  const edited = readiness('minimap', { workers: [minimap(2)] })
  expect(() =>
    assertConsumerReadiness(edited, 'minimap', 'ordinary', 4469, 'single', 'typing', opened),
  ).not.toThrow()
})

test('pauses analysis consumers above the Platform analysis limit', () => {
  const paused = inputConsumerConfiguration('platform', 'short-lines', analysisLimitCodeUnits + 1)
  expect(paused).toMatchObject({ analysis: false, treeSitter: false, shiki: false, minimap: true })
  expect(inputConsumerConfiguration('all', 'long-line', minimapLimitCodeUnits + 1)).toMatchObject({
    minimap: false,
  })
})

test('accepts uniform plain output when the reported plain lines match the text', () => {
  const plain = readiness('shiki', {
    shiki: { ...owner, maxTokenizationLineLength: 20_000, untokenizedLines: 1 },
    overLimitLines: 1,
    highlights: [{ name: 'editor-shared-token-0', ranges: 1, color: '#e1e4e8' }],
    views: [
      {
        initialHighlightStatus: 'painted',
        visible: true,
        tokenRanges: 1,
        minimapElements: 0,
        gutterElements: 0,
      },
    ],
  })
  expect(() =>
    assertConsumerReadiness(plain, 'shiki', 'ordinary', 4469, 'single', 'typing', null),
  ).not.toThrow()
})

test('rejects plain output with a wrong count, a second colour or a missing limit', () => {
  const base = { ...owner, maxTokenizationLineLength: 20_000, untokenizedLines: 1 }
  const cases = [
    { shiki: { ...base, untokenizedLines: 0 }, overLimitLines: 1 },
    { shiki: { ...base, untokenizedLines: 2 }, overLimitLines: 1 },
    {
      shiki: base,
      overLimitLines: 1,
      highlights: [{ name: 'editor-shared-token-0', ranges: 2, color: '#e1e4e8' }],
    },
    { shiki: base, overLimitLines: 0 },
    {
      shiki: base,
      overLimitLines: 1,
      highlights: [
        { name: 'editor-shared-token-0', ranges: 1, color: '#e1e4e8' },
        { name: 'editor-shared-token-1', ranges: 1, color: '#ff0000' },
      ],
    },
    { shiki: { ...base, maxTokenizationLineLength: null }, overLimitLines: 1 },
  ]
  for (const overrides of cases)
    expect(() =>
      assertConsumerReadiness(
        readiness('shiki', overrides),
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
