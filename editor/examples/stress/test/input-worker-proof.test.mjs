import { expect, test } from 'vitest'
import { runInNewContext } from 'node:vm'
import {
  installInputWorkerProof,
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

// A coalesced sequential undo can restore text length while publishing excess summaries.
test('rejects excess minimap summaries even when final text length and render receipts match', () => {
  const line = { text: '//', length: 2 }
  const open = { type: 'openDocument', document: { textLength: 23, lines: Array(8).fill(line) } }
  const seed = {
    type: 'applyEdits',
    document: {
      summaryPatch: {
        textLength: 35,
        startLine: 2,
        deleteCount: 1,
        lines: [{ text: 'xxxxxxxxxxxx//', length: 14 }],
      },
    },
  }
  const undo = {
    type: 'applyEdits',
    document: {
      summaryPatch: { textLength: 23, startLine: 2, deleteCount: 1, lines: Array(4).fill(line) },
    },
  }
  expect(minimapMatches(replayMinimapLines([open]), Array(8).fill('//').join('\n'))).toBe(true)
  expect(
    minimapMatches(replayMinimapLines([open, seed]), '//\n//\nxxxxxxxxxxxx//\n//\n//\n//\n//\n//'),
  ).toBe(true)
  const restored = replayMinimapLines([open, seed, undo])
  expect(restored.textLength).toBe(23)
  expect(restored.lines).toHaveLength(11)
  expect(minimapMatches(restored, Array(8).fill('//').join('\n'))).toBe(false)
})

function proofPage() {
  const page = {
    Worker: class {
      addEventListener() {}
      postMessage() {}
      terminate() {}
    },
  }
  runInNewContext(`(${installInputWorkerProof.toString()})()`, page)
  return page
}

test('disposal releases syntax payloads and pending requests while keeping cleanup counters', () => {
  const page = proofPage()
  const worker = new page.Worker('shiki.worker.js')
  worker.postMessage({
    id: 1,
    payload: { type: 'open', runtimeSessionId: 'a', text: 'large source' },
  })
  const session = page.__inputWorkerSources.get('a')
  worker.postMessage({ id: 2, payload: { type: 'disposeDocument', runtimeSessionId: 'a' } })
  expect(session.log).toHaveLength(0)
  expect(worker.proof.requests.size).toBe(0)
  expect(page.__inputWorkerSources.size).toBe(0)
  expect(worker.proof.disposedSessions).toBe(1)
})

test('authoritative minimap replacements release prior payloads and preserve later patches', () => {
  const page = proofPage()
  const worker = new page.Worker('minimap.worker.js')
  const first = {
    type: 'openDocument',
    document: { textLength: 3, lines: [{ text: 'old', length: 3 }] },
  }
  const replacement = {
    type: 'replaceDocument',
    document: { textLength: 3, lines: [{ text: 'new', length: 3 }] },
  }
  const patch = {
    type: 'applyEdit',
    document: {
      summaryPatch: {
        textLength: 4,
        startLine: 0,
        deleteCount: 1,
        lines: [{ text: 'newx', length: 4 }],
      },
    },
  }
  worker.postMessage(first)
  worker.postMessage(replacement)
  worker.postMessage(patch)
  expect(worker.proof.minimapLog).toEqual([replacement, patch])
  expect(minimapMatches(replayMinimapLines(worker.proof.minimapLog), 'newx')).toBe(true)
  worker.postMessage(first)
  expect(worker.proof.minimapLog).toEqual([first])
  expect(worker.proof.sourceUpdates).toBe(4)
})

test('minimap source generations keep earlier renders stale after log compaction', () => {
  const page = proofPage()
  const worker = new page.Worker('minimap.worker.js')
  worker.postMessage({ type: 'openDocument', document: { lines: [] } })
  worker.postMessage({ type: 'render', sequence: 1 })
  expect(worker.proof.renderAfterSource).toBe(worker.proof.sourceUpdates)
  worker.postMessage({ type: 'replaceDocument', document: { lines: [] } })
  expect(worker.proof.minimapLog).toHaveLength(1)
  expect(worker.proof.renderAfterSource).toBe(1)
  expect(worker.proof.sourceUpdates).toBe(2)
  worker.postMessage({ type: 'render', sequence: 2 })
  expect(worker.proof.renderAfterSource).toBe(worker.proof.sourceUpdates)
})

test('termination releases syntax and minimap histories between repetitions', () => {
  const page = proofPage()
  const syntax = new page.Worker('treeSitter.worker.js')
  syntax.postMessage({
    id: 1,
    payload: { type: 'parse', runtimeSessionId: 'a', source: { chunks: [{ text: 'source' }] } },
  })
  const session = page.__inputWorkerSources.get('a')
  const minimap = new page.Worker('minimap.worker.js')
  minimap.postMessage({
    type: 'openDocument',
    document: { lines: [{ text: 'summary', length: 7 }] },
  })
  syntax.terminate()
  minimap.terminate()
  expect(session.log).toHaveLength(0)
  expect(syntax.proof.requests.size).toBe(0)
  expect(minimap.proof.minimapLog).toHaveLength(0)
  expect(page.__inputWorkerSources.size).toBe(0)
  expect(page.__inputWorkerProof.every((proof) => proof.terminated)).toBe(true)
})
