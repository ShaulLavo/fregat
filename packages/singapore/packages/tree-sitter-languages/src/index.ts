// oxlint-disable-next-line typescript-eslint/triple-slash-reference
/// <reference path="./vite-assets.d.ts" />
import { createTreeSitterLanguagePlugin } from '@singapore-editor/tree-sitter'
import type { EditorPlugin } from '@singapore-editor/core/extensions'
import type {
  TreeSitterLanguageAssets,
  TreeSitterLanguageContribution,
  TreeSitterLanguagePluginOptions,
} from '@singapore-editor/tree-sitter'

import { TREE_SITTER_LANGUAGE_CONTRIBUTIONS } from './catalog.generated'

export type JavaScriptTreeSitterLanguageOptions = TreeSitterLanguagePluginOptions & {
  readonly jsx?: boolean
}

export type TypeScriptTreeSitterLanguageOptions = TreeSitterLanguagePluginOptions & {
  readonly tsx?: boolean
}

export const JAVASCRIPT_TREE_SITTER_LANGUAGE = createJavaScriptContribution(false)

export const TYPESCRIPT_TREE_SITTER_LANGUAGE = createTypeScriptContribution(false)

export { TREE_SITTER_LANGUAGE_CONTRIBUTIONS } from './catalog.generated'
export { TREE_SITTER_LANGUAGE_METADATA } from './metadata'

export const TSX_TREE_SITTER_LANGUAGE = contribution('tsx')
export const HTML_TREE_SITTER_LANGUAGE = contribution('html')
export const CSS_TREE_SITTER_LANGUAGE = contribution('css')
export const JSON_TREE_SITTER_LANGUAGE = contribution('json')
export const MARKDOWN_TREE_SITTER_LANGUAGE = contribution('markdown')
export const ASTRO_TREE_SITTER_LANGUAGE = contribution('astro')

function contribution(id: string): TreeSitterLanguageContribution {
  return TREE_SITTER_LANGUAGE_CONTRIBUTIONS.find((language) => language.id === id)!
}

export function javaScript(options: JavaScriptTreeSitterLanguageOptions = {}): EditorPlugin {
  const { jsx = false, ...pluginOptions } = options
  return createLanguagePlugin(
    createJavaScriptContribution(jsx),
    'tree-sitter-javascript',
    pluginOptions,
  )
}

export function typeScript(options: TypeScriptTreeSitterLanguageOptions = {}): EditorPlugin {
  const { tsx = false, ...pluginOptions } = options
  return createLanguagePlugin(
    createTypeScriptContribution(tsx),
    'tree-sitter-typescript',
    pluginOptions,
  )
}

export function html(options?: TreeSitterLanguagePluginOptions): EditorPlugin {
  return createLanguagePlugin(HTML_TREE_SITTER_LANGUAGE, 'tree-sitter-html', options)
}

export function css(options?: TreeSitterLanguagePluginOptions): EditorPlugin {
  return createLanguagePlugin(CSS_TREE_SITTER_LANGUAGE, 'tree-sitter-css', options)
}

export function json(options?: TreeSitterLanguagePluginOptions): EditorPlugin {
  return createLanguagePlugin(JSON_TREE_SITTER_LANGUAGE, 'tree-sitter-json', options)
}

export function markdown(options: TreeSitterLanguagePluginOptions = {}): EditorPlugin {
  return createTreeSitterLanguagePlugin([MARKDOWN_TREE_SITTER_LANGUAGE], {
    ...options,
    name: options.name ?? 'tree-sitter-markdown',
  })
}

function createLanguagePlugin(
  contribution: TreeSitterLanguageContribution,
  name: string,
  options: TreeSitterLanguagePluginOptions = {},
): EditorPlugin {
  return createTreeSitterLanguagePlugin(withBundledInjections(contribution), {
    ...options,
    name: options.name ?? name,
  })
}

function withBundledInjections(
  root: TreeSitterLanguageContribution,
): readonly TreeSitterLanguageContribution[] {
  const contributions = [root]
  const seen = new Set([root.id])
  for (const contribution of contributions) {
    for (const id of contribution.injectionDependencies ?? []) {
      if (seen.has(id)) continue
      const dependency = TREE_SITTER_LANGUAGE_CONTRIBUTIONS.find((language) => language.id === id)
      if (!dependency) continue
      seen.add(id)
      contributions.push(dependency)
    }
  }
  return contributions
}

function createJavaScriptContribution(jsx: boolean): TreeSitterLanguageContribution {
  return {
    id: 'javascript',
    extensions: jsx ? ['.cjs', '.js', '.jsx', '.mjs'] : ['.cjs', '.js', '.mjs'],
    aliases: jsx ? ['javascript', 'js', 'jsx', 'node'] : ['javascript', 'js', 'node'],
    injectionDependencies: ['regex', 'jsdoc'],
    load: () => loadJavaScriptAssets(jsx),
  }
}

