import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import os from 'node:os'
import {
  CharIdAllocator,
  createPieceTableSnapshot,
  locateCharId,
} from '@singapore-editor/textbuffer'
import { Participant, TextbufferEngine } from '../dist/index.js'

const originalText = `${'x'.repeat(80)}\n`.repeat(100_000)
const original = createPieceTableSnapshot(originalText, {
  normalized: true,
  charIds: { bunch: 'initial:0', counter: 0 },
})
const initial = (counter) => ({ bunch: 'initial:0', counter })
function envelope(actor, seq, change, deps = []) {
  return { document: 'fragmented', epoch: '1', id: { actor, seq }, lamport: seq, deps, change }
}
function countNodes(node) {
  let count = 0
  const stack = node ? [node] : []
  while (stack.length) {
    const current = stack.pop()
    count++
    if (current.left) stack.push(current.left)
    if (current.right) stack.push(current.right)
  }
  return count
}
function restore(saved) {
  const engine = new TextbufferEngine()
  engine.restore(saved)
  assert.equal(engine.snapshot(), saved)
  return engine
}
function build(kind) {
  const engine = new TextbufferEngine(original)
  const allocators = Array.from({ length: 5 }, (_, a) => new CharIdAllocator(`author${a}`))
  const inserted = []
  const start = performance.now()
  let left = initial(originalText.length - 1)
  for (let round = 0; round < 10_000; round++) {
    // Five authors see the same committed previous round and write concurrent single-unit edits.
    // Scattered batches are independent bootstrap gaps; tail batches extend the prior committed tail.
    const offset = 1 + ((round * 7919) % 10_000) * 810
    const originLeft = kind === 'scattered' ? initial(offset - 1) : left
    const originRight = kind === 'scattered' ? initial(offset) : 'end'
    for (let author = 0; author < 5; author++) {
      const id = allocators[author].generateAfter(originLeft, 1)
      const text = String.fromCharCode(97 + author)
      const deps = round
        ? Array.from({ length: 5 }, (_, prior) => ({ actor: `author${prior}`, seq: round }))
        : []
      engine.apply(
        envelope(
          `author${author}`,
          round + 1,
          { kind: 'insert', start: id, originLeft, originRight, text },
          deps,
        ),
      )
      inserted.push(id)
    }
    left = inserted.at(-1)
  }
  // Hide three of each five concurrent inserts, retaining the final tail to exercise successor ascent.
  const deletes = []
  for (let round = 0; round < 10_000; round++) {
    for (const author of [0, 2, 4]) {
      if (kind === 'deep-tail' && round === 9999 && author === 4) continue
      deletes.push({ start: inserted[round * 5 + author], count: 1 })
    }
  }
  for (let i = 0; i < deletes.length; i += 100)
    engine.apply(envelope('deleter', i + 1, { kind: 'delete', spans: deletes.slice(i, i + 100) }))
  const saved = engine.snapshot()
  for (const span of deletes)
    assert.equal(locateCharId(saved.buffer, span.start).liveness, 'deleted')
  let expected
  if (kind === 'deep-tail') expected = originalText + 'bd'.repeat(9999) + 'bde'
  else {
    const parts = []
    for (let gap = 0; gap < 10_000; gap++)
      parts.push(
        originalText.slice(gap * 810, gap * 810 + 1),
        'bd',
        originalText.slice(gap * 810 + 1, (gap + 1) * 810),
      )
    expected = parts.join('')
  }
  assert.equal(engine.text(), expected)
  assert.ok(saved.buffer.charIds)
  console.error(
    JSON.stringify({ phase: 'history-built', kind, setupMs: performance.now() - start }),
  )
  return {
    kind,
    saved,
    expected,
    metadata: {
      insertionEdits: 50_000,
      authors: 5,
      concurrentBatchSize: 5,
      tombstones: deletes.length,
      placementRuns: countNodes(saved.runs),
      forkRecords: countNodes(saved.forks),
      textUnits: saved.buffer.length,
    },
  }
}
const percentile = (values, fraction) =>
  values.toSorted((a, b) => a - b)[
    Math.min(values.length - 1, Math.floor(values.length * fraction))
  ]
