import { afterEach, expect, it } from 'vitest'
import { Editor } from '@singapore-editor/core/editor'
import { toEditorTokenStore } from '@singapore-editor/core/syntax'
import { createTreeSitterLanguagePlugin } from '../src/index'
import { TreeSitterWorkerClient } from '../src/treeSitter/workerClient'
import { TreeSitterLanguageRegistry } from '../src/treeSitter/registry'
import { TREE_SITTER_LANGUAGE_CONTRIBUTIONS } from '../../tree-sitter-languages/src/index'
import { createTreeDocument, disposeTreeDocuments } from './factories/document'
import { disposeTreeSources } from './factories/source'

const clients = new Set<TreeSitterWorkerClient>()
afterEach(async () => {
  disposeTreeDocuments()
  disposeTreeSources()
  for (const client of clients) await client.dispose()
  clients.clear()
})

function document(text: string, languageId = 'typescript', syntaxMode: 'full' | 'range' = 'range') {
  const backend = new TreeSitterWorkerClient()
  clients.add(backend)
  const registry = new TreeSitterLanguageRegistry()
  for (const contribution of TREE_SITTER_LANGUAGE_CONTRIBUTIONS)
    registry.registerLanguage(contribution)
  return createTreeDocument({
    documentId: 'viewport-first',
    languageId,
    languageResolver: registry,
    backend,
    syntaxMode,
    text,
  })
}

it('admits a large source before parsing and publishes only bounded provisional tokens', async () => {
  const doc = document('const answer: number = 42;\n'.repeat(400_000))
  const admitted = await doc.run()
  expect(admitted.projection.analysis?.kind).toBe('partial')
  const point = doc.buffer.getDocumentSyncPoint()
  expect(admitted.projection.source?.point).toMatchObject({
    revision: point.revision,
    textVersion: point.textVersion,
  })
  expect(admitted.projection.source?.point.segment).toEqual(expect.any(String))
  const preview = await doc.runtime.queryRange({ startIndex: 0, endIndex: 1024 })
  expect(preview.projection.analysis?.kind).toBe('partial')
  expect(preview.projection.source).toEqual(admitted.projection.source)
  expect(preview.projection.analysis?.coveredRange.endIndex).toBeLessThanOrEqual(65_536)
  expect(preview.captures.length).toBeGreaterThan(0)
  expect(preview.folds).toEqual([])
  expect(preview.errors).toEqual([])
  expect(preview.brackets).toEqual([])
}, 30_000)

it.each([
  ['typescript', 'const answer: number = 42;\n'],
  ['typescript', 'const value = `first\nsecond`;\n/* one\ntwo */\nconst n = 1;\n'],
  ['tsx', 'const view = <Box value={1}><span>hello</span></Box>;\n'],
  ['tsx', 'const identity = <T,>(value: T): T => value;\n'],
  ['html', '<script>const answer = 42;</script>\n<style>body { color: red }</style>\n'],
])(
  'replaces %s preview tokens with complete analysis',
  async (languageId, prefix) => {
    const doc = document(prefix + ' '.repeat(70_000), languageId)
    await doc.run()
    const range = { startIndex: 0, endIndex: prefix.length }
    const preview = await doc.runtime.queryRange(range)
    expect(preview.projection.analysis?.kind).toBe('partial')
    await expect.poll(() => doc.runtime.getResult().projection.analysis?.kind).toBe('full')
    const completed = await doc.runtime.queryRange(range)
    expect(completed.projection.analysis?.kind).toBe('full')
    expect(completed.projection.source).toEqual(preview.projection.source)
    await expectBaselineTokens(doc, prefix + ' '.repeat(70_000), languageId, range)
  },
  30_000,
)

it('never treats a preview tree as complete context after a jump', async () => {
  const doc = document('/*' + 'comment\n'.repeat(12_000) + '*/\nconst answer = 42;\n')
  await doc.run()
  const first = await doc.runtime.queryRange({ startIndex: 0, endIndex: 100 })
  expect(first.folds).toEqual([])
  const range = { startIndex: 80_000, endIndex: 80_100 }
  const jumped = await doc.runtime.queryRange(range)
  expect(jumped.projection.analysis?.kind).toBe('full')
  expect(jumped.captures.every((capture) => capture.captureName === 'comment')).toBe(true)
}, 30_000)

