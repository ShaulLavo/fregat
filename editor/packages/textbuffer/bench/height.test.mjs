import assert from 'node:assert/strict'
import { test } from 'vitest'
import { loadAdapter } from './adapters.mjs'
import { applyOracle, safeBoundary } from './fixtures.mjs'
import { fixtureHash, makeHeightFixtures, samplePoints } from './height-fixtures.mjs'
import { runHeightTrace, unsignedList } from './height.mjs'
import { measureBuffer, measureTree } from './tree-shape.mjs'
import { createPieceTableSnapshot } from '@singapore-editor/textbuffer'

function node(left = null, right = null, length = 1, visible = true) {
  return { left, right, piece: { length, visible } }
}

test('empty, singleton, and full three-level trees use consistent depth units', () => {
  const empty = measureTree(null)
  assert.equal(empty.height, 0)
  assert.equal(empty.heightOverLog2, null)
  assert.equal(empty.meanDepth, null)
  assert.equal(measureTree(node()).height, 1)
  const full = measureTree(node(node(node(), node()), node(node(), node())))
  assert.equal(full.height, 3)
  assert.equal(full.minimumHeight, 3)
  assert.equal(full.heightOverLog2, 1)
  assert.deepEqual(full.depthCounts, [1, 2, 4])
  assert.equal(full.meanDepth, 10 / 7)
  assert.equal(full.p95Depth, 2)
})

test('tombstones remain in height and piece counts; visible weights exclude them', () => {
  const shape = measureTree(node(node(null, null, 4, false), node(null, null, 8), 2))
  assert.equal(shape.height, 2)
  assert.equal(shape.pieces, 3)
  assert.equal(shape.tombstones, 1)
  assert.equal(shape.storedLength, 14)
  assert.equal(shape.visibleLength, 10)
  assert.equal(shape.meanDepth, 2 / 3)
  assert.equal(shape.meanVisibleDepth, 0.5)
  assert.equal(shape.meanTextDepth, 0.8)
})

test('cyclic VS Code NIL sentinel is excluded from height', () => {
  const nil = { piece: null }
  nil.left = nil
  nil.right = nil
  assert.equal(measureTree(nil).height, 0)
  assert.equal(measureTree(node(nil, nil)).height, 1)
})

test('an actual tree cycle or repeated child fails', () => {
  const cyclic = node()
  cyclic.left = cyclic
  assert.throws(() => measureTree(cyclic), /Cycle or repeated/)
  const shared = node()
  assert.throws(() => measureTree(node(shared, shared)), /Cycle or repeated/)
})

test('measurement itself handles a 100,000-level chain iteratively', () => {
  let root = null
  for (let index = 0; index < 100000; index += 1) root = node(root)
  const shape = measureTree(root)
  assert.equal(shape.height, 100000)
  assert.equal(shape.pieces, 100000)
  assert.equal(shape.meanDepth, 49999.5)
})

test('checkpoints include start, finish, powers of two, and fixed intervals', () => {
  assert.deepEqual(
    Array.from(samplePoints(10, 3)).sort((a, b) => a - b),
    [0, 1, 2, 3, 4, 6, 8, 9, 10],
  )
  assert.throws(() => samplePoints(10, 0))
})

test('seeds reject negatives, overflow, duplicates, blanks, and nonintegers', () => {
  assert.deepEqual(unsignedList('0,7,4294967295'), [0, 7, 4294967295])
  for (const value of ['-1', '4294967296', '1,1', '', '1,', '1.5']) {
    assert.throws(() => unsignedList(value))
  }
})

test('fixtures are repeatable and all edit boundaries respect UTF-16 pairs', () => {
  const first = makeHeightFixtures('smoke', 7, 64)
  const second = makeHeightFixtures('smoke', 7, 64)
  assert.deepEqual(first.map(fixtureHash), second.map(fixtureHash))
  assert.notDeepEqual(first.map(fixtureHash), makeHeightFixtures('smoke', 42, 64).map(fixtureHash))
  for (const fixture of first) {
    let text = fixture.initial
    for (const operation of fixture.operations) {
      for (const edit of operation.kind === 'batch' ? operation.edits : [operation]) {
        assert.equal(safeBoundary(text, edit.from), edit.from)
        assert.equal(safeBoundary(text, edit.to), edit.to)
        assert(edit.to >= edit.from && edit.to <= text.length)
      }
      text = applyOracle(text, operation)
    }
    assert.equal(text, fixture.expected)
  }
})

test('all smoke traces leave retained snapshots intact', async () => {
  const adapter = await loadAdapter('singapore')
  for (const fixture of makeHeightFixtures('smoke', 7, 64)) {
    {
      const original = createPieceTableSnapshot(fixture.initial)
      const buffer = adapter.restore(original)
      const samples = []
      runHeightTrace(buffer, fixture, 16, (sample) => samples.push(sample))
      assert.equal(samples.at(-1).operation, fixture.operations.length)
      assert.equal(adapter.retainedText(original), fixture.initial)
      assert.deepEqual(buffer.issues(), [])
    }
  }
})

test('measurement preserves tree identities and contents', async () => {
  const adapter = await loadAdapter('singapore')
  const buffer = adapter.create('abcdef')
  buffer.edit({ from: 1, to: 4, text: 'x' })
  const before = JSON.stringify(buffer.snapshot)
  const root = buffer.snapshot.root
  const reverse = buffer.snapshot.reverseIndex
  measureBuffer(buffer)
  assert.equal(buffer.snapshot.root, root)
  assert.equal(buffer.snapshot.reverseIndex, reverse)
  assert.equal(JSON.stringify(buffer.snapshot), before)
})