function summarize(values) {
  return {
    count: values.length,
    medianMs: percentile(values, 0.5),
    p99Ms: percentile(values, 0.99),
    maxMs: Math.max(...values),
    over8_3Ms: values.filter((v) => v > 8.3).length,
  }
}
function typing(history, offset) {
  const values = []
  for (let sample = -5; sample < 31; sample++) {
    const engine = restore(history.saved)
    const allocator = new CharIdAllocator('typing')
    for (let i = 0; i < 100; i++) {
      const before = performance.now()
      const edit = engine.author(
        { offset: offset + i, deleteCount: 0, text: 'T' },
        {
          document: 'fragmented',
          epoch: '1',
          id: { actor: 'typing', seq: i + 1 },
          lamport: i + 1,
          deps: [],
          allocate: (left, count) => allocator.generateAfter(left, count),
        },
      )
      engine.apply(edit)
      const elapsed = performance.now() - before
      if (sample >= 0) values.push(elapsed)
    }
    assert.equal(
      engine.text(),
      history.expected.slice(0, offset) + 'T'.repeat(100) + history.expected.slice(offset),
    )
    assert.equal(history.saved.buffer.length, history.expected.length)
  }
  return summarize(values)
}
function reconcile(history, offset, pending) {
  const values = []
  for (let sample = -5; sample < 31; sample++) {
    const engine = restore(history.saved)
    const user = new Participant({ actor: 'local', document: 'fragmented', epoch: '1', engine })
    for (let i = 0; i < pending; i++) user.local({ offset: offset + i, deleteCount: 0, text: 'T' })
    const remote = new Participant({
      actor: 'remote',
      document: 'fragmented',
      epoch: '1',
      engine: restore(history.saved),
    })
    const edit = remote.local({ offset, deleteCount: 0, text: 'R' })
    // Observe actual restore + host apply + original pending replay, not an equivalent direct edit.
    let restores = 0,
      applies = 0
    const restoreMethod = engine.restore.bind(engine),
      applyMethod = engine.apply.bind(engine)
    engine.restore = (state) => {
      restores++
      restoreMethod(state)
    }
    engine.apply = (edit) => {
      applies++
      applyMethod(edit)
    }
    const message = {
      document: 'fragmented',
      epoch: '1',
      sequence: 1,
      status: 'accepted',
      envelope: edit,
    }
    const before = performance.now()
    user.receive([message])
    const elapsed = performance.now() - before
    assert.equal(restores, 1)
    assert.equal(applies, pending + 1)
    assert.equal(
      user.text(),
      history.expected.slice(0, offset) +
        'T'.repeat(pending) +
        'R' +
        history.expected.slice(offset),
    )
    assert.equal(user.state().pending.length, pending)
    assert.equal(user.state().hostSequence, 1)
    if (sample >= 0) values.push(elapsed)
  }
  return summarize(values)
}
function profile(history, offset) {
  const engine = restore(history.saved)
  const user = new Participant({ actor: 'local', document: 'fragmented', epoch: '1', engine })
  for (let i = 0; i < 100; i++) user.local({ offset: offset + i, deleteCount: 0, text: 'T' })
  const remote = new Participant({
    actor: 'remote',
    document: 'fragmented',
    epoch: '1',
    engine: restore(history.saved),
  })
  const edit = remote.local({ offset, deleteCount: 0, text: 'R' })
  const costs = {},
    stack = []
  for (const name of [
    'author',
    'apply',
    'restore',
    'run',
    'ancestor',
    'first',
    'last',
    'successor',
    'comparePosition',
    'integrate',
    'retainPayloads',
  ]) {
    const method = engine[name]
    if (typeof method !== 'function') continue
    costs[name] = { calls: 0, inclusiveMs: 0, selfMs: 0 }
    engine[name] = function (...args) {
      const frame = { start: performance.now(), children: 0 }
      stack.push(frame)
      try {
        return method.apply(this, args)
      } finally {
        const elapsed = performance.now() - frame.start
        stack.pop()
        const cost = costs[name]
        cost.calls++
        cost.inclusiveMs += elapsed
        cost.selfMs += elapsed - frame.children
        if (stack.length) stack.at(-1).children += elapsed
      }
    }
  }
  user.receive([
    { document: 'fragmented', epoch: '1', sequence: 1, status: 'accepted', envelope: edit },
  ])
  return costs
}
const workloads = []
for (const kind of ['scattered', 'deep-tail']) {
  const history = build(kind)
  const offset =
    kind === 'deep-tail' ? history.expected.length : Math.floor(history.expected.length / 2)
  const probe = restore(history.saved)
  let runLookups = 0
  const runMethod = probe.run.bind(probe)
  probe.run = (id) => {
    runLookups++
    return runMethod(id)
  }
  const probeIds = new CharIdAllocator('probe')
  const probeEdit = probe.author(
    { offset, deleteCount: 0, text: 'P' },
    {
      document: 'fragmented',
      epoch: '1',
      id: { actor: 'probe', seq: 1 },
      lamport: 1,
      deps: [],
      allocate: (left, count) => probeIds.generateAfter(left, count),
    },
  )
  probe.apply(probeEdit)
  const result = {
    kind,
    metadata: history.metadata,
    offset,
    runLookupsForOneAuthorApply: runLookups,
    typing: typing(history, offset),
    profile100Pending: profile(history, offset),
    reconciliation: [],
  }
  for (const pending of [1, 10, 100])
    result.reconciliation.push({ pending, ...reconcile(history, offset, pending) })
  workloads.push(result)
  console.error(JSON.stringify({ phase: 'measured', kind, ...result }))
}
console.log(
  JSON.stringify(
    {
      label: process.argv[2] ?? 'experiment, shared machine',
      environment: {
        node: process.version,
        v8: process.versions.v8,
        cpu: os.cpus()[0].model,
        platform: os.platform(),
        release: os.release(),
      },
      method:
        '100,000 lines / 8.1M initial UTF-16 units; 50,000 interleaved single-character inserts in batches of five concurrent authors, then 30,000 (29,999 for deep-tail) exact-ID tombstones. 31 independent restore-based samples after five warmups; 100 author/apply typing edits per sample. Timers include author/apply/allocation and observation counters, exclude history setup, pending authoring, text materialization, validation, consumers and rendering. Reconcile verifies one by-reference restore and pending+1 applies. No retries/skips.',
      workloads,
    },
    null,
    2,
  ),
)
