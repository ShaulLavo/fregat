import { createTreeSource, disposeTreeSources } from './factories/source'
import { createTreeDocument, disposeTreeDocuments } from './factories/document'
import { readAll } from '../../editor/test/factories/snapshotText'
import { afterEach } from 'vitest'
afterEach(() => {
  disposeTreeDocuments()
  disposeTreeSources()
})
import { expect, it } from 'vitest'
import { styleForTreeSitterCapture, type EditorSyntaxResult } from '@singapore-editor/core/syntax'
import {
  createDocumentSession,
  createPieceTableSnapshot,
  createDocumentTextSnapshot,
  createStringTextSnapshot,
} from '@singapore-editor/core/document'
import { TreeSitterLanguageRegistry } from '../src/treeSitter/registry'
import { TreeSitterWorkerClient } from '../src/treeSitter/workerClient'
import { TreeSitterSyntaxSession } from '../src/session'
import { markdownInlineReplacements } from '../../markdown/src/replacements'
import { NATIVE_FIXTURES } from '../../tree-sitter-languages/test/fixtures/native'
import { MDX_CATEGORIES, MDX_FIXTURE } from '../../tree-sitter-languages/test/fixtures/mdx'
import { SQL_CATEGORIES, SQL_FIXTURE } from '../../tree-sitter-languages/test/fixtures/sql'
import { TREE_SITTER_LANGUAGE_CONTRIBUTIONS } from '../../tree-sitter-languages/src/index'

const browserTest = it.skipIf(typeof Worker === 'undefined')

const astro =
  '---\r\nconst title: string = "שלום 🪐"\r\n---\r\n<!-- greeting -->\n<Card title={title}>{title}</Card>\n<script>const n = 1</script>\n<style>h1 { color: red }</style>\n'

function registry(loads: string[]) {
  const registry = new TreeSitterLanguageRegistry()
  for (const contribution of TREE_SITTER_LANGUAGE_CONTRIBUTIONS) {
    registry.registerLanguage({
      ...contribution,
      async load() {
        loads.push(contribution.id)
        return contribution.load!()
      },
    })
  }
  return registry
}

browserTest.each([
  [
    'typescript',
    '/** @param {string} value */\r\nconst pattern = /[a-z]+/;\nconst value = "שלום 🪐";\n',
  ],
  ['html', '<script>const value = "🪐";</script>\r\n<style>p { color: red }</style>\n<p>שלום</p>'],
  ['astro', astro],
  ['markdown', '# שלום 🪐\r\n\n```typescript\nconst value: string = "🪐";\n```\n'],
] as const)(
  'keeps full and whole-range syntax equal for %s injections',
  async (languageId, text) => {
    const backend = new TreeSitterWorkerClient()
    const session = createTreeDocument({
      documentId: `normalization.${languageId}`,
      languageId,
      languageResolver: registry([]),
      backend,
      syntaxMode: 'full',
      text,
    })
    try {
      const full = await session.run()
      const ranged = await session.runtime.queryRange({ startIndex: 0, endIndex: text.length })
      expect(full.degraded).toBeNull()
      expect(ranged.degraded).toBeNull()
      expect(full.injections.length).toBeGreaterThan(0)
      expect(full.captures).toEqual(ranged.captures)
      expect(tokenValues(full)).toEqual(tokenValues(ranged))
      expect(full.injections).toEqual(ranged.injections)
      expect(full.folds).toEqual(ranged.folds)
      expect(full.errors).toEqual(ranged.errors)
    } finally {
      session.dispose()
      await backend.dispose()
    }
  },
)

browserTest(
  'loads only TypeScript on a cold open and preserves angle-bracket assertions',
  async () => {
    const backend = new TreeSitterWorkerClient()
    const loads: string[] = []
    const snapshot = createPieceTableSnapshot('const n = <number>value\n')
    const session = createTreeDocument({
      documentId: 'cold.ts',
      languageId: 'typescript',
      languageResolver: registry(loads),
      backend,
      text: readAll(createDocumentTextSnapshot(snapshot)),
    })
    try {
      const result = await session.run()
      expect(loads).toEqual(['typescript'])
      expect(result.errors).toEqual([])
      expect(result.captures.some((capture) => capture.captureName === 'type.builtin')).toBe(true)
    } finally {
      session.dispose()
      await backend.dispose()
    }
  },
)