it('waits for complete context when truncation changes a crossing comment grammar', async () => {
  const doc = document('/*' + 'comment\n'.repeat(10_000) + '*/\nconst answer = 42;\n')
  await doc.run()
  const result = await doc.runtime.queryRange({ startIndex: 0, endIndex: 100 })
  expect(result.projection.analysis?.kind).toBe('full')
  expect(result.captures.length).toBeGreaterThan(0)
  expect(result.captures.every((capture) => capture.captureName === 'comment')).toBe(true)
}, 30_000)

it.each([
  ['typescript', 'const label = `', 'line\n'.repeat(16_000), '`;\n'],
  ['tsx', 'const view = <Box>', 'text '.repeat(16_000), '</Box>;\n'],
  ['tsx', 'const identity = <T>(value: T): T => value;\n', ' '.repeat(80_000), ''],
])(
  'keeps visible %s tokens correct across ambiguous preview boundaries',
  async (languageId, prefix, body, suffix) => {
    const doc = document(prefix + body + suffix, languageId)
    await doc.run()
    const range = { startIndex: 0, endIndex: 100 }
    const initial = await doc.runtime.queryRange(range)
    await expect
      .poll(() => doc.runtime.getResult().projection.analysis?.kind, { timeout: 20_000 })
      .toBe('full')
    const complete = await doc.runtime.queryRange(range)
    const visible = (result: typeof initial) =>
      result.captures.map((capture) => ({
        ...capture,
        startIndex: Math.max(range.startIndex, capture.startIndex),
        endIndex: Math.min(range.endIndex, capture.endIndex),
      }))
    expect(visible(initial)).toEqual(visible(complete))
  },
  30_000,
)

it('cancels superseded background publication when the canonical source changes', async () => {
  const doc = document('const answer: number = 42;\n'.repeat(400_000))
  await doc.run()
  const published: number[] = []
  const unsubscribe = doc.runtime.subscribeResults((read) =>
    published.push(read.revision.point.textVersion),
  )
  await doc.runtime.queryRange({ startIndex: 0, endIndex: 100 })
  const edited = await doc.edit([{ from: 0, to: 5, text: 'let' }])
  expect(edited.projection.source?.point.textVersion).toBe(
    doc.buffer.getDocumentSyncPoint().textVersion,
  )
  await doc.runtime.queryRange({ startIndex: 0, endIndex: 100 })
  await expect
    .poll(() => doc.runtime.getResult().projection.analysis?.kind, { timeout: 20_000 })
    .toBe('full')
  expect(published.length).toBeGreaterThan(0)
  expect(
    published.every((version) => version === edited.projection.source?.point.textVersion),
  ).toBe(true)
  unsubscribe()
}, 30_000)

it('releases a disposed bootstrap and never publishes its background result', async () => {
  const doc = document('const answer: number = 42;\n'.repeat(400_000))
  await doc.run()
  let publications = 0
  doc.runtime.subscribeResults(() => publications++)
  await doc.runtime.queryRange({ startIndex: 0, endIndex: 100 })
  doc.dispose()
  const client = [...clients][0]!
  await client.awaitIdleFence()
  const retention = await client.inspectRetention()
  expect(publications).toBe(0)
  expect(retention).toMatchObject({ documentCount: 0, snapshotCount: 0, treeCount: 0 })
}, 30_000)

