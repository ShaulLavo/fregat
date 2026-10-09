import { afterEach, beforeEach, expect, it } from 'vitest'
import { resolveTreeSitterLanguageContribution } from '../src'
import { TREE_SITTER_LANGUAGE_CONTRIBUTIONS } from '../../tree-sitter-languages/src/catalog.generated'
import { TreeSitterWorkerClient } from '../src/treeSitter/workerClient'
import {
  disposeTreeTransportDocuments,
  editTreeDocument,
  parseTreeDocument,
  prepareTreeEdit,
} from './factories/transport'

let client: TreeSitterWorkerClient
beforeEach(async () => {
  client = new TreeSitterWorkerClient()
  const descriptors = await Promise.all(
    ['typescript', 'javascript', 'html', 'markdown', 'mdx', 'json'].map((id) =>
      resolveTreeSitterLanguageContribution(
        TREE_SITTER_LANGUAGE_CONTRIBUTIONS.find((entry) => entry.id === id)!,
      ),
    ),
  )
  await client.registerLanguages(descriptors)
})
afterEach(async () => {
  disposeTreeTransportDocuments()
  await client.dispose()
})

const document = {
  documentId: 'review.ts',
  runtimeSessionId: 'merge-review',
  languageId: 'typescript',
}

it('does no merge-query work until asked, reuses the query, and follows incremental edits', async () => {
  const text = 'interface Palette { amber: string; violet: number; }'
  await parseTreeDocument(client, {
    ...document,
    snapshotVersion: 1,
    text,
    includeHighlights: false,
    resultMode: 'parseOnly',
  })
  const before = await client.inspectRetention()
  expect(
    before!.shared.runtimes.find((runtime) => runtime.languageId === 'typescript')!
      .mergeUnitQueryCount,
  ).toBe(0)
  const startIndex = text.indexOf('amber')
  const range = { startIndex, endIndex: startIndex + 5 }
  const first = await client.mergeUnit({ ...document, snapshotVersion: 1, range })
  expect(first).toMatchObject({
    status: 'ok',
    unit: {
      source: 'syntax',
      type: 'property_signature',
      signature: 'amber',
      parent: { type: 'interface_body', commutative: true },
    },
  })
  expect(await client.mergeUnit({ ...document, snapshotVersion: 1, range })).toEqual(first)
  const after = await client.inspectRetention()
  expect(
    after!.shared.runtimes.find((runtime) => runtime.languageId === 'typescript')!
      .mergeUnitQueryCount,
  ).toBe(1)
  const edit = await prepareTreeEdit(client, {
    ...document,
    previousSnapshotVersion: 1,
    snapshotVersion: 2,
    edits: [{ from: startIndex, to: startIndex + 5, text: 'indigo' }],
    resultMode: 'parseOnly',
  })
  expect(edit).not.toBeNull()
  await editTreeDocument(client, edit!)
  expect(await client.mergeUnit({ ...document, snapshotVersion: 2, range })).toMatchObject({
    status: 'ok',
    unit: { signature: 'indigo' },
  })
  expect(await client.mergeUnit({ ...document, snapshotVersion: 99, range })).toMatchObject({
    status: 'stale',
    unit: null,
  })
  client.disposeDocument(document.runtimeSessionId)
  await client.awaitRuntimeSessionIdle(document.runtimeSessionId)
  expect(await client.mergeUnit({ ...document, snapshotVersion: 2, range })).toMatchObject({
    status: 'stale',
    unit: null,
  })
})

it('falls back to complete lines for languages without a query', async () => {
  const identity = { ...document, languageId: 'html', snapshotVersion: 1 }
  const text = '<p>Amber</p>\n<p>Violet</p>\n'
  await parseTreeDocument(client, { ...identity, text, resultMode: 'parseOnly' })
  const startIndex = text.indexOf('Violet')
  expect(
    await client.mergeUnit({ ...identity, range: { startIndex, endIndex: startIndex + 6 } }),
  ).toMatchObject({
    status: 'ok',
    unit: {
      source: 'line',
      type: 'line',
      startIndex: 13,
      endIndex: 26,
      parent: null,
      signature: null,
    },
  })
  expect(
    await client.mergeUnit({ ...identity, range: { startIndex: 4, endIndex: 20 } }),
  ).toMatchObject({ unit: { source: 'line', startIndex: 0, endIndex: 26 } })
})