browserTest.each(['full', 'range'] as const)(
  'loads documentation and regex grammars when TypeScript injects them in %s mode',
  async (syntaxMode) => {
    const backend = new TreeSitterWorkerClient()
    const loads: string[] = []
    const text = '/** @param {string} value */\nconst pattern = /[a-z]+/;\n'
    const session = createTreeDocument({
      documentId: 'injections.ts',
      languageId: 'typescript',
      languageResolver: registry(loads),
      backend,
      syntaxMode,
      text,
    })
    try {
      let result = await session.run()
      if (syntaxMode === 'range')
        result = await session.runtime.queryRange({ startIndex: 0, endIndex: text.length })
      expect(result.degraded).toBeNull()
      expect(new Set(loads)).toEqual(new Set(['typescript', 'jsdoc', 'regex']))
      expect(result.captures.some((capture) => capture.languageId === 'jsdoc')).toBe(true)
      expect(result.captures.some((capture) => capture.languageId === 'regex')).toBe(true)
      for (const [needle, captureName] of [
        ['@param', 'keyword'],
        ['a', 'constant.character'],
      ]) {
        const start = text.indexOf(needle!, needle === 'a' ? text.indexOf('/[') : 0)
        const token = tokenValues(result).find((value) => value.start <= start && value.end > start)
        expect(token?.style).toEqual(styleForTreeSitterCapture(captureName!))
      }
    } finally {
      session.dispose()
      await backend.dispose()
    }
  },
)

browserTest.each(['full', 'range'] as const)(
  'covers every documentation and regex injection beyond 256 layers in %s mode',
  async (syntaxMode) => {
    const backend = new TreeSitterWorkerClient()
    const languageResolver = registry([])
    const text = '/** @param {string} value */\nconst pattern = /[a-z]+/;\n'.repeat(150)
    const document = createDocumentSession(text)
    const options = { languageId: 'typescript', languageResolver, backend, syntaxMode }
    const session = createTreeDocument({ ...options, documentId: 'many-injections.ts', text })
    try {
      let result = await session.run()
      if (syntaxMode === 'range')
        result = await session.runtime.queryRange({ startIndex: 0, endIndex: text.length })
      expect(result.degraded).toBeNull()
      expect(result.injections).toHaveLength(300)
      const tokens = tokenValues(result)
      for (const [start, capture] of [
        [text.lastIndexOf('@param'), 'keyword'],
        [text.lastIndexOf('[a-z]') + 1, 'constant.character'],
      ] as const) {
        expect(tokens.find((token) => token.start <= start && token.end > start)?.style).toEqual(
          styleForTreeSitterCapture(capture),
        )
      }
      const change = document.applyEdits([{ from: 4, to: 10, text: '@returns' }])
      const updated = await session.edit(change.edits)
      const actual =
        syntaxMode === 'full'
          ? updated
          : await session.runtime.queryRange({ startIndex: 0, endIndex: change.snapshot.length })
      expect(actual.degraded).toBeNull()
      expect(actual.injections).toHaveLength(300)
      await assertFreshSyntax(options, change.snapshot, actual, change.snapshot.length)
    } finally {
      session.dispose()
      await backend.dispose()
    }
  },
)

browserTest(
  'reports incomplete syntax when injection nesting exceeds the depth limit',
  async () => {
    const backend = new TreeSitterWorkerClient()
    const languageResolver = new TreeSitterLanguageRegistry()
    const contribution = TREE_SITTER_LANGUAGE_CONTRIBUTIONS.find((value) => value.id === 'html')!
    languageResolver.registerLanguage({
      ...contribution,
      async load() {
        return {
          ...(await contribution.load!()),
          injectionQuerySource:
            '((element (start_tag) (element) @injection.content (end_tag)) (#set! injection.language "html") (#set! injection.include-children))',
        }
      },
    })
    const session = createTreeDocument({
      documentId: 'nested.html',
      languageId: 'html',
      languageResolver,
      backend,
      syntaxMode: 'full',
      text: '<div>'.repeat(12) + 'text' + '</div>'.repeat(12),
    })
    try {
      const result = await session.run()
      expect(result.degraded?.kind).toBe('injection-failed')
      expect(result.degraded?.message).toContain('nesting exceeds')
    } finally {
      session.dispose()
      await backend.dispose()
    }
  },
)