function createTypeScriptContribution(tsx: boolean): TreeSitterLanguageContribution {
  return {
    id: tsx ? 'tsx' : 'typescript',
    extensions: tsx ? ['.tsx'] : ['.cts', '.mts', '.ts'],
    aliases: tsx ? ['tsx', 'typescriptreact'] : ['typescript', 'ts'],
    injectionDependencies: ['regex', 'jsdoc'],
    load: () => loadTypeScriptAssets(tsx),
  }
}

async function loadJavaScriptAssets(jsx: boolean): Promise<TreeSitterLanguageAssets> {
  const [
    wasmUrl,
    highlightQuerySource,
    foldQuerySource,
    injectionQuerySource,
    mergeUnitQuerySource,
    fieldQuerySource,
  ] = await Promise.all([
    loadDefault(import('tree-sitter-javascript/tree-sitter-javascript.wasm?url')),
    loadDefault(import('./queries/javascript-highlights.scm?raw')),
    loadDefault(import('./queries/javascript-folds.scm?raw')),
    loadDefault(import('./queries/javascript-injections.scm?raw')),
    loadDefault(import('./queries/javascript-merge-units.scm?raw')),
    loadDefault(import('./queries/javascript-fields-merge-units.scm?raw')),
  ])
  if (!jsx)
    return {
      wasmUrl,
      highlightQuerySource,
      foldQuerySource,
      injectionQuerySource,
      mergeUnitQuerySource: [mergeUnitQuerySource, fieldQuerySource].join('\n'),
    }

  const [jsxHighlightQuerySource, jsxFoldQuerySource] = await Promise.all([
    loadDefault(import('tree-sitter-javascript/queries/highlights-jsx.scm?raw')),
    loadDefault(import('./queries/jsx-folds.scm?raw')),
  ])
  return {
    wasmUrl,
    highlightQuerySource: [highlightQuerySource, jsxHighlightQuerySource].join('\n'),
    foldQuerySource: [foldQuerySource, jsxFoldQuerySource].join('\n'),
    injectionQuerySource,
    mergeUnitQuerySource: [mergeUnitQuerySource, fieldQuerySource].join('\n'),
  }
}

async function loadTypeScriptAssets(tsx: boolean): Promise<TreeSitterLanguageAssets> {
  const [
    wasmUrl,
    tsHighlightQuerySource,
    jsHighlightQuerySource,
    tsFoldQuerySource,
    jsFoldQuerySource,
    injectionQuerySource,
    jsMergeUnitQuerySource,
    tsMergeUnitQuerySource,
  ] = await Promise.all([
    loadDefault(
      tsx
        ? import('tree-sitter-typescript/tree-sitter-tsx.wasm?url')
        : import('tree-sitter-typescript/tree-sitter-typescript.wasm?url'),
    ),
    loadDefault(import('./queries/typescript-highlights.scm?raw')),
    loadDefault(import('./queries/javascript-highlights.scm?raw')),
    loadDefault(import('./queries/typescript-folds.scm?raw')),
    loadDefault(import('./queries/javascript-folds.scm?raw')),
    loadDefault(import('./queries/javascript-injections.scm?raw')),
    loadDefault(import('./queries/javascript-merge-units.scm?raw')),
    loadDefault(import('./queries/typescript-merge-units.scm?raw')),
  ])
  const highlightQuerySource = await typeScriptHighlightQuerySource(tsx, [
    tsHighlightQuerySource,
    jsHighlightQuerySource,
  ])
  const foldQuerySource = await typeScriptFoldQuerySource(tsx, [
    tsFoldQuerySource,
    jsFoldQuerySource,
  ])
  return {
    wasmUrl,
    highlightQuerySource,
    foldQuerySource,
    injectionQuerySource,
    mergeUnitQuerySource: [jsMergeUnitQuerySource, tsMergeUnitQuerySource]
      .concat(tsx ? [await loadDefault(import('./queries/tsx-merge-units.scm?raw'))] : [])
      .join('\n'),
  }
}

async function typeScriptHighlightQuerySource(
  tsx: boolean,
  sources: readonly string[],
): Promise<string> {
  if (!tsx) return sources.join('\n')

  const jsxHighlightQuerySource = await loadDefault(
    import('tree-sitter-javascript/queries/highlights-jsx.scm?raw'),
  )
  return sources.concat([jsxHighlightQuerySource]).join('\n')
}

async function typeScriptFoldQuerySource(
  tsx: boolean,
  sources: readonly string[],
): Promise<string> {
  if (!tsx) return sources.join('\n')

  const jsxFoldQuerySource = await loadDefault(import('./queries/jsx-folds.scm?raw'))
  return sources.concat([jsxFoldQuerySource]).join('\n')
}

async function loadDefault(module: Promise<{ readonly default: string }>): Promise<string> {
  return (await module).default
}
