import type {
  ShikiLanguageMap,
  ShikiWorkerLanguageRegistration,
} from '@singapore-editor/core/shiki'
import { bundledLanguages, bundledLanguagesInfo } from 'shiki/langs'

type BundledLanguageId = keyof typeof bundledLanguages

const GRAMMAR_BY_ALIAS: ReadonlyMap<string, BundledLanguageId> = new Map(
  bundledLanguagesInfo.flatMap((info) => [
    [info.id, info.id as BundledLanguageId] as const,
    ...(info.aliases ?? []).map((alias) => [alias, info.id as BundledLanguageId] as const),
  ]),
)

// Editor language ids whose grammar name differs from every Shiki alias.
const EDITOR_LANGUAGE_GRAMMARS: Readonly<Record<string, BundledLanguageId>> = {
  javascriptreact: 'jsx',
  typescriptreact: 'tsx',
}

// JavaScript and TypeScript stay out of the document map: `.jsx`/`.tsx` inference runs only when
// the map has no entry for the id.
const EXTENSION_INFERRED_LANGUAGES = new Set(['javascript', 'typescript'])

/** The grammar for an editor language id, fence label or alias; null when Shiki has none. */
export function highlightingGrammar(language: string): BundledLanguageId | null {
  const key = language.trim().toLowerCase()
  return EDITOR_LANGUAGE_GRAMMARS[key] ?? GRAMMAR_BY_ALIAS.get(key) ?? null
}

/** Every editor language id Shiki can color, for the document highlighter's language map. */
export const HIGHLIGHTING_DOCUMENT_LANGUAGES: ShikiLanguageMap = Object.fromEntries(
  [...GRAMMAR_BY_ALIAS, ...Object.entries(EDITOR_LANGUAGE_GRAMMARS)].filter(
    ([id]) => !EXTENSION_INFERRED_LANGUAGES.has(id),
  ),
)

export async function loadGrammar(
  language: string,
): Promise<readonly ShikiWorkerLanguageRegistration[]> {
  const grammar = highlightingGrammar(language)
  if (!grammar) throw new Error(`No Shiki grammar for ${language}`)

  const module = await bundledLanguages[grammar]()
  return module.default as unknown as readonly ShikiWorkerLanguageRegistration[]
}