browserTest.each(['full', 'range'] as const)(
  'loads an Astro fence and its nested languages in %s mode',
  async (syntaxMode) => {
    const backend = new TreeSitterWorkerClient()
    const loads: string[] = []
    const snapshot = createPieceTableSnapshot(
      '# **Heading**\n\n```astro\n' + astro + '```\n\nAfter the fence.\n',
    )
    const session = createTreeDocument({
      documentId: 'mixed.md',
      languageId: 'markdown',
      languageResolver: registry(loads),
      backend,
      syntaxMode,
      text: readAll(createDocumentTextSnapshot(snapshot)),
    })
    try {
      let result = await session.run()
      if (syntaxMode === 'range')
        result = await session.runtime.queryRange({ startIndex: 0, endIndex: snapshot.length })
      expect(result.degraded).toBeNull()
      expect(new Set(loads)).toEqual(new Set(['markdown', 'css', 'astro', 'typescript']))
      expect(loads.length).toBe(new Set(loads).size)
      expect(result.injections.some((injection) => injection.languageId === 'astro')).toBe(true)
      expect(
        result.injections.some(
          (injection) => injection.parentLanguageId === 'astro' && injection.languageId === 'css',
        ),
      ).toBe(true)
      expect(result.captures.some((capture) => capture.captureName === 'text.strong')).toBe(true)
      expect(
        result.captures.some(
          (capture) =>
            capture.languageId === 'typescript' && capture.captureName === 'keyword.declaration',
        ),
      ).toBe(true)
      expect(result.captures.some((capture) => capture.languageId === 'css')).toBe(true)
      const comment = result.captures.find(
        (capture) => capture.languageId === 'astro' && capture.captureName === 'comment',
      )!
      const tokens = 'toTokens' in result.tokens ? result.tokens.toTokens() : result.tokens
      const painted = tokens.find(
        (token) => token.start <= comment.startIndex && token.end > comment.startIndex,
      )
      expect(painted?.style).toEqual(styleForTreeSitterCapture('comment'))
    } finally {
      session.dispose()
      await backend.dispose()
    }
  },
)

browserTest(
  'matches fresh output through injection creation, Unicode replacement and delimiter removal',
  async () => {
    const backend = new TreeSitterWorkerClient()
    const languageResolver = registry([])
    let text = '```plain\n' + astro + '```\n'
    const document = createDocumentSession(text)
    let snapshot = document.getSnapshot()
    const session = createTreeDocument({
      documentId: 'edits.md',
      languageId: 'markdown',
      languageResolver,
      backend,
      text: readAll(createDocumentTextSnapshot(snapshot)),
    })
    try {
      await session.run()
      for (const [before, after] of [
        ['plain', 'astro'],
        ['title', 'heading'],
        ['🪐', '🌍🌏'],
        ['</style>', ''],
        ['```astro', '```python'],
        ['```python', '```astro'],
      ]) {
        const from = text.indexOf(before!)
        const edits = [{ from, to: from + before!.length, text: after! }]
        const change = document.applyEdits(edits)
        snapshot = change.snapshot
        text = text.slice(0, from) + after! + text.slice(from + before!.length)
        const incremental = await session.edit(change.edits)
        const fresh = createTreeDocument({
          documentId: 'fresh.md',
          languageId: 'markdown',
          languageResolver,
          backend,
          text: readAll(createDocumentTextSnapshot(snapshot)),
        })
        const expected = await fresh.run()
        expect(incremental.captures).toEqual(expected.captures)
        expect(tokenValues(incremental)).toEqual(tokenValues(expected))
        expect(incremental.injections).toEqual(expected.injections)
        expect(incremental.folds).toEqual(expected.folds)
        fresh.dispose()
      }
    } finally {
      session.dispose()
      await backend.dispose()
    }
  },
)

