import { afterEach, beforeEach, expect, it } from 'vitest'
import { Kind } from 'tree-sitter-md'
import { createEditorTextBuffer, createEditorBufferSession } from '../../editor/src/documentSession'
import { TREE_SITTER_LANGUAGE_CONTRIBUTIONS } from '../../tree-sitter-languages/src/index'
import { resolveTreeSitterLanguageContribution } from '../src'
import { TreeSitterWorkerClient } from '../src/treeSitter/workerClient'
import { DocumentDelivery, type DocumentRead } from '../../editor/src/editor/documentDelivery'
import type { DocumentWorkerReadReference } from '@singapore-editor/core/internal/document-worker'
import { createTreeSitterEditPayload } from '../src/session'
import type { TreeSitterParseResult } from '../src/treeSitter/types'

const disposers: Array<() => void> = []
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
  for (const dispose of disposers.splice(0)) dispose()
  await client.dispose()
})
const identity = {
  documentId: 'records.md',
  runtimeSessionId: 'markdown-records',
  languageId: 'markdown',
}

function sourceDocument(text: string) {
  const buffer = createEditorTextBuffer(text)
  const view = createEditorBufferSession(buffer)
  const delivery = new DocumentDelivery(buffer, 'markdown-fixture')
  const unsubscribe = buffer.subscribe((event) => delivery.accept(event))
  const scope = delivery.createScope()
  const dispose = () => {
    scope.dispose()
    unsubscribe()
    delivery.dispose()
  }
  disposers.push(dispose)
  const withRead = async <T>(
    run: (source: DocumentWorkerReadReference) => Promise<T>,
    read: DocumentRead = delivery.current()!,
  ): Promise<T> => {
    const loan = await scope.source.prepareReader(client.sourceEndpoint, read)
    if (!loan) throw new TypeError('The actual Markdown worker must admit its source')
    try {
      return await run(loan.reference)
    } finally {
      await loan.dispose()
    }
  }
  return { buffer, view, delivery, withRead, dispose }
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
  const document = sourceDocument(text)
  await document.withRead((source) =>
    client.parse({ ...identity, snapshotVersion: 1, source, resultMode: 'parseOnly' }),
  )
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

it('carries EOF reference definitions with visible link records', async () => {
  const text = '[label][ref]\n\n' + 'Paragraph\n\n'.repeat(310) + '[ref]: /destination\n'
  const document = sourceDocument(text)
  await document.withRead((source) =>
    client.parse({ ...identity, snapshotVersion: 1, source, resultMode: 'parseOnly' }),
  )
  const result = await client.queryRange({
    ...identity,
    snapshotVersion: 1,
    includeHighlights: true,
    range: { startIndex: 0, endIndex: 20 },
  })
  expect(spans(result, Kind.Link)).toEqual([[0, 12]])
  expect(spans(result, Kind.Definition)).toContainEqual([text.indexOf('[ref]:'), text.length - 1])
})

it('edits and undoes EOF definitions and moving fences with all outputs matching a fresh document', async () => {
  let text = '[label][ref]\n\n```javascript\nconst value = 1\n```\n\n[ref]: /url\n'
  const document = sourceDocument(text)
  const oldRead = document.delivery.current()!
  await document.withRead((source) => client.parse({ ...identity, snapshotVersion: 1, source }))
  const operations = [
    { from: text.lastIndexOf('[ref]:'), to: text.length, text: '' },
    { from: text.lastIndexOf('[ref]:'), to: text.lastIndexOf('[ref]:'), text: '[ref]: /url\n' },
    { from: 0, to: 0, text: '🪐\n\n' },
    { from: 0, to: 4, text: '' },
  ]
  for (const [index, edit] of operations.entries()) {
    const previous = document.delivery.current()!
    document.view.applyEdits([edit])
    const actual = await document.withRead(async (source) => {
      const payload = createTreeSitterEditPayload({
        ...identity,
        previousSnapshotVersion: index + 1,
        snapshotVersion: index + 2,
        previousRead: previous.text,
        source,
        edits: [edit],
      })
      if (!payload) throw new TypeError('The canonical Markdown edit must have a bounded payload')
      return client.edit(payload)
    })
    const freshDocument = sourceDocument(document.buffer.materializeFullText())
    const fresh = await freshDocument.withRead((source) =>
      client.parse({
        ...identity,
        runtimeSessionId: `fresh-${index}`,
        snapshotVersion: index + 2,
        source,
      }),
    )
    expect(actual?.records).toEqual(fresh?.records)
    expect(actual?.captures).toEqual(fresh?.captures)
    expect(actual?.folds).toEqual(fresh?.folds)
    expect(actual?.injections).toEqual(fresh?.injections)
    expect(spans(actual, Kind.Link).length).toBe(index === 0 ? 0 : 1)
    client.disposeDocument(`fresh-${index}`)
    freshDocument.dispose()
    text = text.slice(0, edit.from) + edit.text + text.slice(edit.to)
  }
  const stale = await client.queryRange({
    ...identity,
    snapshotVersion: 1,
    includeHighlights: true,
    range: { startIndex: 0, endIndex: 10 },
  })
  expect(stale).toBeUndefined()
  const staleParse = await document.withRead(
    (source) => client.parse({ ...identity, snapshotVersion: 1, source }),
    oldRead,
  )
  expect(staleParse).toMatchObject({
    status: 'cancelled',
    analysis: { kind: 'cancelled', reason: 'superseded' },
  })
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
  const document = sourceDocument(text)
  await document.withRead((source) =>
    client.parse({ ...identity, snapshotVersion: 1, source, resultMode: 'parseOnly' }),
  )
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
  const document = sourceDocument('**sibling**')
  const siblingDocument = sourceDocument('**sibling**')
  const sibling = { ...identity, runtimeSessionId: 'sibling' }
  await document.withRead((source) => client.parse({ ...identity, snapshotVersion: 1, source }))
  const before = await siblingDocument.withRead((source) =>
    client.parse({ ...sibling, snapshotVersion: 1, source }),
  )
  client.disposeDocument(identity.runtimeSessionId)
  await client.awaitRuntimeSessionIdle(identity.runtimeSessionId)
  document.dispose()
  const after = await client.queryRange({
    ...sibling,
    snapshotVersion: 1,
    includeHighlights: true,
    range: { startIndex: 0, endIndex: siblingDocument.buffer.getTextSnapshot().length },
  })
  expect(after?.records).toEqual(before?.records)
})
