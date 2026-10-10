import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { resolveTreeSitterLanguageContribution } from '../src'
import { TREE_SITTER_LANGUAGE_CONTRIBUTIONS } from '../../tree-sitter-languages/src/catalog.generated'
import { TreeSitterWorkerClient } from '../src/treeSitter/workerClient'
import type { TreeSitterReviewRead } from '../src/mergeReview'
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
  vi.restoreAllMocks()
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

it('touching selection returns every intersected unit', async () => {
  const text = 'interface Palette { amber: string; violet: number; }'
  await parseTreeDocument(client, {
    ...document,
    snapshotVersion: 1,
    text,
    resultMode: 'parseOnly',
  })
  const result = await client.mergeUnit({
    ...document,
    snapshotVersion: 1,
    range: { startIndex: text.indexOf('amber'), endIndex: text.indexOf('number') + 6 },
    selection: 'touching',
    analysis: true,
  })
  expect(result?.status).toBe('ok')
  if (result?.status !== 'ok') return
  expect(result.units?.map((unit) => unit.signature)).toEqual(['amber', 'Palette', 'violet'])
})

it('the live review reader admits snapshots and retires worker sources', async () => {
  const { createTreeSitterReviewSyntax } = await import('../src/mergeReview')
  const { createPieceTableSnapshot, applyBatchToPieceTable } =
    await import('@singapore-editor/core/document')
  const descriptor = await resolveTreeSitterLanguageContribution(
    TREE_SITTER_LANGUAGE_CONTRIBUTIONS.find((language) => language.id === 'typescript')!,
  )
  const syntax = createTreeSitterReviewSyntax({
    languageId: 'typescript',
    languages: [descriptor],
    backend: client,
  })
  const parse = vi.spyOn(client, 'parse')
  const project = vi.spyOn(client, 'reviewBatch')
  const base = createPieceTableSnapshot('const value = 0;\n')
  const projected = applyBatchToPieceTable(base, [{ from: 14, to: 15, text: '1' }])
  const ranges = [{ startIndex: 14, endIndex: 15 }]
  expect((await syntax(base, ranges))?.[0]?.[0]?.type).toBe('lexical_declaration')
  expect((await syntax(projected, ranges, false, 'enclosing', base))?.[0]?.[0]?.type).toBe(
    'lexical_declaration',
  )
  expect(parse).toHaveBeenCalledTimes(1)
  expect(project).toHaveBeenCalledTimes(2)
  expect(project.mock.calls[1]![0].queries[0]).toMatchObject({
    baseSnapshotVersion: parse.mock.calls[0]![0].snapshotVersion,
    inputEdits: [
      {
        startIndex: 14,
        oldEndIndex: 15,
        newEndIndex: 15,
        startPosition: { row: 0, column: 14 },
        oldEndPosition: { row: 0, column: 15 },
        newEndPosition: { row: 0, column: 15 },
      },
    ],
  })
  expect((await client.inspectRetention())?.documentCount).toBe(1)
  for (let index = 0; index < 8; index++) {
    const next = applyBatchToPieceTable(base, [{ from: 14, to: 15, text: String(index + 2) }])
    expect((await syntax(next, ranges, false, 'enclosing', base))?.[0]?.[0]?.type).toBe(
      'lexical_declaration',
    )
  }
  expect(parse).toHaveBeenCalledTimes(1)
  expect(project).toHaveBeenCalledTimes(10)
  await syntax.release()
  const retired = await client.inspectRetention()
  expect(retired?.documentCount).toBe(0)
  expect(retired?.source.readCount).toBe(0)
  await syntax.dispose()
})

