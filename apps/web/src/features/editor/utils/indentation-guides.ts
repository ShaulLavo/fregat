import type { EditorSyntaxLanguageId } from '@singapore-editor/core'

const EXCLUDED_LANGUAGES = [
  'bibtex',
  'diff',
  'ini',
  'latex',
  'markdown',
  'typst',
] as const satisfies readonly EditorSyntaxLanguageId[]

export function editorIndentationGuidesSupported(
  languageId: EditorSyntaxLanguageId | null,
): boolean {
  if (languageId === null) return false

  return !EXCLUDED_LANGUAGES.some((excluded) => excluded === languageId)
}