it('uses lines where the syntax unit has a parse error', async () => {
  await parseTreeDocument(client, {
    ...document,
    snapshotVersion: 1,
    text: 'const amber = ;\n',
    resultMode: 'parseOnly',
  })
  expect(
    await client.mergeUnit({
      ...document,
      snapshotVersion: 1,
      range: { startIndex: 6, endIndex: 11 },
    }),
  ).toMatchObject({ status: 'ok', unit: { source: 'line', startIndex: 0, endIndex: 15 } })
})

it('finds Markdown units lazily and chooses a fenced language where its grammar is registered', async () => {
  const identity = { ...document, languageId: 'markdown', snapshotVersion: 1 }
  const text = '# Paint\n\nAmber is warm.\n\n```typescript\nconst shade = 1;\n```\n'
  await parseTreeDocument(client, { ...identity, text, resultMode: 'parseOnly' })
  const before = await client.inspectRetention()
  const startIndex = text.indexOf('warm')
  expect(
    await client.mergeUnit({ ...identity, range: { startIndex, endIndex: startIndex + 4 } }),
  ).toMatchObject({ status: 'ok', unit: { source: 'syntax', type: 'paragraph', signature: null } })
  const after = await client.inspectRetention()
  expect(after!.treeCount).toBe(before!.treeCount + 1)
  const shade = text.indexOf('shade')
  expect(
    await client.mergeUnit({ ...identity, range: { startIndex: shade, endIndex: shade + 5 } }),
  ).toMatchObject({
    status: 'ok',
    languageId: 'typescript',
    unit: { source: 'syntax', type: 'lexical_declaration' },
  })
  client.disposeDocument(identity.runtimeSessionId)
  await client.awaitRuntimeSessionIdle(identity.runtimeSessionId)
  expect((await client.inspectRetention())!.treeCount).toBe(0)
})

it('keeps UTF-16 ranges and duplicate signatures distinct from unit identity', async () => {
  const identity = { ...document, languageId: 'json', snapshotVersion: 1 }
  const text = '{"😀": 1, "😀": 2}'
  await parseTreeDocument(client, { ...identity, text, resultMode: 'parseOnly' })
  const units = await Promise.all(
    [text.indexOf('1'), text.indexOf('2')].map((startIndex) =>
      client.mergeUnit({ ...identity, range: { startIndex, endIndex: startIndex + 1 } }),
    ),
  )
  expect(units[0]).toMatchObject({
    unit: { signature: '"😀"', startIndex: 1, endIndex: 8, parent: { commutative: true } },
  })
  expect(units[1]).toMatchObject({
    unit: { signature: '"😀"', startIndex: 10, endIndex: 17, parent: { commutative: true } },
  })
})

it('chooses the deepest language inside a Markdown fence', async () => {
  const identity = { ...document, languageId: 'markdown', snapshotVersion: 1 }
  const text = '```javascript\nconst palette = json`{"amber": 1, "violet": 2}`;\n```\n'
  const parsed = await parseTreeDocument(client, { ...identity, text })
  expect(parsed?.injections?.map((layer) => layer.languageId)).toEqual(['javascript', 'json'])
  const startIndex = text.indexOf('1')
  expect(
    await client.mergeUnit({ ...identity, range: { startIndex, endIndex: startIndex + 1 } }),
  ).toMatchObject({
    status: 'ok',
    languageId: 'json',
    unit: { source: 'syntax', type: 'pair', signature: '"amber"', parent: { commutative: true } },
  })
})

it('selects the TypeScript fence over the MDX root', async () => {
  const identity = { ...document, languageId: 'mdx', snapshotVersion: 1 }
  const text = '# Paint\n\n```typescript\nconst amber = 1;\n```\n'
  await parseTreeDocument(client, { ...identity, text })
  const startIndex = text.indexOf('amber')
  expect(
    await client.mergeUnit({ ...identity, range: { startIndex, endIndex: startIndex + 5 } }),
  ).toMatchObject({
    status: 'ok',
    languageId: 'typescript',
    unit: { source: 'syntax', type: 'lexical_declaration' },
  })
})

it('preserves the injected language when its query falls back to lines', async () => {
  const identity = { ...document, languageId: 'markdown', snapshotVersion: 1 }
  const text = '```html\n<p>Amber</p>\n```\n'
  await parseTreeDocument(client, { ...identity, text })
  const startIndex = text.indexOf('Amber')
  expect(
    await client.mergeUnit({ ...identity, range: { startIndex, endIndex: startIndex + 5 } }),
  ).toMatchObject({ status: 'ok', languageId: 'html', unit: { source: 'line' } })
})

