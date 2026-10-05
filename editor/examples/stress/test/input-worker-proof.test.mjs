import { expect, test } from 'vitest'
import { runInNewContext } from 'node:vm'
import {
  installInputWorkerProof,
  minimapMatches,
  replayMinimapLines,
  replayShikiSource,
  replayTreeSitterSource,
  replayCanonicalSource,
  minimapProofState,
  minimapRenderAccepted,
  attestMinimapCurrentSource,
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
      handlers = []
      addEventListener(_type, handler) {
        this.handlers.push(handler)
      }
      emit(data) {
        for (const handler of this.handlers) handler({ data })
      }
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
  const session = [...page.__inputWorkerSources.values()].find(
    (session) => session.worker === worker.proof,
  )
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
  const session = [...page.__inputWorkerSources.values()].find(
    (session) => session.worker === syntax.proof,
  )
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

const identity = {
  documentId: 'document',
  documentGeneration: 1,
  endpointGeneration: 1,
  registrationId: 1,
}
const point = { segment: 'segment', revision: 0, textVersion: 0 }
function resetSource(worker, text = 'abc') {
  const command = { kind: 'reset', identity, base: null, target: point, chunks: [text] }
  worker.postMessage({ id: 1, payload: { type: 'source', command } })
  worker.emit({ id: 1, ok: true, result: { kind: 'applied', identity, base: null, target: point } })
}
function consumeSource(worker, kind = 'parse', at = point, id = 3) {
  const reference = { identity, point: at, readId: 'read' }
  worker.postMessage({
    id: id - 1,
    payload: { type: 'source', command: { kind: 'pin', identity, point: at, readId: 'read' } },
  })
  worker.emit({ id: id - 1, ok: true, result: { kind: 'pinned', reference } })
  worker.postMessage({
    id,
    payload: {
      type: kind,
      runtimeSessionId: 'work',
      snapshotVersion: at.textVersion,
      source: reference,
    },
  })
  worker.emit({ id, ok: true, result: { snapshotVersion: at.textVersion } })
}
function observedSession(page, worker) {
  return [...page.__inputWorkerSources.values()].find((session) => session.worker === worker.proof)
}

test('canonical source replay follows acknowledged base edits and exact pinned references', () => {
  const page = proofPage()
  const worker = new page.Worker('treeSitter.worker.js')
  resetSource(worker, 'abc😀')
  consumeSource(worker)
  expect(replayCanonicalSource(observedSession(page, worker).canonical)).toBe('abc😀')
  const next = { ...point, revision: 1, textVersion: 1 }
  const command = {
    kind: 'advance',
    identity,
    base: point,
    target: next,
    edits: [
      { from: 0, to: 0, text: 'X' },
      { from: 3, to: 3, text: 'Y' },
    ],
  }
  worker.postMessage({ id: 4, payload: { type: 'source', command } })
  worker.emit({ id: 4, ok: true, result: { kind: 'applied', identity, base: point, target: next } })
  expect(replayCanonicalSource(observedSession(page, worker).canonical)).toBeNull()
  consumeSource(worker, 'edit', next, 6)
  const session = observedSession(page, worker)
  expect(replayCanonicalSource(session.canonical)).toBe('XabcY😀')
  worker.postMessage({
    id: 7,
    payload: { type: 'source', command: { kind: 'unpin', identity, readId: 'read' } },
  })
  expect(worker.proof.reads.size).toBe(0)
  expect(replayCanonicalSource(session.canonical)).toBe('XabcY😀')
  worker.terminate()
  expect(page.__inputWorkerSources.size).toBe(0)
  expect(worker.proof.documents.size).toBe(0)
  expect(session.canonical).toBeNull()
})

test.each(['unanswered', 'identity', 'base', 'target', 'textVersion'])(
  'canonical %s ACK cannot establish current source',
  (fault) => {
    const page = proofPage()
    const worker = new page.Worker('shiki.worker.js')
    worker.postMessage({
      id: 1,
      payload: {
        type: 'source',
        command: { kind: 'reset', identity, base: null, target: point, chunks: ['abc'] },
      },
    })
    const receipt = { kind: 'applied', identity, base: null, target: point }
    if (fault === 'identity') receipt.identity = { ...identity, registrationId: 2 }
    if (fault === 'base') receipt.base = point
    if (fault === 'target') receipt.target = { ...point, revision: 1 }
    if (fault === 'textVersion') receipt.target = { ...point, textVersion: 1 }
    if (fault !== 'unanswered') worker.emit({ id: 1, ok: true, result: receipt })
    consumeSource(worker, 'open')
    expect(replayCanonicalSource(observedSession(page, worker).canonical)).toBeNull()
  },
)

test('identical domain session names in different workers stay independent', () => {
  const page = proofPage()
  const first = new page.Worker('shiki.worker.js')
  const second = new page.Worker('treeSitter.worker.js')
  first.postMessage({ id: 1, payload: { type: 'open', runtimeSessionId: 'same', text: 'first' } })
  second.postMessage({
    id: 1,
    payload: {
      type: 'parse',
      runtimeSessionId: 'same',
      source: { chunks: [], pieces: [], length: 0 },
    },
  })
  expect(page.__inputWorkerSources.size).toBe(2)
  first.terminate()
  expect(page.__inputWorkerSources.size).toBe(1)
  expect([...page.__inputWorkerSources.values()][0].kind).toBe('treeSitter')
})

test('projected minimap needs full source ACK and matching rendered receipt', () => {
  const page = proofPage()
  const worker = new page.Worker('minimap.worker.js')
  const projection = {
    kind: 'reset',
    summary: { lines: [{ text: 'abc', length: 3 }], textLength: 3 },
  }
  const message = {
    type: 'projectSource',
    requestId: 1,
    identity,
    base: null,
    target: point,
    projection,
  }
  const receipt = { kind: 'applied', identity, base: null, target: point }
  worker.postMessage(message)
  expect(replayMinimapLines(worker.proof.minimapLog)).toBeNull()
  worker.emit({ type: 'sourceApplied', requestId: 1, receipt })
  expect(minimapMatches(replayMinimapLines(worker.proof.minimapLog), 'abc')).toBe(true)
  worker.postMessage({ type: 'render', sequence: 1, source: receipt })
  worker.emit({
    type: 'rendered',
    sequence: 1,
    source: { ...receipt, target: { ...point, textVersion: 1 } },
  })
  expect(minimapRenderAccepted(worker.proof, [worker.proof], true)).toBe(false)
  worker.emit({ type: 'rendered', sequence: 1, source: receipt })
  expect(minimapRenderAccepted(worker.proof, [worker.proof], true)).toBe(true)
  const next = { ...point, revision: 1, textVersion: 1 }
  worker.postMessage({
    type: 'projectSource',
    requestId: 2,
    identity,
    base: point,
    target: next,
    projection: {
      kind: 'patch',
      summary: {
        startLine: 0,
        deleteCount: 1,
        lines: [{ text: 'abcX', length: 4 }],
        textLength: 4,
      },
      edits: [{ from: 3, to: 3, text: 'X' }],
    },
  })
  expect(minimapRenderAccepted(worker.proof, [worker.proof], true)).toBe(false)
  worker.emit({
    type: 'sourceApplied',
    requestId: 2,
    receipt: { kind: 'applied', identity, base: point, target: next },
  })
  expect(minimapMatches(replayMinimapLines(worker.proof.minimapLog), 'abcX')).toBe(true)
  expect(minimapRenderAccepted(worker.proof, [worker.proof], true)).toBe(false)
})

test('dormant hidden minimap requires actual view identity and proven canonical worker family', () => {
  const visible = {
    url: 'minimap',
    minimap: true,
    terminated: false,
    protocol: 'canonical',
    viewId: 'view-0',
    sourceUpdates: 1,
    renderAfterSource: 1,
    latestRender: 1,
    acceptedRender: 1,
    sourceAcknowledged: true,
    renderSourceMatched: true,
    acceptedSourceMatched: true,
    pendingSourceRequests: 0,
    pendingRenderRequests: 0,
    failedResponses: 0,
    staleResponses: 0,
  }
  const hidden = {
    ...visible,
    protocol: null,
    viewId: 'view-2',
    sourceUpdates: 0,
    renderAfterSource: 0,
    latestRender: 0,
    acceptedRender: 0,
    sourceAcknowledged: false,
    renderSourceMatched: false,
    acceptedSourceMatched: false,
  }
  expect(minimapProofState(hidden, [visible, hidden], false).dormant).toBe(true)
  expect(minimapRenderAccepted(hidden, [visible, hidden], false)).toBe(true)
  expect(minimapRenderAccepted(hidden, [visible, hidden], true)).toBe(false)
  expect(minimapRenderAccepted({ ...hidden, viewId: null }, [visible, hidden], false)).toBe(false)
  expect(minimapRenderAccepted({ ...hidden, url: 'other' }, [visible, hidden], false)).toBe(false)
  expect(minimapRenderAccepted(hidden, [hidden], false)).toBe(false)
})

test('registered render cancellation retires pending work and a later fully attested frame restores freshness', () => {
  const { worker, receipt } = projectedMinimap()
  worker.postMessage({ type: 'render', sequence: 1, source: receipt })
  worker.emit({ type: 'renderSkipped', sequence: 1 })
  expect(worker.proof.pendingRenderRequests).toBe(0)
  expect(worker.proof.canceledRenders).toBe(1)
  expect(worker.proof.failedResponses).toBe(0)
  expect(worker.proof.acceptedRender).toBe(0)
  expect(minimapRenderAccepted(worker.proof, [worker.proof], false)).toBe(false)
  worker.postMessage({ type: 'render', sequence: 2, source: receipt })
  worker.emit({ type: 'rendered', sequence: 2, source: receipt })
  expect(minimapMatches(replayMinimapLines(worker.proof.minimapLog), 'abc')).toBe(true)
  attestMinimapCurrentSource(worker.proof)
  expect(worker.proof.pendingRenderRequests).toBe(0)
  expect(minimapRenderAccepted(worker.proof, [worker.proof], true)).toBe(true)
  expect(minimapProofState(worker.proof, [worker.proof], false).dormant).toBe(true)
})

test('unknown render cancellation stays stale and cannot retire a registered frame', () => {
  const { worker, receipt } = projectedMinimap()
  worker.postMessage({ type: 'render', sequence: 2, source: receipt })
  worker.emit({ type: 'renderSkipped', sequence: 999 })
  expect(worker.proof.pendingRenderRequests).toBe(1)
  expect(worker.proof.canceledRenders).toBe(0)
  expect(worker.proof.staleResponses).toBe(1)
  expect(worker.proof.acceptedRender).toBe(0)
  expect(minimapRenderAccepted(worker.proof, [worker.proof], false)).toBe(false)
  worker.emit({ type: 'rendered', sequence: 2, source: receipt })
  attestMinimapCurrentSource(worker.proof)
  expect(worker.proof.staleResponses).toBe(1)
  expect(minimapProofState(worker.proof, [worker.proof], false).dormant).toBe(false)
})

function projectedMinimap() {
  const page = proofPage()
  const worker = new page.Worker('minimap.worker.js')
  worker.proof.viewId = 'view-2'
  worker.postMessage({
    type: 'projectSource',
    requestId: 1,
    identity,
    base: null,
    target: point,
    projection: { kind: 'reset', summary: { lines: [{ text: 'abc', length: 3 }], textLength: 3 } },
  })
  const receipt = { kind: 'applied', identity, base: null, target: point }
  worker.emit({ type: 'sourceApplied', requestId: 1, receipt })
  return { worker, receipt }
}

test('Shiki wrapped ACKs and imported read loans preserve exact source and retire on release', () => {
  const page = proofPage()
  const worker = new page.Worker('shiki.worker.js')
  const reference = { identity, point, readId: 'imported' }
  worker.postMessage({
    id: 1,
    payload: {
      type: 'source',
      command: { kind: 'importRead', identity, point, readId: 'imported', chunks: ['ab', '😀c'] },
    },
  })
  worker.emit({ id: 1, ok: true, result: { source: { kind: 'pinned', reference } } })
  worker.postMessage({
    id: 2,
    payload: { type: 'open', runtimeSessionId: 'work', source: reference },
  })
  worker.emit({ id: 2, ok: true, result: { tokensPacked: [] } })
  const session = observedSession(page, worker)
  expect(replayCanonicalSource(session.canonical)).toBe('ab😀c')
  worker.postMessage({ id: 3, payload: { type: 'source', command: { kind: 'release', identity } } })
  expect(replayCanonicalSource(session.canonical)).toBeNull()
  expect(worker.proof.reads.size).toBe(0)
})

test('release removes pending imported reads so their late ACK cannot recreate a loan', () => {
  const page = proofPage()
  const worker = new page.Worker('shiki.worker.js')
  const reference = { identity, point, readId: 'late' }
  worker.postMessage({
    id: 1,
    payload: {
      type: 'source',
      command: { kind: 'importRead', identity, point, readId: 'late', chunks: ['ab😀c'] },
    },
  })
  worker.postMessage({ id: 2, payload: { type: 'source', command: { kind: 'release', identity } } })
  expect(worker.proof.sourceRequests.size).toBe(0)
  worker.emit({ id: 1, ok: true, result: { source: { kind: 'pinned', reference } } })
  expect(worker.proof.reads.size).toBe(0)
  worker.postMessage({
    id: 3,
    payload: { type: 'open', runtimeSessionId: 'late-work', source: reference },
  })
  expect(replayCanonicalSource(observedSession(page, worker).canonical)).toBeNull()
})