it('projects merge units without changing highlighting trees and bounds retained projections', async () => {
  const text =
    'const before = 1;\ninterface Palette { amber: string; violet: number; }\nconst after = 2;\n' +
    'const padding = 3;\n'.repeat(1000)
  await parseTreeDocument(client, {
    ...document,
    snapshotVersion: 1,
    text,
    resultMode: 'parseOnly',
  })
  const startIndex = text.indexOf('amber')
  const range = { startIndex, endIndex: startIndex + 5 }
  const initial = await client.mergeUnit({
    ...document,
    snapshotVersion: 1,
    range,
    analysis: true,
    contentKey: true,
  })
  const prepared = await prepareTreeEdit(client, {
    ...document,
    previousSnapshotVersion: 1,
    snapshotVersion: 2,
    edits: [{ from: startIndex, to: startIndex + 5, text: 'indigo' }],
    resultMode: 'parseOnly',
  })
  expect(prepared).not.toBeNull()
  const projection = {
    ...document,
    baseSnapshotVersion: 1,
    snapshotVersion: 2,
    source: prepared!.payload.source,
    inputEdits: prepared!.payload.inputEdits,
    ranges: [{ startIndex, endIndex: startIndex + 6 }],
    analysis: true as const,
    contentKey: true as const,
  }
  try {
    const projectedText = text.slice(0, startIndex) + 'indigo' + text.slice(startIndex + 5)
    await parseTreeDocument(client, {
      ...document,
      runtimeSessionId: 'projection-control',
      snapshotVersion: 2,
      text: projectedText,
      resultMode: 'parseOnly',
    })
    const control = await client.mergeUnit({
      ...document,
      runtimeSessionId: 'projection-control',
      snapshotVersion: 2,
      range: projection.ranges[0]!,
      analysis: true,
      contentKey: true,
    })
    const projected = await client.projectMergeUnits(projection)
    expect(projected).toMatchObject({ status: 'ok', units: [[control!.unit]] })
    expect(
      await client.mergeUnit({
        ...document,
        snapshotVersion: 1,
        range,
        analysis: true,
        contentKey: true,
      }),
    ).toEqual(initial)
    const repeated = await Promise.all([
      client.projectMergeUnits(projection),
      client.projectMergeUnits(projection),
    ])
    expect(repeated).toEqual([projected, projected])
    const distant = { startIndex: text.length - 10, endIndex: text.length - 9 }
    const expanded = await client.projectMergeUnits({ ...projection, ranges: [distant] })
    const expandedControl = await client.mergeUnit({
      ...document,
      runtimeSessionId: 'projection-control',
      snapshotVersion: 2,
      range: distant,
      analysis: true,
      contentKey: true,
    })
    expect(expanded).toMatchObject({ status: 'ok', units: [[expandedControl!.unit]] })
    for (let version = 3; version <= 12; version++)
      expect(
        (await client.projectMergeUnits({ ...projection, snapshotVersion: version }))?.status,
      ).toBe('ok')
    const retained = await client.inspectRetention()
    const snapshots = retained!.documents.find(
      (entry) => entry.runtimeSessionId === document.runtimeSessionId,
    )!.snapshots
    expect(snapshots.filter((snapshot) => snapshot.snapshotVersion !== 1)).toHaveLength(6)
    expect(snapshots.some((snapshot) => snapshot.snapshotVersion === 1)).toBe(true)
    expect(
      await client.projectMergeUnits({ ...projection, baseSnapshotVersion: 99 }),
    ).toMatchObject({ status: 'stale', units: [] })
    const cancellationBuffer = new SharedArrayBuffer(4)
    Atomics.store(new Int32Array(cancellationBuffer), 0, 1)
    expect(
      await client.projectMergeUnits({ ...projection, snapshotVersion: 13, cancellationBuffer }),
    ).toMatchObject({ status: 'cancelled', units: [] })
    client.disposeDocument(document.runtimeSessionId)
    await client.awaitRuntimeSessionIdle(document.runtimeSessionId)
    expect(
      (await client.inspectRetention())!.documents.some(
        (entry) => entry.runtimeSessionId === document.runtimeSessionId,
      ),
    ).toBe(false)
  } finally {
    await prepared!.prepared.dispose()
  }
})

it.each(['markdown', 'mdx'])(
  'projects nested injections in %s without changing the base',
  async (languageId) => {
    const identity = { ...document, languageId }
    const text = '```javascript\nconst palette = json`{"amber": 1, "violet": 2}`;\n```\n'
    await parseTreeDocument(client, { ...identity, snapshotVersion: 1, text })
    const startIndex = text.indexOf('1')
    const range = { startIndex, endIndex: startIndex + 1 }
    const original = await client.mergeUnit({
      ...identity,
      snapshotVersion: 1,
      range,
      analysis: true,
      contentKey: true,
    })
    const prepared = await prepareTreeEdit(client, {
      ...identity,
      previousSnapshotVersion: 1,
      snapshotVersion: 2,
      edits: [{ from: startIndex, to: startIndex + 1, text: '9' }],
    })
    expect(prepared).not.toBeNull()
    try {
      await parseTreeDocument(client, {
        ...identity,
        runtimeSessionId: 'injection-control',
        snapshotVersion: 2,
        text: text.slice(0, startIndex) + '9' + text.slice(startIndex + 1),
      })
      const control = await client.mergeUnit({
        ...identity,
        runtimeSessionId: 'injection-control',
        snapshotVersion: 2,
        range,
        analysis: true,
        contentKey: true,
      })
      expect(control).toMatchObject({ status: 'ok', unit: { source: 'syntax', type: 'pair' } })
      expect(
        await client.projectMergeUnits({
          ...identity,
          baseSnapshotVersion: 1,
          snapshotVersion: 2,
          source: prepared!.payload.source,
          inputEdits: prepared!.payload.inputEdits,
          ranges: [range],
          analysis: true,
          contentKey: true,
        }),
      ).toMatchObject({ status: 'ok', units: [[{ ...control!.unit, languageId: 'json' }]] })
      expect(
        await client.mergeUnit({
          ...identity,
          snapshotVersion: 1,
          range,
          analysis: true,
          contentKey: true,
        }),
      ).toEqual(original)
      client.disposeDocument(identity.runtimeSessionId)
      client.disposeDocument('injection-control')
      await client.awaitRuntimeSessionIdle(identity.runtimeSessionId)
      await client.awaitRuntimeSessionIdle('injection-control')
      const retained = await client.inspectRetention()
      expect(retained!.treeCount).toBe(0)
      expect(retained!.markdownDocumentCount).toBe(0)
    } finally {
      await prepared!.prepared.dispose()
    }
  },
)

