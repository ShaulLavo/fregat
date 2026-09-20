import {
  type ShikiLanguageMap,
  type ShikiWorkerLanguageRegistration,
} from '@singapore-editor/core/shiki'

import { createClientInvariantError } from '@/lib/structured-errors'

type ShikiLanguageModule = {
  readonly default: readonly ShikiWorkerLanguageRegistration[]
}

type ShikiLanguageLoader = () => Promise<ShikiLanguageModule>

const SHIKI_CORE_LANGUAGE_LOADERS = {
  css: () => import('@shikijs/langs/css'),
  html: () => import('@shikijs/langs/html'),
  javascript: () => import('@shikijs/langs/javascript'),
  json: () => import('@shikijs/langs/json'),
  jsx: () => import('@shikijs/langs/jsx'),
  markdown: () => import('@shikijs/langs/markdown'),
  tsx: () => import('@shikijs/langs/tsx'),
  typescript: () => import('@shikijs/langs/typescript'),
} satisfies Readonly<Record<string, ShikiLanguageLoader>>

// Tree-sitter-backed ids stay out so the plugin can preserve `.jsx` and `.tsx` inference.
const SHIKI_NATIVE_LANGUAGE_IDS = [
  ['astro', () => import('@shikijs/langs/astro')],
  ['bibtex', () => import('@shikijs/langs/bibtex')],
  ['c', () => import('@shikijs/langs/c')],
  ['clojure', () => import('@shikijs/langs/clojure')],
  ['cpp', () => import('@shikijs/langs/cpp')],
  ['csharp', () => import('@shikijs/langs/csharp')],
  ['dart', () => import('@shikijs/langs/dart')],
  ['diff', () => import('@shikijs/langs/diff')],
  ['dockerfile', () => import('@shikijs/langs/dockerfile')],
  ['elixir', () => import('@shikijs/langs/elixir')],
  ['fsharp', () => import('@shikijs/langs/fsharp')],
  ['gleam', () => import('@shikijs/langs/gleam')],
  ['go', () => import('@shikijs/langs/go')],
  ['graphql', () => import('@shikijs/langs/graphql')],
  ['haskell', () => import('@shikijs/langs/haskell')],
  ['ini', () => import('@shikijs/langs/ini')],
  ['java', () => import('@shikijs/langs/java')],
  ['julia', () => import('@shikijs/langs/julia')],
  ['kotlin', () => import('@shikijs/langs/kotlin')],
  ['latex', () => import('@shikijs/langs/latex')],
  ['lua', () => import('@shikijs/langs/lua')],
  ['makefile', () => import('@shikijs/langs/makefile')],
  ['nix', () => import('@shikijs/langs/nix')],
  ['objective-c', () => import('@shikijs/langs/objective-c')],
  ['objective-cpp', () => import('@shikijs/langs/objective-cpp')],
  ['ocaml', () => import('@shikijs/langs/ocaml')],
  ['php', () => import('@shikijs/langs/php')],
  ['powershell', () => import('@shikijs/langs/powershell')],
  ['prisma', () => import('@shikijs/langs/prisma')],
  ['python', () => import('@shikijs/langs/python')],
  ['r', () => import('@shikijs/langs/r')],
  ['ruby', () => import('@shikijs/langs/ruby')],
  ['rust', () => import('@shikijs/langs/rust')],
  ['scala', () => import('@shikijs/langs/scala')],
  ['shellscript', () => import('@shikijs/langs/shellscript')],
  ['sql', () => import('@shikijs/langs/sql')],
  ['svelte', () => import('@shikijs/langs/svelte')],
  ['swift', () => import('@shikijs/langs/swift')],
  ['terraform', () => import('@shikijs/langs/terraform')],
  ['toml', () => import('@shikijs/langs/toml')],
  ['typst', () => import('@shikijs/langs/typst')],
  ['vue', () => import('@shikijs/langs/vue')],
  ['xml', () => import('@shikijs/langs/xml')],
  ['yaml', () => import('@shikijs/langs/yaml')],
  ['zig', () => import('@shikijs/langs/zig')],
] as const

const SHIKI_LANGUAGE_LOADERS: Readonly<Record<string, ShikiLanguageLoader>> = {
  ...SHIKI_CORE_LANGUAGE_LOADERS,
  ...Object.fromEntries(SHIKI_NATIVE_LANGUAGE_IDS),
}

export const EDITOR_SHIKI_LANGUAGE_MAP: ShikiLanguageMap = {
  markdown: 'markdown',
  typescript: 'typescript',
  tsx: 'tsx',
  ...Object.fromEntries(SHIKI_NATIVE_LANGUAGE_IDS.map(([id]) => [id, id])),
}

export function resolveShikiLanguageRegistrations(
  language: string,
): Promise<readonly ShikiWorkerLanguageRegistration[]> {
  const loader = SHIKI_LANGUAGE_LOADERS[language]
  if (!loader) {
    throw createClientInvariantError(`Unknown Platform Shiki language: ${language}`)
  }

  return loader().then((module) => module.default)
}

// Preload after first paint so later documents can add grammars without an import wait.
export const EDITOR_SHIKI_PRELOAD_LANGUAGES: readonly string[] = [
  'css',
  'html',
  'javascript',
  'json',
  'jsx',
  'markdown',
  'tsx',
  'typescript',
  ...SHIKI_NATIVE_LANGUAGE_IDS.map(([id]) => id),
]