browserTest.each(NATIVE_FIXTURES)(
  'paints $id with only its dependency assets and matches fresh edits',
  async (fixture) => {
    const backend = new TreeSitterWorkerClient()
    const loads: string[] = []
    const languageResolver = registry(loads)
    const document = createDocumentSession(fixture.text)
    const session = createTreeDocument({
      documentId: fixture.id,
      languageId: fixture.id,
      languageResolver,
      backend,
      text: readAll(createDocumentTextSnapshot(document.getSnapshot())),
    })
    try {
      const result = await session.run()
      expect(result.degraded).toBeNull()
      expect(result.tokens.length).toBeGreaterThan(0)
      expect(result.captures.map((capture) => capture.captureName)).toEqual(
        expect.arrayContaining(fixture.captures),
      )
      const from = fixture.text.indexOf('🪐')
      const change = document.applyEdits([{ from, to: from + 2, text: '🌍 unicode' }])
      const incremental = await session.edit(change.edits)
      const fresh = createTreeDocument({
        documentId: `fresh-${fixture.id}`,
        languageId: fixture.id,
        languageResolver,
        backend,
        text: readAll(createDocumentTextSnapshot(change.snapshot)),
      })
      const expected = await fresh.run()
      expect(incremental.captures).toEqual(expected.captures)
      expect(tokenValues(incremental)).toEqual(tokenValues(expected))
      expect(incremental.folds).toEqual(expected.folds)
      expect(incremental.injections).toEqual(expected.injections)
      expect(loads.length).toBe(new Set(loads).size)
      const injected: Readonly<Record<string, readonly string[]>> = {
        astro: ['typescript'],
        svelte: ['typescript', 'css'],
      }
      expect(new Set(loads)).toEqual(new Set([fixture.id, ...(injected[fixture.id] ?? [])]))
      fresh.dispose()
    } finally {
      session.dispose()
      await backend.dispose()
    }
  },
)

browserTest.each(['full', 'range'] as const)(
  'paints SQL fences lazily and matches fresh output after syntax edits in %s mode',
  async (syntaxMode) => {
    const backend = new TreeSitterWorkerClient()
    const loads: string[] = []
    const languageResolver = registry(loads)
    let text =
      '# SQL\r\n\r\n```sql\r\n' + SQL_FIXTURE.replaceAll('\n', '\r\n') + '```\r\nAfter.\r\n'
    const document = createDocumentSession(text)
    text = document.getTextSnapshot().materializeFullText()
    const options = { languageId: 'markdown', languageResolver, backend, syntaxMode }
    const session = createTreeDocument({
      ...options,
      documentId: 'sql.md',
      text: readAll(createDocumentTextSnapshot(document.getSnapshot())),
    })
    try {
      const initial = await session.run()
      const result =
        syntaxMode === 'full'
          ? initial
          : await session.runtime.queryRange({ startIndex: 0, endIndex: text.length })
      expect(result.degraded).toBeNull()
      expect(new Set(loads)).toEqual(new Set(['markdown', 'sql']))
      assertPaint(result, text, SQL_CATEGORIES)
      for (const [before, after] of [
        ['42', "'42'"],
        ['🪐', '🌍🌏'],
        ["'hello'", "'hello"],
        ["'hello", "'hello'"],
        ['JOIN', 'LEFT JOIN'],
        ['```sql', '```plain'],
        ['```plain', '```sql'],
        ['```sql', 'sql'],
      ]) {
        const from = text.indexOf(before!)
        expect(from).toBeGreaterThanOrEqual(0)
        const change = document.applyEdits([{ from, to: from + before!.length, text: after! }])
        text = text.slice(0, from) + after! + text.slice(from + before!.length)
        const updated = await session.edit(change.edits)
        const actual =
          syntaxMode === 'full'
            ? updated
            : await session.runtime.queryRange({ startIndex: 0, endIndex: text.length })
        await assertFreshSyntax(options, change.snapshot, actual, text.length)
      }
      expect(loads.length).toBe(new Set(loads).size)
    } finally {
      session.dispose()
      await backend.dispose()
    }
  },
)

