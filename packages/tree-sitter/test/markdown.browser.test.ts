import { afterEach, beforeEach, expect, it } from 'vitest'
import { Kind } from 'tree-sitter-md'
import { applyBatchToPieceTable, createPieceTableSnapshot } from '@singapore-editor/core/document'
import { TREE_SITTER_LANGUAGE_CONTRIBUTIONS } from '../../tree-sitter-languages/src/index'
import { TreeSitterWorkerClient, resolveTreeSitterLanguageContribution } from '../src'
import { createTreeSitterEditPayload } from '../src/session'
import type { TreeSitterParseResult } from '../src/treeSitter/types'

let client: TreeSitterWorkerClient
beforeEach(async () => {
  client = new TreeSitterWorkerClient()
  const descriptors = await Promise.all(
    TREE_SITTER_LANGUAGE_CONTRIBUTIONS.map(resolveTreeSitterLanguageContribution),
  )
  await client.registerLanguages(descriptors)
  await client.warmLanguages(descriptors.filter((descriptor) => descriptor.id === 'markdown'))
})
afterEach(async () => {
  await client.dispose()
})
const identity = {
  documentId: 'records.md',
  runtimeSessionId: 'markdown-records',
  languageId: 'markdown',
}

function spans(result: TreeSitterParseResult | undefined, kind: number) {
  const records = result?.records?.data ?? []
  const spans: number[][] = []
  for (let index = 0; index < records.length; index += 4) {
    if (records[index + 2] === kind) spans.push([records[index]!, records[index + 1]!])
  }
  return spans
}

it('resolves tables, multiline spans, and EOF definitions beyond 300 paragraphs', async () => {
  const tail =
    '| a | b |\n| - | - |\n| **cell** | [label][ref] |\n\n> **across\n> lines**\n\n[ref]: /destination\n'
  const text =
    Array.from({ length: 310 }, (_, index) => `Paragraph ${index} **bold**`).join('\n\n') +
    '\n\n' +
    tail
  const snapshot = createPieceTableSnapshot(text)
  await client.parse({ ...identity, snapshotVersion: 1, snapshot, resultMode: 'parseOnly' })
  const from = text.indexOf('| a |')
  const result = await client.queryRange({
    ...identity,
    snapshotVersion: 1,
    includeHighlights: true,
    range: { startIndex: from, endIndex: text.length },
  })
  expect(result?.records?.languageId).toBe('markdown')
  expect(spans(result, Kind.Strong)).toContainEqual([
    text.indexOf('**cell**'),
    text.indexOf('**cell**') + 8,
  ])
  expect(spans(result, Kind.Strong)).toContainEqual([
    text.indexOf('**across'),
    text.indexOf('lines**') + 7,
  ])
  expect(spans(result, Kind.Link)).toContainEqual([
    text.indexOf('[label]'),
    text.indexOf('[label]') + 12,
  ])
  expect(result?.statistics?.layers).toBe(0)
})

it('edits and undoes EOF definitions and moving fences with all outputs matching a fresh document', async () => {
  let text = '[label][ref]\n\n```javascript\nconst value = 1\n```\n\n[ref]: /url\n'
  let snapshot = createPieceTableSnapshot(text)
  await client.parse({ ...identity, snapshotVersion: 1, snapshot })
  const operations = [
    { from: text.lastIndexOf('[ref]:'), to: text.length, text: '' },
    { from: text.lastIndexOf('[ref]:'), to: text.lastIndexOf('[ref]:'), text: '[ref]: /url\n' },
    { from: 0, to: 0, text: '🪐\n\n' },
    { from: 0, to: 4, text: '' },
  ]
  for (const [index, edit] of operations.entries()) {
    const next = applyBatchToPieceTable(snapshot, [edit])
    const payload = createTreeSitterEditPayload({
      ...identity,
      previousSnapshotVersion: index + 1,
      snapshotVersion: index + 2,
      previousSnapshot: snapshot,
      nextSnapshot: next,
      edits: [edit],
    })!
    const actual = await client.edit(payload)
    const fresh = await client.parse({
      ...identity,
      runtimeSessionId: `fresh-${index}`,
      snapshotVersion: index + 2,
      snapshot: next,
    })
    expect(actual?.records).toEqual(fresh?.records)
    expect(actual?.captures).toEqual(fresh?.captures)
    expect(actual?.folds).toEqual(fresh?.folds)
    expect(actual?.injections).toEqual(fresh?.injections)
    expect(spans(actual, Kind.Link).length).toBe(index === 0 ? 0 : 1)
    client.disposeDocument(`fresh-${index}`)
    snapshot = next
    text = text.slice(0, edit.from) + edit.text + text.slice(edit.to)
  }
  const stale = await client.queryRange({
    ...identity,
    snapshotVersion: 1,
    includeHighlights: true,
    range: { startIndex: 0, endIndex: 10 },
  })
  expect(stale).toBeUndefined()
  const staleParse = await client.parse({
    ...identity,
    snapshotVersion: 1,
    snapshot: createPieceTableSnapshot('**stale**'),
  })
  expect(staleParse).toBeUndefined()
  const current = await client.queryRange({
    ...identity,
    snapshotVersion: 5,
    includeHighlights: true,
    range: { startIndex: 0, endIndex: text.length },
  })
  expect(spans(current, Kind.Link)).toHaveLength(1)
})

it('bounds a giant paragraph result to visible constructs and keeps link text companions', async () => {
  const text = '[**target**](/url) ' + 'plain **strong** and `code` '.repeat(40_000)
  const snapshot = createPieceTableSnapshot(text)
  await client.parse({ ...identity, snapshotVersion: 1, snapshot, resultMode: 'parseOnly' })
  const result = await client.queryRange({
    ...identity,
    snapshotVersion: 1,
    includeHighlights: true,
    range: { startIndex: 0, endIndex: 100 },
  })
  expect(result?.records?.data.length).toBeLessThan(100)
  expect(result?.captures.length).toBeLessThan(100)
  expect(spans(result, Kind.LinkText)).toContainEqual([1, 11])
})

it('keeps a sibling document intact after disposal and initialization repeats', async () => {
  const snapshot = createPieceTableSnapshot('**sibling**')
  const sibling = { ...identity, runtimeSessionId: 'sibling' }
  await client.parse({ ...identity, snapshotVersion: 1, snapshot })
  const before = await client.parse({ ...sibling, snapshotVersion: 1, snapshot })
  client.disposeDocument(identity.runtimeSessionId)
  await client.awaitRuntimeSessionIdle(identity.runtimeSessionId)
  const after = await client.queryRange({
    ...sibling,
    snapshotVersion: 1,
    includeHighlights: true,
    range: { startIndex: 0, endIndex: snapshot.length },
  })
  expect(after?.records).toEqual(before?.records)
})