it.each([
  ['typescript', false, false],
  ['markdown', false, false],
  ['typescript', true, false],
  ['markdown', true, false],
  ['typescript', true, true],
] as const)(
  'cleans cancelled %s projection requests while preserving completed reads (reuse: %s, expand: %s)',
  async (languageId, reuse, expand) => {
    const identity = { ...document, runtimeSessionId: `cancel-${languageId}`, languageId }
    const code =
      'const first = 1;\ninterface Body { field: string; }\nconst end = 2;\n' +
      'const padding = 3;\n'.repeat(12)
    const text = languageId === 'markdown' ? `# Head\n\n\`\`\`typescript\n${code}\`\`\`\n` : code
    await parseTreeDocument(client, {
      ...identity,
      snapshotVersion: 1,
      text,
      resultMode: 'parseOnly',
    })
    const target = text.indexOf('field')
    await client.mergeUnit({
      ...identity,
      snapshotVersion: 1,
      range: { startIndex: 0, endIndex: 1 },
    })
    const prepared = await prepareTreeEdit(client, {
      ...identity,
      previousSnapshotVersion: 1,
      snapshotVersion: 2,
      edits: [{ from: target, to: target + 5, text: 'other' }],
      resultMode: 'parseOnly',
    })
    const projection = {
      ...identity,
      baseSnapshotVersion: 1,
      snapshotVersion: 2,
      source: prepared!.payload.source,
      inputEdits: prepared!.payload.inputEdits,
      ranges: [{ startIndex: target, endIndex: target + 5 }],
      analysis: true,
      contentKey: true,
    } as const
    if (reuse) expect(await client.projectMergeUnits(projection)).toMatchObject({ status: 'ok' })
    const flag = new SharedArrayBuffer(4)
    const before = await client.inspectRetention()
    const selected = expand ? text.lastIndexOf('padding') : target
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const pending = client.projectMergeUnits({
        ...projection,
        ranges: Array.from({ length: 50_000 }, () => ({
          startIndex: selected,
          endIndex: selected + 5,
        })),
        analysis: true,
        contentKey: true,
        cancellationBuffer: flag,
      })
      timer = setTimeout(() => Atomics.store(new Int32Array(flag), 0, 1), 100)
      expect(await pending).toMatchObject({ status: 'cancelled', units: [] })
      const after = await client.inspectRetention()
      expect(
        after!.documents
          .find((entry) => entry.runtimeSessionId === identity.runtimeSessionId)!
          .snapshots.map((snapshot) => snapshot.snapshotVersion),
      ).toEqual(reuse ? [1, 2] : [1])
      expect(after!.treeCount).toBe(before!.treeCount)
      expect(after!.markdownDocumentCount).toBe(before!.markdownDocumentCount)
      expect(after!.source).toEqual(before!.source)
    } finally {
      clearTimeout(timer)
      await prepared!.prepared.dispose()
    }
  },
  30_000,
)

it('highlighting eviction visits only projections owned by the evicted base', async () => {
  const text = 'interface Body { field: string; }'
  const target = text.indexOf('field')
  for (let session = 0; session < 8; session++) {
    const identity = { ...document, runtimeSessionId: `review-${session}` }
    await parseTreeDocument(client, {
      ...identity,
      snapshotVersion: 1,
      text,
      resultMode: 'parseOnly',
    })
    const prepared = await prepareTreeEdit(client, {
      ...identity,
      previousSnapshotVersion: 1,
      snapshotVersion: 2,
      edits: [{ from: target, to: target + 5, text: 'other' }],
      resultMode: 'parseOnly',
    })
    try {
      expect(
        await client.projectMergeUnits({
          ...identity,
          baseSnapshotVersion: 1,
          snapshotVersion: 2,
          source: prepared!.payload.source,
          inputEdits: prepared!.payload.inputEdits,
          ranges: [{ startIndex: target, endIndex: target + 5 }],
        }),
      ).toMatchObject({ status: 'ok' })
    } finally {
      await prepared!.prepared.dispose()
    }
  }
  const before = await client.inspectRetention()
  const idle = { ...document, runtimeSessionId: 'highlight-only' }
  for (let version = 1; version <= 12; version++) {
    await parseTreeDocument(client, {
      ...idle,
      snapshotVersion: version,
      text,
      resultMode: 'parseOnly',
    })
  }
  const after = await client.inspectRetention()
  expect(after!.projectionCleanupVisits - before!.projectionCleanupVisits).toBe(0)
  expect(after!.documents.filter((entry) => entry.runtimeSessionId.startsWith('review-'))).toEqual(
    before!.documents,
  )
  for (let version = 3; version <= 9; version++) {
    await parseTreeDocument(client, {
      ...document,
      runtimeSessionId: 'review-0',
      snapshotVersion: version,
      text,
      resultMode: 'parseOnly',
    })
  }
  const evicted = await client.inspectRetention()
  expect(evicted!.projectionCleanupVisits - after!.projectionCleanupVisits).toBe(1)
  expect(
    evicted!.documents
      .find((entry) => entry.runtimeSessionId === 'review-0')!
      .snapshots.map((snapshot) => snapshot.snapshotVersion),
  ).toEqual([9, 8, 7, 6, 5, 4])
  expect(
    evicted!.documents.filter(
      (entry) =>
        entry.runtimeSessionId.startsWith('review-') && entry.runtimeSessionId !== 'review-0',
    ),
  ).toEqual(before!.documents.slice(1))
  client.disposeDocument('review-0')
  await client.awaitRuntimeSessionIdle('review-0')
  expect((await client.inspectRetention())!.projectionCleanupVisits).toBe(
    evicted!.projectionCleanupVisits,
  )
})

