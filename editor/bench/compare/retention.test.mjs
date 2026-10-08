import { test } from 'node:test'
import assert from 'node:assert/strict'
import { verifyDisposedRetention } from './retention.mjs'

const baseline = () => [
  {
    worker: 1,
    documentCount: 1,
    snapshotCount: 4,
    treeCount: 20,
    markdownDocumentEntries: 0,
    markdownDocumentCount: 0,
    injectedMarkdownDocumentCount: 0,
    documents: [
      {
        runtimeSessionId: 'a',
        snapshots: [{ snapshotVersion: 1, sourceUnits: 10, treeCount: 20 }],
      },
    ],
    source: { documentCount: 1, readCount: 4, pinCount: 0, sourceUnits: 40 },
    shared: { wasmMemory: { bytes: 100 } },
  },
]
const multiple = () => [{ ...baseline()[0], documentCount: 3 }]

test('disposal requires baseline snapshots, trees, source resources and document identities', () => {
  const before = baseline()
  const after = baseline()
  after[0].shared.wasmMemory.bytes *= 2
  verifyDisposedRetention(before, multiple(), after)
  for (const field of [
    'snapshotCount',
    'treeCount',
    'markdownDocumentEntries',
    'markdownDocumentCount',
    'injectedMarkdownDocumentCount',
  ]) {
    const leaked = baseline()
    leaked[0][field]++
    assert.throws(() => verifyDisposedRetention(before, multiple(), leaked), /retention/)
  }
  for (const field of ['documentCount', 'readCount', 'pinCount', 'sourceUnits']) {
    const leaked = baseline()
    leaked[0].source[field]++
    assert.throws(() => verifyDisposedRetention(before, multiple(), leaked), /retention/)
  }
  const changed = baseline()
  changed[0].documents[0].runtimeSessionId = 'other'
  assert.throws(() => verifyDisposedRetention(before, multiple(), changed), /retention/)
  const changedSnapshot = baseline()
  changedSnapshot[0].documents[0].snapshots[0].sourceUnits++
  assert.throws(() => verifyDisposedRetention(before, multiple(), changedSnapshot), /retention/)
})