it('replaces provisional syntax in a mounted editor without another edit or scroll', async () => {
  const host = globalThis.document.createElement('div')
  host.style.cssText = 'width:800px;height:400px'
  globalThis.document.body.append(host)
  const editor = new Editor(host, {
    plugins: [createTreeSitterLanguagePlugin(TREE_SITTER_LANGUAGE_CONTRIBUTIONS)],
  })
  try {
    editor.setText('function answer() {\n  return 42;\n}\n' + ' '.repeat(70_000), {
      languageId: 'typescript',
    })
    await expect.poll(() => editor.getState().initialHighlightStatus).toBe('painted')
    await expect.poll(() => editor.getState().syntaxStatus, { timeout: 20_000 }).toBe('ready')
    await expect
      .poll(() => editor['syntax']['syntaxSession']?.getResult().projection.analysis?.kind, {
        timeout: 20_000,
      })
      .toBe('full')
    await expect.poll(() => editor['syntaxFoldProjection']().length).toBeGreaterThan(0)
    expect(editor['syntax'].tokens.length).toBeGreaterThan(0)
  } finally {
    editor.dispose()
    host.remove()
  }
}, 30_000)

it.each([
  ['terminated call', 'foo();\n', ' '.repeat(80_000)],
  ['distant call continuation', 'foo', ' '.repeat(80_000) + '(42);\n'],
  ['distant arrow continuation', 'const foo = ', ' '.repeat(80_000) + '() => 42;\n'],
])(
  'converges to baseline token styles for a %s',
  async (_name, prefix, suffix) => {
    const text = prefix + suffix
    const doc = document(text)
    await doc.run()
    await doc.runtime.queryRange({ startIndex: 0, endIndex: prefix.length })
    await expectBaselineTokens(doc, text, 'typescript', { startIndex: 0, endIndex: prefix.length })
  },
  30_000,
)

it('paints function declarations provisionally without a statement-kind whitelist', async () => {
  const prefix = 'function answer() { return 42; }\n'
  const text = prefix + ' '.repeat(80_000)
  const doc = document(text)
  await doc.run()
  const range = { startIndex: 0, endIndex: prefix.length }
  const initial = await doc.runtime.queryRange(range)
  expect(initial.projection.analysis?.kind).toBe('partial')
  expect(initial.projection.analysis?.coveredRange.endIndex).toBe(prefix.length + 4096)
  expect(initial.folds).toEqual([])
  expect(initial.errors).toEqual([])
  expect(initial.brackets).toEqual([])
  expect(initial.injections).toEqual([])
  await expectBaselineTokens(doc, text, 'typescript', range)
}, 30_000)

it.each([
  ['typescript`foo`;\n', 'typescript`(42);`;', 'function'],
  ['sql`SELECT foo`;\n', 'sql`(42);`;', 'function'],
  ['sql`SELECT foo`;\n', 'sql`.bar;`;', 'type'],
])(
  'converges combined injection colors for %s',
  async (prefix, suffix, finalStyle) => {
    const text = prefix + ' '.repeat(80_000) + suffix
    const doc = document(text)
    await doc.run()
    const range = { startIndex: 0, endIndex: prefix.length }
    const initial = await doc.runtime.queryRange(range)
    expect(initial.projection.analysis?.kind).toBe('partial')
    expect(initial.injections).toEqual([])
    await expectBaselineTokens(doc, text, 'typescript', range)
    const complete = await doc.runtime.queryRange(range)
    const identifier = prefix.indexOf('foo')
    const resolved = toEditorTokenStore(complete.tokens)
      .toTokens()
      .find((token) => token.start <= identifier && identifier < token.end)
    expect(resolved?.style.color).toBe(`var(--editor-syntax-${finalStyle})`)
  },
  30_000,
)

async function expectBaselineTokens(
  doc: ReturnType<typeof document>,
  text: string,
  languageId: string,
  range: { readonly startIndex: number; readonly endIndex: number },
) {
  await expect.poll(() => doc.runtime.getResult().projection.analysis?.kind).toBe('full')
  const complete = await doc.runtime.queryRange(range)
  const baseline = document(text, languageId, 'full')
  await baseline.run()
  const reference = await baseline.runtime.queryRange(range)
  expect(reference.projection.analysis?.kind).toBe('full')
  expect(toEditorTokenStore(complete.tokens).toTokens()).toEqual(
    toEditorTokenStore(reference.tokens).toTokens(),
  )
  expect(complete.captures).toEqual(reference.captures)
}