it('releases request-owned projections when a merge query throws', async () => {
  const descriptor = await resolveTreeSitterLanguageContribution(
    TREE_SITTER_LANGUAGE_CONTRIBUTIONS.find((entry) => entry.id === 'typescript')!,
  )
  await client.registerLanguages([
    { ...descriptor, mergeUnitQuerySource: '(missing_node_type) @unit' },
  ])
  const text = 'interface Body { field: string; }'
  await parseTreeDocument(client, {
    ...document,
    snapshotVersion: 1,
    text,
    resultMode: 'parseOnly',
  })
  const target = text.indexOf('field')
  const prepared = await prepareTreeEdit(client, {
    ...document,
    previousSnapshotVersion: 1,
    snapshotVersion: 2,
    edits: [{ from: target, to: target + 5, text: 'other' }],
    resultMode: 'parseOnly',
  })
  const before = await client.inspectRetention()
  try {
    await expect(
      client.projectMergeUnits({
        ...document,
        baseSnapshotVersion: 1,
        snapshotVersion: 2,
        source: prepared!.payload.source,
        inputEdits: prepared!.payload.inputEdits,
        ranges: [{ startIndex: target, endIndex: target + 5 }],
      }),
    ).rejects.toThrow()
    const after = await client.inspectRetention()
    expect(after!.documents).toEqual(before!.documents)
    expect(after!.treeCount).toBe(before!.treeCount)
    expect(after!.source).toEqual(before!.source)
  } finally {
    await prepared!.prepared.dispose()
  }
})

it('the live review reader preserves nested fence languages in projected units', async () => {
  const { createTreeSitterReviewSyntax } = await import('../src/mergeReview')
  const { createPieceTableSnapshot, applyBatchToPieceTable } =
    await import('@singapore-editor/core/document')
  const languages = await Promise.all(
    ['markdown', 'javascript', 'json'].map((id) =>
      resolveTreeSitterLanguageContribution(
        TREE_SITTER_LANGUAGE_CONTRIBUTIONS.find((language) => language.id === id)!,
      ),
    ),
  )
  const syntax = createTreeSitterReviewSyntax({
    languageId: 'markdown',
    languages,
    backend: client,
  })
  const text = '```javascript\nconst palette = json`{"amber": 1, "violet": 2}`;\n```\n'
  const base = createPieceTableSnapshot(text)
  const startIndex = text.indexOf('1')
  const ranges = [{ startIndex, endIndex: startIndex + 1 }]
  const projected = applyBatchToPieceTable(base, [
    { from: startIndex, to: startIndex + 1, text: '9' },
  ])
  const parse = vi.spyOn(client, 'parse')
  const project = vi.spyOn(client, 'reviewBatch')
  expect((await syntax(base, ranges, true))?.[0]?.[0]).toMatchObject({
    type: 'pair',
    languageId: 'json',
  })
  expect((await syntax(projected, ranges, true, 'enclosing', base))?.[0]?.[0]).toMatchObject({
    type: 'pair',
    languageId: 'json',
    hasErrors: false,
  })
  expect(parse).toHaveBeenCalledTimes(1)
  expect(project).toHaveBeenCalledTimes(2)
  const result = await project.mock.results[1]!.value
  expect(result).toMatchObject({
    results: [{ languageId: 'markdown', units: [[{ languageId: 'json' }]] }],
  })
  await syntax.dispose()
  expect((await client.inspectRetention())?.source.readCount).toBe(0)
})

it.each(['stale', 'cancelled'] as const)(
  'the live review reader returns unavailable for a %s projection and releases its source',
  async (status) => {
    const { createTreeSitterReviewSyntax } = await import('../src/mergeReview')
    const { createPieceTableSnapshot, applyBatchToPieceTable } =
      await import('@singapore-editor/core/document')
    const descriptor = await resolveTreeSitterLanguageContribution(
      TREE_SITTER_LANGUAGE_CONTRIBUTIONS.find((language) => language.id === 'typescript')!,
    )
    const syntax = createTreeSitterReviewSyntax({
      languageId: 'typescript',
      languages: [descriptor],
      backend: client,
    })
    const base = createPieceTableSnapshot('const value = 0;\n')
    const projected = applyBatchToPieceTable(base, [{ from: 14, to: 15, text: '1' }])
    const ranges = [{ startIndex: 14, endIndex: 15 }]
    await syntax(base, ranges)
    const baseline = await client.inspectRetention()
    const query = client.reviewBatch.bind(client)
    const cancellationBuffer = new SharedArrayBuffer(4)
    Atomics.store(new Int32Array(cancellationBuffer), 0, 1)
    const project = vi.spyOn(client, 'reviewBatch').mockImplementation((request) =>
      query({
        ...request,
        queries: request.queries.map((item) =>
          item.type === 'projectMergeUnits'
            ? status === 'stale'
              ? { ...item, baseSnapshotVersion: -1 }
              : { ...item, cancellationBuffer }
            : item,
        ),
      }),
    )
    expect(await syntax(projected, ranges, false, 'enclosing', base)).toBeNull()
    expect(await project.mock.results[0]!.value).toMatchObject({ results: [{ status, units: [] }] })
    expect((await client.inspectRetention())?.source).toEqual(baseline?.source)
    project.mockRestore()
    expect((await syntax(projected, ranges, false, 'enclosing', base))?.[0]?.[0]?.type).toBe(
      'lexical_declaration',
    )
    await syntax.dispose()
    expect((await client.inspectRetention())?.source.readCount).toBe(0)
  },
)