browserTest.each([
  { syntaxMode: 'full', languageId: 'mdx' },
  { syntaxMode: 'range', languageId: 'mdx' },
  { syntaxMode: 'full', languageId: 'markdown' },
  { syntaxMode: 'range', languageId: 'markdown' },
] as const)(
  'paints MDX and nested SQL fences lazily and matches fresh output after syntax edits in $languageId / $syntaxMode mode',
  async ({ syntaxMode, languageId }) => {
    const backend = new TreeSitterWorkerClient()
    const loads: string[] = []
    const languageResolver = registry(loads)
    const source = languageId === 'mdx' ? MDX_FIXTURE : '~~~mdx\n' + MDX_FIXTURE + '~~~\n'
    let text = source.replaceAll('\n', '\r\n')
    const document = createDocumentSession(text)
    text = document.getTextSnapshot().materializeFullText()
    const options = { languageId, languageResolver, backend, syntaxMode }
    const session = createTreeDocument({
      ...options,
      documentId: 'mixed.mdx',
      text: readAll(createDocumentTextSnapshot(document.getSnapshot())),
    })
    try {
      const initial = await session.run()
      const result =
        syntaxMode === 'full'
          ? initial
          : await session.runtime.queryRange({ startIndex: 0, endIndex: text.length })
      expect(result.degraded).toBeNull()
      expect(new Set(loads)).toEqual(new Set([languageId, 'mdx', 'sql']))
      assertPaint(result, text, MDX_CATEGORIES)
      if (languageId === 'markdown') {
        expect(
          markdownInlineReplacements(createStringTextSnapshot(text), result.records!.data).every(
            (spec) =>
              spec.endIndex <= text.indexOf('\n') || spec.startIndex >= text.lastIndexOf('~~~'),
          ),
        ).toBe(true)
      }
      for (const [before, after] of [
        ['{title}', '{title.toUpperCase()}'],
        ['<Badge', '<Label'],
        ['{user.name}', 'user.name}'],
        ['user.name}', '{user.name}'],
        ['<Label', 'Label'],
        ['Label', '<Label'],
        ['42', "'42'"],
        ['🪐', '🌍🌏'],
        ["'hello'", "'hello"],
        ["'hello", "'hello'"],
        ['```sql', '```plain'],
        ['```plain', '```sql'],
        ['```sql', 'sql'],
      ]) {
        const from = text.indexOf(before!)
        expect(from).toBeGreaterThanOrEqual(0)
        const change = document.applyEdits([{ from, to: from + before!.length, text: after! }])
        text = text.slice(0, from) + after! + text.slice(from + before!.length)
        const updated = await session.edit(change.edits)
        const actual =
          syntaxMode === 'full'
            ? updated
            : await session.runtime.queryRange({ startIndex: 0, endIndex: text.length })
        await assertFreshSyntax(options, change.snapshot, actual, text.length)
      }
      expect(loads.length).toBe(new Set(loads).size)
    } finally {
      session.dispose()
      await backend.dispose()
    }
  },
)

function assertPaint(
  result: EditorSyntaxResult,
  text: string,
  categories: readonly (readonly [string, string])[],
) {
  const tokens = tokenValues(result)
  for (const [value, category] of categories) {
    const start = text.indexOf(value)
    const token = tokens.find((token) => token.start <= start && token.end >= start + value.length)
    expect(token?.style, value).toEqual(styleForTreeSitterCapture(category))
  }
}

async function assertFreshSyntax(
  options: Pick<
    ConstructorParameters<typeof TreeSitterSyntaxSession>[0],
    'languageId' | 'languageResolver' | 'backend' | 'syntaxMode'
  >,
  snapshot: ReturnType<typeof createPieceTableSnapshot>,
  actual: EditorSyntaxResult,
  length: number,
) {
  const fresh = createTreeDocument({
    ...options,
    documentId: 'fresh-syntax',
    text: readAll(createDocumentTextSnapshot(snapshot)),
  })
  try {
    const initial = await fresh.run()
    const expected =
      options.syntaxMode === 'full'
        ? initial
        : await fresh.runtime.queryRange({ startIndex: 0, endIndex: length })
    expect(actual.captures).toEqual(expected.captures)
    expect(tokenValues(actual)).toEqual(tokenValues(expected))
    expect(actual.injections).toEqual(expected.injections)
    expect(actual.folds).toEqual(expected.folds)
  } finally {
    fresh.dispose()
  }
}

browserTest('reports unsupported style preprocessors without treating them as CSS', async () => {
  const backend = new TreeSitterWorkerClient()
  const languageResolver = registry([])
  const descriptor = await languageResolver.resolveTreeSitterLanguage('astro')
  await backend.registerLanguages([descriptor!])
  try {
    const snapshot = createPieceTableSnapshot(
      '<style lang="scss">$color: red; h1 { color: $color }</style>',
    )
    const result = await backend.parse({
      documentId: 'style.astro',
      runtimeSessionId: 'preprocessor',
      languageId: 'astro',
      snapshotVersion: 1,
      source: (
        await createTreeSource(
          backend.sourceEndpoint,
          readAll(createDocumentTextSnapshot(snapshot)),
        ).prepare()
      ).reference,
    })
    expect(result?.missingLanguages).toContain('scss')
    expect(result?.injections.some((injection) => injection.languageId === 'css')).toBe(false)
  } finally {
    await backend.dispose()
  }
})

function tokenValues(result: EditorSyntaxResult) {
  return 'toTokens' in result.tokens ? result.tokens.toTokens() : result.tokens
}
