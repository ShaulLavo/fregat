import { expect, it } from 'vitest'
import { page } from 'vitest/browser'
import '../../editor/src/style.css'
import type { VirtualizedTextView } from '../../editor/src/virtualization/virtualizedTextView'
import { Editor } from '@singapore-editor/core/editor'
import { defineStructuralOperation } from '@singapore-editor/core/internal/document-worker'
import { TreeSitterSyntaxSession } from '../src/session'
import { TreeSitterWorkerClient } from '../src/treeSitter/workerClient'
import { TreeSitterLanguageRegistry } from '../src/treeSitter/registry'
import { TREE_SITTER_LANGUAGE_CONTRIBUTIONS } from '../../tree-sitter-languages/src/index'
import { mountedColors, tokenColors } from './factories/viewportPaint'

it('keeps provisional paint after a budget cancellation and retries retained range queries', async () => {
  const backend = new TreeSitterWorkerClient()
  const registry = new TreeSitterLanguageRegistry()
  for (const contribution of TREE_SITTER_LANGUAGE_CONTRIBUTIONS)
    registry.registerLanguage(contribution)
  const query = backend.queryRange.bind(backend)
  let cancelled = false
  let retryEnabled = false
  let calls = 0
  let runtime: TreeSitterSyntaxSession | undefined
  backend.queryRange = async (payload, signal) => {
    calls++
    const result = await query(payload, signal)
    if (!result || result.analysis?.kind !== 'full' || retryEnabled) return result
    cancelled = true
    return {
      ...result,
      tokens: [],
      tokensPacked: undefined,
      records: undefined,
      captures: [],
      folds: [],
      errors: [],
      brackets: [],
      injections: [],
      analysis: {
        kind: 'cancelled',
        reason: 'budget',
        coveredRange: { startIndex: 0, endIndex: 0 },
        elapsedMs: 20_001,
        budgetMs: 20_000,
      },
    }
  }
  const provider = {
    operation: defineStructuralOperation((context) => {
      runtime = new TreeSitterSyntaxSession({
        ...context,
        syntaxMode: 'range',
        languageId: 'typescript',
        languageResolver: registry,
        backend,
      })
      return runtime
    }),
  }
  const host = document.createElement('div')
  host.style.cssText =
    'display:flex;width:800px;height:400px;min-width:0;min-height:0;overflow:hidden'
  document.body.append(host)
  const editor = new Editor(host, {
    wordWrap: true,
    plugins: [{ activate: (context) => [context.registerSyntaxProvider(provider)] }],
  })
  const prefix = 'const answer: number = 42;\n'
  const paint: {
    initial: readonly (string | null)[] | null
    adoptedCancellation: boolean
  } = { initial: null, adoptedCancellation: false }
  const view: VirtualizedTextView = editor['view']
  const adopt = view.adoptTokens.bind(view)
  view.adoptTokens = (tokens) => {
    adopt(tokens)
    const kind = editor['syntax']['rangeCopyOwner']?.contributor.result.projection.analysis?.kind
    if (kind === 'partial') paint.initial ??= mountedColors(editor, prefix.length)
    if (kind === 'cancelled') paint.adoptedCancellation = true
  }
  try {
    editor.setText(prefix + ' '.repeat(80_000), { languageId: 'typescript' })
    await expect.poll(() => cancelled, { timeout: 20_000 }).toBe(true)
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    expect(paint.initial?.some(Boolean)).toBe(true)
    expect(paint.adoptedCancellation).toBe(false)
    expect(mountedColors(editor, prefix.length)).toEqual(paint.initial)
    expect(runtime?.canQueryRange()).toBe(true)
    expect(runtime?.getResult().projection.analysis?.kind).toBe('full')
    await page.screenshot({ element: host })
    retryEnabled = true
    const before = calls
    const recovered = await editor['syntax']['retainedSyntax']!.queryRange({
      startIndex: 0,
      endIndex: 3,
    })
    expect(calls).toBeGreaterThan(before)
    expect(recovered.projection.analysis?.kind).toBe('full')
    const baseline = await runtime!.queryRange({ startIndex: 0, endIndex: prefix.length })
    editor['syntax'].refresh(editor['documentVersion'], null, { delayMs: 0 })
    await expect
      .poll(() => mountedColors(editor, prefix.length), { timeout: 20_000 })
      .toEqual(tokenColors(baseline.tokens, prefix))
    await expect
      .poll(() => editor['syntax']['rangeCopyOwner']?.contributor.result.projection.analysis?.kind)
      .toBe('full')
    await page.screenshot({ element: host })
    console.log('viewport-cancellation-recovery', JSON.stringify({ before, after: calls }))
  } finally {
    editor.dispose()
    host.remove()
    await backend.dispose()
  }
}, 30_000)