it('groups current ranges and independent projections without changing units or retaining sources', async () => {
  const { createTreeSitterReviewSyntax } = await import('../src/mergeReview')
  const { createPieceTableSnapshot, applyBatchToPieceTable } =
    await import('@singapore-editor/core/document')
  const descriptor = await resolveTreeSitterLanguageContribution(
    TREE_SITTER_LANGUAGE_CONTRIBUTIONS.find((language) => language.id === 'typescript')!,
  )
  const syntax = createTreeSitterReviewSyntax({
    languageId: 'typescript',
    languages: [descriptor],
    backend: client,
  })
  const base = createPieceTableSnapshot('const value = 0;\n')
  const ranges = Array.from({ length: 100 }, () => ({ startIndex: 14, endIndex: 15 }))
  const current = await syntax(base, ranges)
  const before = await client.inspectRetention()
  const batch = vi.spyOn(client, 'reviewBatch')
  const reads = [{ snapshot: base, ranges }].concat(
    Array.from({ length: 10 }, (_, index) => ({
      snapshot: applyBatchToPieceTable(base, [{ from: 14, to: 15, text: String(index) }]),
      ranges,
      baseSnapshot: base,
    })),
  )
  const result = await syntax.batch(reads)
  expect(batch).toHaveBeenCalledTimes(1)
  expect(result).toHaveLength(11)
  expect(result.every((units) => JSON.stringify(units) === JSON.stringify(current))).toBe(true)
  expect((await client.inspectRetention())?.source).toEqual(before?.source)
  await syntax.release()
  const after = await client.inspectRetention()
  expect(after?.documentCount).toBe(0)
  expect(after?.source.readCount).toBe(0)
  await syntax.dispose()
})

it('reports stale and cancelled batch entries independently in input order', async () => {
  const text = 'const value = 0;\n'
  await parseTreeDocument(client, {
    ...document,
    snapshotVersion: 1,
    text,
    resultMode: 'parseOnly',
  })
  const cancellationBuffer = new SharedArrayBuffer(4)
  Atomics.store(new Int32Array(cancellationBuffer), 0, 1)
  const query = {
    ...document,
    type: 'mergeUnits' as const,
    snapshotVersion: 1,
    ranges: [{ startIndex: 14, endIndex: 15 }],
  }
  const result = await client.reviewBatch({
    runtimeSessionId: document.runtimeSessionId,
    queries: [{ ...query, snapshotVersion: -1 }, { ...query, cancellationBuffer }, query],
  })
  expect(result?.results.map((entry) => entry.status)).toEqual(['stale', 'cancelled', 'ok'])
  client.disposeDocument(document.runtimeSessionId)
  await client.awaitRuntimeSessionIdle(document.runtimeSessionId)
  expect(
    (await client.reviewBatch({ runtimeSessionId: document.runtimeSessionId, queries: [query] }))
      ?.results[0]?.status,
  ).toBe('stale')
})

it('cancels a posted batch when its runtime is disposed and waits for cleanup', async () => {
  const queued = new TreeSitterWorkerClient({
    workerFactory() {
      const worker = new Worker(
        new URL('../src/treeSitter/treeSitter.worker.ts', import.meta.url),
        { type: 'module' },
      )
      const send = worker.postMessage.bind(worker)
      worker.postMessage = (message, options?: StructuredSerializeOptions | Transferable[]) => {
        if (message.payload?.type === 'reviewBatch')
          queued.disposeDocument(message.payload.runtimeSessionId)
        if (Array.isArray(options)) send(message, options)
        else send(message, options)
      }
      return worker
    },
  })
  try {
    const descriptor = await resolveTreeSitterLanguageContribution(
      TREE_SITTER_LANGUAGE_CONTRIBUTIONS.find((language) => language.id === 'typescript')!,
    )
    await queued.registerLanguages([descriptor])
    const identity = { ...document, runtimeSessionId: 'dispose-review-batch', snapshotVersion: 1 }
    await parseTreeDocument(queued, {
      ...identity,
      text: 'const value = 0;\n',
      resultMode: 'parseOnly',
    })
    expect(
      await queued.reviewBatch({
        runtimeSessionId: identity.runtimeSessionId,
        queries: [
          {
            ...identity,
            type: 'mergeUnits',
            ranges: [{ startIndex: 14, endIndex: 15 }],
          },
          {
            ...identity,
            type: 'mergeUnits',
            cancellationBuffer: new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT),
            ranges: [{ startIndex: 14, endIndex: 15 }],
          },
        ],
      }),
    ).toMatchObject({
      results: [
        { status: 'cancelled', units: [] },
        { status: 'cancelled', units: [] },
      ],
    })
    await queued.awaitRuntimeSessionIdle(identity.runtimeSessionId)
    const retention = await queued.inspectRetention()
    expect(retention?.documentCount).toBe(0)
    expect(retention?.source.readCount).toBe(0)
  } finally {
    await queued.dispose()
  }
})

