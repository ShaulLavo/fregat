import { describe, expect, it, vi } from 'vitest'

import { createEditorTextBuffer } from '@singapore-editor/core/document'
import { createEditorDocumentAnalysis } from '@singapore-editor/core/editor'
import type { EditorPluginContext } from '@singapore-editor/core/extensions'
import type {
  TreeSitterLanguageAssets,
  TreeSitterLanguageContribution,
} from '@singapore-editor/tree-sitter'
import {
  JAVASCRIPT_TREE_SITTER_LANGUAGE,
  TREE_SITTER_LANGUAGE_CONTRIBUTIONS,
  TYPESCRIPT_TREE_SITTER_LANGUAGE,
  css,
  html,
  javaScript,
  json,
  markdown,
  typeScript,
} from '../src'
import { createTestPluginContext } from '@singapore-editor/core/testing'

describe('Tree-sitter language contributions', () => {
  it('exports the first-party language descriptors', () => {
    expect(TREE_SITTER_LANGUAGE_CONTRIBUTIONS.map((contribution) => contribution.id)).toEqual([
      'javascript',
      'typescript',
      'tsx',
      'html',
      'css',
      'json',
      'markdown',
      'astro',
      'python',
      'shellscript',
      'rust',
      'go',
      'yaml',
      'toml',
      'c',
      'cpp',
      'csharp',
      'java',
      'php',
      'lua',
      'svelte',
      'sql',
      'mdx',
    ])
    expect(TREE_SITTER_LANGUAGE_CONTRIBUTIONS.every((contribution) => 'load' in contribution)).toBe(
      true,
    )
  })

  it('exports one configurable plugin per language', () => {
    const plugins = [
      javaScript({ jsx: true }),
      typeScript({ replace: true, tsx: true }),
      html(),
      css(),
      json(),
      markdown(),
    ]
    const context = pluginContext()
    const registerSyntaxProvider = vi.mocked(context.registerSyntaxProvider)

    for (const plugin of plugins) plugin.activate(context)

    expect(plugins.map((plugin) => plugin.name)).toEqual([
      'tree-sitter-javascript',
      'tree-sitter-typescript',
      'tree-sitter-html',
      'tree-sitter-css',
      'tree-sitter-json',
      'tree-sitter-markdown',
    ])
    expect(registerSyntaxProvider).toHaveBeenCalledTimes(1)
    expect(registerSyntaxProvider).toHaveBeenCalledWith(
      expect.objectContaining({ operation: expect.any(Object) }),
    )
    const provider = registerSyntaxProvider.mock.calls[0]?.[0]
    if (!provider)
      throw new TypeError('The language plugins must register one typed structural provider')
    const analysis = createEditorDocumentAnalysis({
      buffer: createEditorTextBuffer('const a = 1;'),
      documentId: 'main.ts',
    })
    const lease = analysis.borrowStructural({
      provider,
      languageId: 'typescript',
      includeHighlights: true,
    })
    expect(lease).not.toBeNull()
    lease?.dispose()
    analysis.dispose()
  })

  it('loads JSX folds only for JSX-capable JavaScript and TypeScript assets', async () => {
    const [javascriptAssets, typescriptAssets, jsxJavascriptAssets, tsxTypescriptAssets] =
      await Promise.all([
        loadAssets(JAVASCRIPT_TREE_SITTER_LANGUAGE),
        loadAssets(TYPESCRIPT_TREE_SITTER_LANGUAGE),
        loadAssets(requiredContribution('javascript')),
        loadAssets(requiredContribution('tsx')),
      ])

    expect(javascriptAssets.foldQuerySource).not.toContain('jsx_element')
    expect(typescriptAssets.foldQuerySource).not.toContain('jsx_element')
    expect(jsxJavascriptAssets.foldQuerySource).toContain('jsx_element')
    expect(jsxJavascriptAssets.foldQuerySource).toContain('jsx_self_closing_element')
    expect(tsxTypescriptAssets.foldQuerySource).toContain('jsx_element')
    expect(tsxTypescriptAssets.foldQuerySource).toContain('jsx_self_closing_element')
  })
})

function requiredContribution(id: string): TreeSitterLanguageContribution {
  const contribution = TREE_SITTER_LANGUAGE_CONTRIBUTIONS.find((candidate) => candidate.id === id)
  if (!contribution) throw new Error(`Missing language contribution: ${id}`)
  return contribution
}

async function loadAssets(
  contribution: TreeSitterLanguageContribution,
): Promise<TreeSitterLanguageAssets> {
  if (!contribution.load) throw new Error(`Language contribution is not lazy: ${contribution.id}`)
  return contribution.load()
}

function pluginContext(): EditorPluginContext {
  return createTestPluginContext({
    registerHighlighter: vi.fn(() => ({ dispose: vi.fn() })),
    registerSyntaxProvider: vi.fn<EditorPluginContext['registerSyntaxProvider']>(() => ({
      dispose: vi.fn(),
    })),
    registerViewContribution: vi.fn(() => ({ dispose: vi.fn() })),
    registerCommandContribution: vi.fn(() => ({ dispose: vi.fn() })),
    registerCapabilityContribution: vi.fn(() => ({ dispose: vi.fn() })),
    registerEditContribution: vi.fn(() => ({ dispose: vi.fn() })),
    registerDecorationContribution: vi.fn(() => ({ dispose: vi.fn() })),
    registerGutterContribution: vi.fn(() => ({ dispose: vi.fn() })),
    registerInjectedTextRowProvider: vi.fn(() => ({ dispose: vi.fn() })),
  })
}
