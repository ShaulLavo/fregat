import { TREE_SITTER_LANGUAGE_METADATA } from '@singapore-editor/tree-sitter-languages/metadata'
import type { EditorSyntaxLanguageId } from '@singapore-editor/core/syntax'
import { LANGUAGE_BY_BASENAME, LANGUAGE_BY_EXTENSION } from '@workspace/client-core/files/language'

const nativeAliases = new Map<string, string>(
  TREE_SITTER_LANGUAGE_METADATA.flatMap((language) =>
    [language.id, ...language.aliases].map((alias) => [alias, language.id] as const),
  ),
)
const nativeFilenames = new Map<string, string>(
  TREE_SITTER_LANGUAGE_METADATA.flatMap((language) =>
    language.filenames.map((filename) => [filename.toLowerCase(), language.id] as const),
  ),
)
const extensions = Object.entries({
  ...LANGUAGE_BY_EXTENSION,
  ...Object.fromEntries(
    TREE_SITTER_LANGUAGE_METADATA.flatMap((language) =>
      language.extensions.map((extension) => [extension, language.id]),
    ),
  ),
}).sort(([left], [right]) => right.length - left.length)

export function languageIdForFilePath(
  filePath: string,
  hints: { readonly languageId?: string; readonly firstLine?: string } = {},
): EditorSyntaxLanguageId | null {
  const explicit = hints.languageId?.trim().toLowerCase()
  if (explicit) return nativeAliases.get(explicit) ?? explicit
  const basename = filePath
    .slice(Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\')) + 1)
    .toLowerCase()
  const filenameLanguage = nativeFilenames.get(basename) ?? LANGUAGE_BY_BASENAME[basename]
  if (filenameLanguage) return filenameLanguage
  const extension = extensions.find(([extension]) => basename.endsWith(extension))
  if (extension) return extension[1]
  return languageForShebang(hints.firstLine)
}

function languageForShebang(line: string | undefined): EditorSyntaxLanguageId | null {
  if (!line?.startsWith('#!')) return null
  const words = line.slice(2).trim().split(/\s+/)
  const command = words[0]?.split('/').at(-1)
  const interpreter =
    command === 'env'
      ? words.slice(1).find((word) => !word.startsWith('-') && !word.includes('='))
      : command
  if (!interpreter) return null
  if (/^python[\d.]*$/.test(interpreter)) return 'python'
  if (['sh', 'bash', 'zsh', 'ksh'].includes(interpreter)) return 'shellscript'
  if (['node', 'nodejs'].includes(interpreter)) return 'javascript'
  return null
}