it('retires every projected source when a loan release rejects', async () => {
  const { createTreeSitterReviewSyntax } = await import('../src/mergeReview')
  const { createPieceTableSnapshot, applyBatchToPieceTable } =
    await import('@singapore-editor/core/document')
  const descriptor = await resolveTreeSitterLanguageContribution(
    TREE_SITTER_LANGUAGE_CONTRIBUTIONS.find((language) => language.id === 'typescript')!,
  )
  const syntax = createTreeSitterReviewSyntax({
    languageId: 'typescript',
    languages: [descriptor],
    backend: client,
  })
  const base = createPieceTableSnapshot('const value = 0;\n')
  await syntax(base, [])
  const connect = client.sourceEndpoint.connect.bind(client.sourceEndpoint)
  let releases = 0
  const spy = vi.spyOn(client.sourceEndpoint, 'connect').mockImplementation(async () => {
    const connection = await connect()
    if (!connection) return null
    return {
      ...connection,
      send: (command, signal) => {
        if (command.kind === 'unpin') {
          releases++
          return Promise.reject('loan release refused')
        }
        return connection.send(command, signal)
      },
    }
  })
  try {
    await expect(
      syntax.batch(
        Array.from({ length: 2 }, (_, index) => ({
          snapshot: applyBatchToPieceTable(base, [{ from: 14, to: 15, text: String(index + 1) }]),
          ranges: [{ startIndex: 14, endIndex: 15 }],
          baseSnapshot: base,
        })),
      ),
    ).rejects.toBe('loan release refused')
    expect(releases).toBe(2)
    await syntax.release()
    const retention = await client.inspectRetention()
    expect(retention?.documentCount).toBe(0)
    expect(retention?.source.readCount).toBe(0)
  } finally {
    spy.mockRestore()
    await syntax.dispose()
  }
})

it('bounded review requests let highlighting finish before a large review settles', async () => {
  await parseTreeDocument(client, {
    ...document,
    snapshotVersion: 1,
    text: 'const value = 0;\n',
    resultMode: 'parseOnly',
  })
  const posted: number[] = []
  const native = Worker.prototype.postMessage
  vi.spyOn(Worker.prototype, 'postMessage').mockImplementation(function (
    this: Worker,
    message,
    options,
  ) {
    if (message.payload?.type === 'reviewBatch')
      posted.push(
        message.payload.queries.reduce(
          (sum: number, query: { ranges: unknown[] }) => sum + Math.max(1, query.ranges.length),
          0,
        ),
      )
    if (Array.isArray(options)) native.call(this, message, options)
    else native.call(this, message, options)
  })
  let settled = false
  const review = client
    .reviewBatch({
      runtimeSessionId: document.runtimeSessionId,
      queries: [
        {
          ...document,
          snapshotVersion: 1,
          type: 'mergeUnits',
          ranges: Array.from({ length: 20_000 }, () => ({ startIndex: 14, endIndex: 15 })),
        },
      ],
    })
    .then((result) => {
      settled = true
      return result
    })
  await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0))
  const highlighted = await client.queryRange({
    ...document,
    snapshotVersion: 1,
    includeCaptures: true,
    range: { startIndex: 0, endIndex: 16 },
  })
  expect(highlighted?.captures.length).toBeGreaterThan(0)
  expect(settled).toBe(false)
  const result = await review
  expect(result?.results[0]?.units).toHaveLength(20_000)
  expect(Math.max(...posted)).toBeLessThanOrEqual(256)
  expect(posted).toHaveLength(Math.ceil(20_000 / 256))
  vi.restoreAllMocks()
}, 60_000)

it.each(['current', 'projected'] as const)(
  'whole-batch cancellation wins over a live %s entry flag',
  async (kind) => {
    await parseTreeDocument(client, {
      ...document,
      snapshotVersion: 1,
      text: 'const value = 0;\n',
      resultMode: 'parseOnly',
    })
    const prepared = await prepareTreeEdit(client, {
      ...document,
      previousSnapshotVersion: 1,
      snapshotVersion: 2,
      edits: [{ from: 14, to: 15, text: '1' }],
      resultMode: 'parseOnly',
    })
    const outer = new SharedArrayBuffer(4)
    Atomics.store(new Int32Array(outer), 0, 1)
    const common = {
      ...document,
      cancellationBuffer: new SharedArrayBuffer(4),
      ranges: [{ startIndex: 14, endIndex: 15 }],
    }
    const before = await client.inspectRetention()
    try {
      const query =
        kind === 'current'
          ? { ...common, type: 'mergeUnits' as const, snapshotVersion: 1 }
          : {
              ...common,
              type: 'projectMergeUnits' as const,
              baseSnapshotVersion: 1,
              snapshotVersion: 2,
              source: prepared!.payload.source,
              inputEdits: prepared!.payload.inputEdits,
            }
      expect(
        await client.reviewBatch({
          runtimeSessionId: document.runtimeSessionId,
          cancellationBuffer: outer,
          queries: [query],
        }),
      ).toMatchObject({ results: [{ status: 'cancelled', units: [] }] })
      expect((await client.inspectRetention())?.source).toEqual(before?.source)
      expect((await client.inspectRetention())?.treeCount).toBe(before?.treeCount)
    } finally {
      await prepared!.prepared.dispose()
    }
  },
  60_000,
)

