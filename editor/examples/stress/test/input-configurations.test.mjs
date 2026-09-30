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

function readiness(id, overrides = {}) {
  const configuration = inputConsumerConfiguration(id, 'ordinary', 4469)
  const syntax = configuration.treeSitter || configuration.shiki
  return {
    configuration,
    tree: configuration.treeSitter ? owner : null,
    shiki: configuration.shiki
      ? { ...owner, maxTokenizationLineLength: 20_000, untokenizedLines: 0 }
      : null,
    overLimitLines: 0,
    rowColor: 'rgb(225, 228, 232)',
    highlights: syntax ? [{ name: 'editor-shared-token-0', ranges: 4 }] : [],
    views: [
      {
        initialHighlightStatus: syntax ? 'painted' : 'plain',
        visible: true,
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
    shiki: { ...owner, maxTokenizationLineLength: 20_000, untokenizedLines: 3 },
    overLimitLines: 1,
    highlights: [{ name: 'editor-shared-token-0', ranges: 1, color: '#e1e4e8' }],
  })
  expect(() =>
    assertConsumerReadiness(plain, 'shiki', 'ordinary', 4469, 'single', 'typing', null),
  ).not.toThrow()
})

test('rejects plain output with a wrong count, a second colour or a missing limit', () => {
  const base = { ...owner, maxTokenizationLineLength: 20_000, untokenizedLines: 1 }
  const cases = [
    { shiki: { ...base, untokenizedLines: 0 }, overLimitLines: 1 },
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