it('reports missing syntax and token spelling on demand for review projections', async () => {
  const text = 'const answer = "alpha""beta";'
  await parseTreeDocument(client, {
    ...document,
    snapshotVersion: 1,
    text,
    includeHighlights: false,
    resultMode: 'parseOnly',
  })
  const result = await client.mergeUnit({
    ...document,
    snapshotVersion: 1,
    range: { startIndex: 15, endIndex: 22 },
    analysis: true,
    contentKey: true,
  })
  expect(result).toMatchObject({
    status: 'ok',
    unit: { type: 'lexical_declaration', hasErrors: true },
  })
  if (result?.status === 'ok') expect(result.unit.contentKey).toContain('alpha')
})

it('releases cancelled lazy Markdown structural work', async () => {
  const identity = {
    ...document,
    documentId: 'review.md',
    runtimeSessionId: 'cancel-merge-markdown',
    languageId: 'markdown',
  }
  const text = '# Title\n\nA paragraph for review.\n\n'.repeat(100_000)
  await parseTreeDocument(client, {
    ...identity,
    snapshotVersion: 1,
    text,
    includeHighlights: false,
    resultMode: 'parseOnly',
  })
  const pending = client.mergeUnit({
    ...identity,
    snapshotVersion: 1,
    range: { startIndex: 12, endIndex: 20 },
    analysis: true,
  })
  client.disposeDocument(identity.runtimeSessionId)
  await pending.catch(() => undefined)
  await client.awaitRuntimeSessionIdle(identity.runtimeSessionId)
  const retention = await client.inspectRetention()
  expect(
    retention!.documents.some((entry) => entry.runtimeSessionId === identity.runtimeSessionId),
  ).toBe(false)
  expect(
    await client.mergeUnit({
      ...identity,
      snapshotVersion: 1,
      range: { startIndex: 12, endIndex: 20 },
    }),
  ).toMatchObject({ status: 'stale', unit: null })
}, 120_000)

it('analyzes damaged HTML line fallbacks and preserves ordinary responses', async () => {
  const identity = { ...document, languageId: 'html', snapshotVersion: 1 }
  await parseTreeDocument(client, { ...identity, text: '<div><', resultMode: 'parseOnly' })
  const request = { ...identity, range: { startIndex: 5, endIndex: 6 } }
  const ordinary = await client.mergeUnit(request)
  expect(ordinary).toMatchObject({ status: 'ok', unit: { source: 'line' } })
  if (ordinary?.status === 'ok') {
    expect(ordinary.unit.hasErrors).toBeUndefined()
    expect(ordinary.unit.contentKey).toBeUndefined()
  }
  const result = await client.mergeUnit({ ...request, analysis: true, contentKey: true })
  expect(result).toMatchObject({ status: 'ok', unit: { source: 'line', hasErrors: true } })
  if (result?.status === 'ok') expect(result.unit.contentKey).toBeTypeOf('string')
})

it.each(['html', 'typescript'])('cancels pre-cancelled %s merge queries', async (languageId) => {
  const identity = { ...document, languageId, snapshotVersion: 1 }
  const text = languageId === 'html' ? '<div><' : 'const value = 1;'
  await parseTreeDocument(client, { ...identity, text, resultMode: 'parseOnly' })
  const cancellationBuffer = new SharedArrayBuffer(4)
  Atomics.store(new Int32Array(cancellationBuffer), 0, 1)
  expect(
    await client.mergeUnit({
      ...identity,
      range: { startIndex: 0, endIndex: 1 },
      cancellationBuffer,
      analysis: true,
    }),
  ).toMatchObject({ status: 'cancelled', unit: null })
})

it('fingerprints an unmatched TypeScript line fallback', async () => {
  await parseTreeDocument(client, {
    ...document,
    snapshotVersion: 1,
    text: '// comment\n',
    resultMode: 'parseOnly',
  })
  const result = await client.mergeUnit({
    ...document,
    snapshotVersion: 1,
    range: { startIndex: 3, endIndex: 5 },
    analysis: true,
    contentKey: true,
  })
  expect(result).toMatchObject({ status: 'ok', unit: { source: 'line', hasErrors: false } })
  if (result?.status === 'ok') expect(result.unit.contentKey).toContain('comment')
})
