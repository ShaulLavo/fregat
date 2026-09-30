import { expect, test } from 'vitest'
import {
  minimapMatches,
  replayMinimapLines,
  replayShikiSource,
  replayTreeSitterSource,
} from '../input-worker-proof.mjs'

test('replays Shiki open text and edit batches against the text before each batch', () => {
  const log = [
    { type: 'open', text: 'abc' },
    {
      type: 'edit',
      edits: [
        { from: 0, to: 0, text: 'X' },
        { from: 3, to: 3, text: 'Y' },
      ],
    },
  ]
  expect(replayShikiSource(log)).toBe('XabcY')
  expect(replayShikiSource([{ type: 'edit', edits: [] }])).toBeNull()
})

test('replays Tree-sitter descriptors with the worker chunk cache rules', () => {
  const log = [
    {
      source: {
        length: 6,
        chunks: [{ chunkId: 'a', text: 'abcdef' }],
        pieces: [{ chunkId: 'a', start: 0, length: 6 }],
      },
    },
    {
      source: {
        length: 7,
        chunks: [{ chunkId: 'b', text: 'x' }],
        pieces: [
          { chunkId: 'a', start: 0, length: 3 },
          { chunkId: 'b', start: 0, length: 1 },
          { chunkId: 'a', start: 3, length: 3 },
        ],
      },
    },
  ]
  expect(replayTreeSitterSource(log)).toBe('abcxdef')
  // A chunk the previous descriptor stopped naming is gone from the worker cache too.
  const forgotten = [
    log[0],
    {
      source: {
        length: 1,
        chunks: [{ chunkId: 'b', text: 'x' }],
        pieces: [{ chunkId: 'b', start: 0, length: 1 }],
      },
    },
    log[0],
  ]
  forgotten[2] = {
    source: { length: 6, chunks: [], pieces: [{ chunkId: 'a', start: 0, length: 6 }] },
  }
  expect(replayTreeSitterSource(forgotten)).toBeNull()
})

test('replays minimap line summaries and patches, matching truncated prefixes by exact length', () => {
  const open = {
    type: 'openDocument',
    document: {
      textLength: 7,
      lines: [
        { text: 'abc', length: 3 },
        { text: 'de', length: 3 },
      ],
    },
  }
  const edit = {
    type: 'applyEdit',
    document: {
      summaryPatch: {
        textLength: 8,
        startLine: 0,
        deleteCount: 1,
        lines: [{ text: 'abcx', length: 4 }],
      },
    },
  }
  expect(minimapMatches(replayMinimapLines([open, edit]), 'abcx\ndef')).toBe(true)
  expect(minimapMatches(replayMinimapLines([open]), 'abcx\ndef')).toBe(false)
  expect(minimapMatches(replayMinimapLines([open]), 'abc\ndef')).toBe(true)
  expect(minimapMatches(replayMinimapLines([open]), 'abc\ndzf')).toBe(false)
})