it.each([0, 3_000_000])(
  'batch retention matches sequential reads across current snapshots and projected bases with %i padding',
  async (paddingSize) => {
    const { createTreeSitterReviewSyntax } = await import('../src/mergeReview')
    const { createPieceTableSnapshot, applyBatchToPieceTable } =
      await import('@singapore-editor/core/document')
    const descriptor = await resolveTreeSitterLanguageContribution(
      TREE_SITTER_LANGUAGE_CONTRIBUTIONS.find((language) => language.id === 'typescript')!,
    )
    const syntax = createTreeSitterReviewSyntax({
      languageId: 'typescript',
      languages: [descriptor],
      backend: client,
    })
    const padding = paddingSize ? '/*' + 'x'.repeat(paddingSize) + '*/\n' : ''
    const snapshots = Array.from({ length: paddingSize ? 3 : 7 }, (_, index) =>
      createPieceTableSnapshot(padding + `const value = ${index};\n`),
    )
    const ranges = [{ startIndex: padding.length + 14, endIndex: padding.length + 15 }]
    const reads: TreeSitterReviewRead[] = snapshots
      .map((snapshot) => ({ snapshot, ranges }))
      .concat(
        snapshots.map((baseSnapshot) => ({
          snapshot: applyBatchToPieceTable(baseSnapshot, [
            { from: padding.length + 14, to: padding.length + 15, text: '9' },
          ]),
          baseSnapshot,
          ranges,
        })),
      )
    const expected = []
    for (const read of reads)
      expected.push(await syntax(read.snapshot, read.ranges, false, 'enclosing', read.baseSnapshot))
    await syntax.release()
    expect(await syntax.batch(reads)).toEqual(expected)
    await syntax.dispose()
    expect((await client.inspectRetention())?.source.readCount).toBe(0)
    expect((await client.inspectRetention())?.documentCount).toBe(0)
  },
  60_000,
)

it.each(['cancel', 'supersede'] as const)(
  'stops current and projected entries after work starts when the batch is %s',
  async (action) => {
    await parseTreeDocument(client, {
      ...document,
      snapshotVersion: 1,
      text: 'const value = 0;\n',
      resultMode: 'parseOnly',
    })
    const prepared = await prepareTreeEdit(client, {
      ...document,
      previousSnapshotVersion: 1,
      snapshotVersion: 2,
      edits: [{ from: 14, to: 15, text: '1' }],
      resultMode: 'parseOnly',
    })
    const outer = new SharedArrayBuffer(4)
    const local = new SharedArrayBuffer(4)
    const ranges = Array.from({ length: 20_000 }, () => ({ startIndex: 14, endIndex: 15 }))
    let posted = false
    const native = Worker.prototype.postMessage
    vi.spyOn(Worker.prototype, 'postMessage').mockImplementation(function (
      this: Worker,
      message,
      options,
    ) {
      if (message.payload?.type === 'reviewBatch') posted = true
      if (Array.isArray(options)) native.call(this, message, options)
      else native.call(this, message, options)
    })
    try {
      const pending = client.reviewBatch({
        runtimeSessionId: document.runtimeSessionId,
        cancellationBuffer: outer,
        queries: [
          {
            ...document,
            type: 'mergeUnits',
            snapshotVersion: 1,
            ranges,
            cancellationBuffer: local,
          },
          {
            ...document,
            type: 'projectMergeUnits',
            baseSnapshotVersion: 1,
            snapshotVersion: 2,
            ranges,
            source: prepared!.payload.source,
            inputEdits: prepared!.payload.inputEdits,
            cancellationBuffer: local,
          },
        ],
      })
      await vi.waitFor(() => expect(posted).toBe(true))
      await client.queryRange({
        ...document,
        snapshotVersion: 1,
        range: { startIndex: 0, endIndex: 16 },
      })
      if (action === 'cancel') Atomics.store(new Int32Array(outer), 0, 1)
      else
        await parseTreeDocument(client, {
          ...document,
          snapshotVersion: 3,
          text: 'const value = 3;\n',
          resultMode: 'parseOnly',
        })
      expect((await pending)?.results.map((result) => result.status)).toEqual([
        'cancelled',
        'cancelled',
      ])
      expect(Atomics.load(new Int32Array(local), 0)).toBe(0)
    } finally {
      vi.restoreAllMocks()
      await prepared!.prepared.dispose()
      client.disposeDocument(document.runtimeSessionId)
      await client.awaitRuntimeSessionIdle(document.runtimeSessionId)
    }
    expect((await client.inspectRetention())?.source.readCount).toBe(0)
  },
  60_000,
)

it('declares retained review snapshots immutable before parsing them', async () => {
  const { createTreeSitterReviewSyntax } = await import('../src/mergeReview')
  const { createPieceTableSnapshot } = await import('@singapore-editor/core/document')
  const descriptor = await resolveTreeSitterLanguageContribution(
    TREE_SITTER_LANGUAGE_CONTRIBUTIONS.find((language) => language.id === 'typescript')!,
  )
  const syntax = createTreeSitterReviewSyntax({
    languageId: 'typescript',
    languages: [descriptor],
    backend: client,
  })
  const parse = vi.spyOn(client, 'parse')
  try {
    expect(
      await syntax(createPieceTableSnapshot('const value = 0;\n'), [
        { startIndex: 14, endIndex: 15 },
      ]),
    ).not.toBeNull()
    expect(parse).toHaveBeenCalledWith(
      expect.objectContaining({ readOnly: true, resultMode: 'parseOnly' }),
    )
  } finally {
    await syntax.dispose()
  }
})

