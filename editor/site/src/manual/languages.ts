import type { TreeSitterLanguageContribution } from '@singapore-editor/tree-sitter'
import { TREE_SITTER_LANGUAGE_CONTRIBUTIONS } from '@singapore-editor/tree-sitter-languages'

/**
 * Languages the docs editor loads, besides Markdown itself. The build highlights fences with the
 * same list, and rejects a fence in any other language: the editor would show it uncoloured.
 */
export const FENCE_LANGUAGE_IDS = [
  'typescript',
  'tsx',
  'javascript',
  'json',
  'shellscript',
] as const

export type FenceLanguageId = (typeof FENCE_LANGUAGE_IDS)[number]

export function languageContribution(id: string): TreeSitterLanguageContribution {
  const contribution = TREE_SITTER_LANGUAGE_CONTRIBUTIONS.find((language) => language.id === id)
  if (!contribution) throw new TypeError(`Singapore ships no tree-sitter language "${id}"`)
  return contribution
}

/** The fence language an info string names, resolved the way the editor's registry resolves it. */
export function fenceLanguage(info: string): FenceLanguageId | 'text' | null {
  const name = info.trim().toLowerCase()
  if (!name || name === 'text' || name === 'txt' || name === 'plaintext') return 'text'
  for (const id of FENCE_LANGUAGE_IDS) {
    const contribution = languageContribution(id)
    if (contribution.id === name || contribution.aliases?.includes(name)) return id
  }
  return null
}
