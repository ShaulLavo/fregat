import { expect, test } from 'vitest'
import { assertConsumerReadiness, inputConsumerConfiguration } from '../input-configurations.mjs'

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
  const configuration = inputConsumerConfiguration(id, 'ordinary')
  const syntax = configuration.treeSitter || configuration.shiki
  return {
    configuration,
    tree: configuration.treeSitter ? owner : null,
    shiki: configuration.shiki ? owner : null,
    highlights: syntax ? [{ name: 'editor-shared-token-0', ranges: 4 }] : [],
    views: [
      {
        initialHighlightStatus: syntax ? 'painted' : 'plain',
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
      assertConsumerReadiness(readiness(id), id, 'ordinary', 'single', 'typing', null),
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
      { views: [{ initialHighlightStatus: 'painted', minimapElements: 1, gutterElements: 0 }] },
    ],
  ]
  for (const [id, overrides] of cases)
    expect(() =>
      assertConsumerReadiness(readiness(id, overrides), id, 'ordinary', 'single', 'typing', null),
    ).toThrow(/Consumer readiness/)
})

test('requires the minimap to receive the input edit', () => {
  const opened = readiness('minimap')
  expect(() =>
    assertConsumerReadiness(
      readiness('minimap'),
      'minimap',
      'ordinary',
      'single',
      'typing',
      opened,
    ),
  ).toThrow(/no edit/)
  const edited = readiness('minimap', { workers: [minimap(2)] })
  expect(() =>
    assertConsumerReadiness(edited, 'minimap', 'ordinary', 'single', 'typing', opened),
  ).not.toThrow()
})
