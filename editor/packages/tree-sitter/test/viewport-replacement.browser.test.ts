import { afterEach, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import '../../editor/src/style.css'
import type { VirtualizedTextView } from '../../editor/src/virtualization/virtualizedTextView'
import { Editor } from '@singapore-editor/core/editor'
import {
  createTreeSitterSyntaxPlugin,
  createTreeSitterSyntaxProvider,
  createTreeSitterWorkerOwner,
} from '../src/index'
import { TreeSitterWorkerClient } from '../src/treeSitter/workerClient'
import { TreeSitterLanguageRegistry } from '../src/treeSitter/registry'
import type { TreeSitterLanguageContribution } from '../src/index'
import { TREE_SITTER_LANGUAGE_CONTRIBUTIONS } from '../../tree-sitter-languages/src/index'
import { createTreeDocument, disposeTreeDocuments } from './factories/document'
import { heldNativeWorkerReplies } from '../../editor/test/factories/heldWorker'
import { mountedColors, tokenColors } from './factories/viewportPaint'

const clients = new Set<TreeSitterWorkerClient>()
afterEach(async () => {
  disposeTreeDocuments()
  for (const client of clients) await client.dispose()
  clients.clear()
})

const cases = [
  ['unknown tag interpolation', 'unknown`hello ${foo}`;\n', ''],
  ['sql interpolation string', "sql`SELECT '${foo}'`;\n", ''],
  ['sql interpolation identifier', 'sql`SELECT fo${bar}o;`;\n', ''],
  ['typescript interpolation string', 'typescript`const x = "${foo}";`;\n', ''],
  ['typescript interpolation identifier', 'typescript`fo${bar}o();`;\n', ''],
  ['javascript interpolation comment', 'javascript`/* ${foo} */`;\n', ''],
  ['sql future string spanning host', "sql`SELECT 'foo`;\nconst visible = 42;\n", "sql`bar';`;"],
  [
    'typescript future string spanning host',
    'typescript`const x = "foo`;\nconst visible = 42;\n',
    'typescript`bar";`;',
  ],
  [
    'javascript future comment spanning host',
    'javascript`/* foo`;\nconst visible = 42;\n',
    'javascript`bar */`;',
  ],
  ['html future comment spanning host', 'html`<!-- foo`;\nconst visible = 42;\n', 'html`bar -->`;'],
  [
    'last sibling',
    'foo;\n',
    'bar;',
    '(identifier) @variable\n(program (expression_statement (identifier) @function) .)',
  ],
  [
    'later sibling predicate',
    'foo;\n',
    'stop;',
    '(identifier) @variable\n((program (expression_statement (identifier) @function) (expression_statement (identifier) @_marker)) (#eq? @_marker "stop"))',
  ],
  [
    'scope text predicate',
    'foo;\n',
    'stop;',
    '(identifier) @variable\n((program (expression_statement (identifier) @function)) @_scope (#match? @_scope "stop;"))',
  ],
  [
    'node-local predicate positive control',
    'foo;\n',
    'bar;',
    '(identifier) @variable\n((identifier) @function (#eq? @function "foo"))',
  ],
] as const

it.each(cases)(
  'atomically replaces %s with the non-provisional baseline',
  async (...args) => {
    const [_name, prefix, suffix] = args
    const query = args.length > 3 ? args[3] : undefined
    const text = prefix + ' '.repeat(80_000) + suffix
    const contributions = withHighlightQuery(query)
    const backend = new TreeSitterWorkerClient()
    clients.add(backend)
    const registry = new TreeSitterLanguageRegistry()
    for (const contribution of contributions) registry.registerLanguage(contribution)
    const baseline = createTreeDocument({
      documentId: 'complete-baseline',
      languageId: 'typescript',
      languageResolver: registry,
      backend,
      syntaxMode: 'full',
      text,
    })
    await baseline.run()
    const reference = await baseline.runtime.queryRange({ startIndex: 0, endIndex: prefix.length })
    expect(reference.projection.analysis?.kind).toBe('full')
    const finalColors = tokenColors(reference.tokens, prefix)
    expect(finalColors.some(Boolean)).toBe(true)

    const host = document.createElement('div')
    host.style.cssText =
      'display:flex;width:800px;height:400px;min-width:0;min-height:0;overflow:hidden'
    document.body.append(host)
    const gate = heldNativeWorkerReplies(
      new URL('../src/treeSitter/treeSitter.worker.ts', import.meta.url),
      ['parse', 'queryRange'],
    )
    const owner = createTreeSitterWorkerOwner({ workerFactory: gate.createWorker })
    const provider = createTreeSitterSyntaxProvider({ workerOwner: owner })
    const registrations = contributions.map((contribution) =>
      provider.registerLanguage(contribution),
    )
    const editor = new Editor(host, {
      wordWrap: true,
      plugins: [createTreeSitterSyntaxPlugin(provider)],
    })
    const samples: {
      readonly kind: string | undefined
      readonly colors: readonly (string | null)[]
    }[] = []
    const adoptions: typeof samples = []
    const partialStructures: number[] = []
    let heldComplete = false
    const view: VirtualizedTextView = editor['view']
    const adopt = view.adoptTokens.bind(view)
    view.adoptTokens = (tokens) => {
      adopt(tokens)
      adoptions.push(sample())
      const result = editor['syntax']['rangeCopyOwner']?.contributor.result
      if (result?.projection.analysis?.kind === 'partial' && !heldComplete) {
        gate.arm()
        heldComplete = true
      }
      if (result?.projection.analysis?.kind === 'partial')
        partialStructures.push(
          result.folds.length +
            result.errors.length +
            result.brackets.length +
            result.injections.length,
        )
    }
    let frame = 0
    const sample = () => ({
      kind: editor['syntax']['rangeCopyOwner']?.contributor.result.projection.analysis?.kind,
      colors: mountedColors(editor, prefix.length),
    })
    const observe = () => {
      samples.push(sample())
      frame = requestAnimationFrame(observe)
    }
    try {
      await expect.poll(() => view['view'].scrollElement.clientHeight).toBeLessThan(500)
      await expect.poll(() => view['view'].model.wrapColumn).toBeGreaterThan(0)
      frame = requestAnimationFrame(observe)
      editor.setText(text, { languageId: 'typescript' })
      await expect
        .poll(
          () => adoptions.some((entry) => entry.kind === 'partial' && entry.colors.some(Boolean)),
          { timeout: 20_000 },
        )
        .toBe(true)
      await expect.poll(() => gate.held.length, { timeout: 20_000 }).toBeGreaterThan(0)
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      if (_name === 'scope text predicate' || _name === 'typescript future string spanning host')
        await page.screenshot({
          element: host,
          path: `../../../docs/performance/singapore-viewport-first-2026-10-08/atomic-replacement/${_name.replaceAll(' ', '-')}-provisional.png`,
        })
      gate.releaseAll()
      await expect
        .poll(() => mountedColors(editor, prefix.length), { timeout: 20_000 })
        .toEqual(finalColors)
      await expect
        .poll(
          () => editor['syntax']['rangeCopyOwner']?.contributor.result.projection.analysis?.kind,
        )
        .toBe('full')
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      const provisional = adoptions.find(
        (entry) => entry.kind === 'partial' && entry.colors.some(Boolean),
      )!
      const allowed = [JSON.stringify(provisional.colors), JSON.stringify(finalColors)]
      expect(partialStructures.length).toBeGreaterThan(0)
      expect(partialStructures.every((count) => count === 0)).toBe(true)
      if (['last sibling', 'later sibling predicate', 'scope text predicate'].includes(_name))
        expect(provisional.colors).not.toEqual(finalColors)
      const firstPaint = samples.findIndex((entry) => entry.colors.some(Boolean))
      expect(firstPaint).toBeGreaterThanOrEqual(0)
      for (const entry of samples.slice(firstPaint))
        expect(allowed).toContain(JSON.stringify(entry.colors))
      const settledFrame = samples.findIndex((entry) => JSON.stringify(entry.colors) === allowed[1])
      expect(settledFrame).toBeGreaterThanOrEqual(0)
      for (const entry of samples.slice(settledFrame)) expect(entry.colors).toEqual(finalColors)
      const firstAdoption = adoptions.indexOf(provisional)
      for (const entry of adoptions.slice(firstAdoption))
        expect(allowed).toContain(JSON.stringify(entry.colors))
      expect(mountedColors(editor, prefix.length)).toEqual(finalColors)
      expect(tokenColors(editor['syntax'].tokens, prefix)).toEqual(finalColors)
      console.log(
        'viewport-frame-proof',
        JSON.stringify({
          name: _name,
          frameCount: samples.length,
          adoptionCount: adoptions.length,
          initial: provisional.colors,
          complete: finalColors,
        }),
      )
      if (_name === 'scope text predicate' || _name === 'typescript future string spanning host')
        await page.screenshot({
          element: host,
          path: `../../../docs/performance/singapore-viewport-first-2026-10-08/atomic-replacement/${_name.replaceAll(' ', '-')}.png`,
        })
    } finally {
      cancelAnimationFrame(frame)
      gate.releaseAll()
      editor.dispose()
      for (const registration of registrations) registration.dispose()
      await owner.dispose()
      host.remove()
    }
  },
  30_000,
)

function withHighlightQuery(query: string | undefined): readonly TreeSitterLanguageContribution[] {
  if (!query) return TREE_SITTER_LANGUAGE_CONTRIBUTIONS
  return TREE_SITTER_LANGUAGE_CONTRIBUTIONS.map((contribution) => {
    if (contribution.id !== 'typescript') return contribution
    return {
      ...contribution,
      load: async () => ({
        ...(await contribution.load!()),
        highlightQuerySource: query,
        injectionQuerySource: '',
      }),
    }
  })
}

it('observes a cleared paint frame and retains unchanged-row range identities', async () => {
  const host = document.createElement('div')
  host.style.cssText =
    'display:flex;width:800px;height:400px;min-width:0;min-height:0;overflow:hidden'
  document.body.append(host)
  const editor = new Editor(host)
  try {
    editor.setText('unchanged\nchanged')
    const view: VirtualizedTextView = editor['view']
    await expect.poll(() => view['view'].rowElements.size).toBeGreaterThan(0)
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    const initial = [
      { start: 0, end: 9, style: { color: '#ff0000' } },
      { start: 10, end: 17, style: { color: '#0000ff' } },
    ]
    view.setTokens(initial)
    expect(mountedColors(editor, 17)).toEqual(tokenColors(initial, 'unchanged\nchanged'))
    const firstRow = [...view['view'].rowTokenRanges.values()][0]!
    const retained = [...firstRow.values()].flat()
    const complete = [initial[0]!, { start: 10, end: 17, style: { color: '#00ff00' } }]
    view.setTokens(complete)
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    expect(mountedColors(editor, 17)).toEqual(tokenColors(complete, 'unchanged\nchanged'))
    expect([...view['view'].rowTokenRanges.values()][0]).toBe(firstRow)
    const ranges = [...firstRow.values()].flat()
    expect(ranges.length).toBe(retained.length)
    for (let index = 0; index < ranges.length; index++) expect(ranges[index]).toBe(retained[index])
    view.setTokens([])
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    expect(mountedColors(editor, 17).every((color) => color === null)).toBe(true)
  } finally {
    editor.dispose()
    host.remove()
  }
})