it.each([false, true])(
  'immutable bases require fresh mutable parsing before edit, same-version promotion=%s',
  async (promote) => {
    const text = 'const value = 0;\nfunction read() { return value; }\n'
    const editedText = text.replace('= 0', '= 2')
    const oracle = { ...document, runtimeSessionId: 'mutable-oracle' }
    try {
      const full = await parseTreeDocument(client, {
        ...oracle,
        snapshotVersion: 1,
        text: editedText,
        includeCaptures: true,
      })
      expect(full?.timings.some((phase) => phase.name === 'treeSitter.parseRoot')).toBe(true)
      expect(full?.tokensPacked?.starts.length).toBeGreaterThan(0)
      await parseTreeDocument(client, {
        ...document,
        snapshotVersion: 1,
        text,
        readOnly: true,
        resultMode: 'parseOnly',
      })
      let promotedRoot = false
      if (promote) {
        const promoted = await parseTreeDocument(client, {
          ...document,
          snapshotVersion: 1,
          text,
          includeCaptures: true,
        })
        promotedRoot =
          promoted?.timings.some((phase) => phase.name === 'treeSitter.parseRoot') ?? false
      }
      const prepared = await prepareTreeEdit(client, {
        ...document,
        previousSnapshotVersion: 1,
        snapshotVersion: 2,
        edits: [{ from: 14, to: 15, text: '2' }],
        includeCaptures: true,
      })
      const edited = await editTreeDocument(client, prepared!)
      expect(edited?.captures).toEqual(full?.captures)
      expect(edited?.tokensPacked).toEqual(full?.tokensPacked)
      expect(edited?.errors).toEqual(full?.errors)
      expect(edited?.snapshotVersion).toBe(2)
      if (promote) {
        expect(promotedRoot).toBe(true)
        expect(edited?.timings.some((phase) => phase.name === 'treeSitter.edit')).toBe(true)
      } else {
        expect(edited?.timings.some((phase) => phase.name === 'treeSitter.edit')).toBe(false)
        expect(edited?.timings.some((phase) => phase.name === 'treeSitter.parseRoot')).toBe(true)
        expect((await client.inspectRetention())?.treeCount).toBe(2)
      }
    } finally {
      for (const runtime of [document.runtimeSessionId, oracle.runtimeSessionId]) {
        client.disposeDocument(runtime)
        await client.awaitRuntimeSessionIdle(runtime)
      }
      const retained = await client.inspectRetention()
      expect(retained?.treeCount).toBe(0)
      expect(retained?.source.readCount).toBe(0)
    }
  },
)

it('read-only requests preserve a mutable base and its next incremental edit', async () => {
  const text = 'const value = 0;\nfunction read() { return value; }\n'
  const oracle = { ...document, runtimeSessionId: 'mutable-read-oracle' }
  try {
    const full = await parseTreeDocument(client, {
      ...oracle,
      snapshotVersion: 1,
      text: text.replace('= 0', '= 2'),
      includeCaptures: true,
    })
    expect(full?.timings.some((phase) => phase.name === 'treeSitter.parseRoot')).toBe(true)
    expect(full?.tokensPacked?.starts.length).toBeGreaterThan(0)
    await parseTreeDocument(client, {
      ...oracle,
      snapshotVersion: 2,
      text,
      includeCaptures: true,
    })
    const controlPrepared = await prepareTreeEdit(client, {
      ...oracle,
      previousSnapshotVersion: 2,
      snapshotVersion: 3,
      edits: [{ from: 14, to: 15, text: '2' }],
      includeCaptures: true,
    })
    expect(controlPrepared).not.toBeNull()
    const control = await editTreeDocument(client, controlPrepared!)
    expect(control?.timings.some((phase) => phase.name === 'treeSitter.edit')).toBe(true)
    expect(control?.timings.some((phase) => phase.name === 'treeSitter.parseRoot')).toBe(true)
    await parseTreeDocument(client, {
      ...document,
      snapshotVersion: 1,
      text,
      includeCaptures: true,
    })
    const read = await parseTreeDocument(client, {
      ...document,
      snapshotVersion: 1,
      text,
      readOnly: true,
      resultMode: 'parseOnly',
    })
    const prepared = await prepareTreeEdit(client, {
      ...document,
      previousSnapshotVersion: 1,
      snapshotVersion: 2,
      edits: [{ from: 14, to: 15, text: '2' }],
      includeCaptures: true,
    })
    expect(prepared).not.toBeNull()
    const edited = await editTreeDocument(client, prepared!)
    expect(edited?.captures).toEqual(full?.captures)
    expect(edited?.tokensPacked).toEqual(full?.tokensPacked)
    expect(edited?.errors).toEqual(full?.errors)
    expect(edited?.snapshotVersion).toBe(2)
    expect(edited?.timings.some((phase) => phase.name === 'treeSitter.edit')).toBe(true)
    expect(edited?.captures).toEqual(control?.captures)
    expect(edited?.tokensPacked).toEqual(control?.tokensPacked)
    expect(edited?.errors).toEqual(control?.errors)
    expect(edited?.timings.map((phase) => phase.name)).toEqual(
      control?.timings.map((phase) => phase.name),
    )
    expect(read?.timings.some((phase) => phase.name === 'treeSitter.parseRoot')).toBe(false)
  } finally {
    for (const runtime of [document.runtimeSessionId, oracle.runtimeSessionId]) {
      client.disposeDocument(runtime)
      await client.awaitRuntimeSessionIdle(runtime)
    }
    const retained = await client.inspectRetention()
    expect(retained?.treeCount).toBe(0)
    expect(retained?.source.readCount).toBe(0)
  }
})
