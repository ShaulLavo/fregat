import { TREE_SITTER_LANGUAGE_METADATA } from '@singapore-editor/tree-sitter-languages/metadata'
import type { EditorSyntaxLanguageId } from '@singapore-editor/core'

const LANGUAGE_BY_EXTENSION: Record<string, EditorSyntaxLanguageId> = {
  '.astro': 'astro',
  '.babelrc': 'json',
  '.bash': 'shellscript',
  '.bib': 'bibtex',
  '.c': 'c',
  '.c++': 'cpp',
  '.cc': 'cpp',
  '.cfg': 'ini',
  '.cjs': 'javascript',
  '.clj': 'clojure',
  '.cljc': 'clojure',
  '.cljs': 'clojure',
  '.commitlintrc': 'json',
  '.cpp': 'cpp',
  '.cs': 'csharp',
  '.css': 'css',
  '.cts': 'typescript',
  '.cxx': 'cpp',
  '.dart': 'dart',
  '.diff': 'diff',
  '.dockerfile': 'dockerfile',
  '.edn': 'clojure',
  '.eslintrc': 'json',
  '.ex': 'elixir',
  '.exs': 'elixir',
  '.fs': 'fsharp',
  '.fsi': 'fsharp',
  '.fsscript': 'fsharp',
  '.fsx': 'fsharp',
  '.gemspec': 'ruby',
  '.gleam': 'gleam',
  '.go': 'go',
  '.gql': 'graphql',
  '.graphql': 'graphql',
  '.h': 'c',
  '.h++': 'cpp',
  '.hh': 'cpp',
  '.hintrc': 'json',
  '.hpp': 'cpp',
  '.hs': 'haskell',
  '.htm': 'html',
  '.html': 'html',
  '.hxx': 'cpp',
  '.ini': 'ini',
  '.java': 'java',
  '.jl': 'julia',
  '.js': 'javascript',
  '.json': 'json',
  '.jsonc': 'json',
  '.jsx': 'javascript',
  '.ksh': 'shellscript',
  '.kt': 'kotlin',
  '.kts': 'kotlin',
  '.lhs': 'haskell',
  '.lintstagedrc': 'json',
  '.lock': 'json',
  '.lua': 'lua',
  '.markdown': 'markdown',
  '.md': 'markdown',
  '.mjs': 'javascript',
  '.mk': 'makefile',
  '.ml': 'ocaml',
  '.mli': 'ocaml',
  '.mts': 'typescript',
  '.nix': 'nix',
  '.objc': 'objective-c',
  '.objcpp': 'objective-cpp',
  '.patch': 'diff',
  '.php': 'php',
  '.prettierrc': 'json',
  '.prisma': 'prisma',
  '.ps1': 'powershell',
  '.py': 'python',
  '.pyi': 'python',
  '.r': 'r',
  '.rake': 'ruby',
  '.rb': 'ruby',
  '.releaserc': 'json',
  '.rs': 'rust',
  '.ru': 'ruby',
  '.scala': 'scala',
  '.sh': 'shellscript',
  '.sql': 'sql',
  '.stylelintrc': 'json',
  '.svelte': 'svelte',
  '.swcrc': 'json',
  '.swift': 'swift',
  '.tex': 'latex',
  '.tf': 'terraform',
  '.tfvars': 'terraform',
  '.toml': 'toml',
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.typ': 'typst',
  '.typc': 'typst',
  '.vue': 'vue',
  '.watchmanconfig': 'json',
  '.xml': 'xml',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.zig': 'zig',
  '.zon': 'zig',
  '.zsh': 'shellscript',
}

const LANGUAGE_BY_BASENAME: Record<string, EditorSyntaxLanguageId> = {
  dockerfile: 'dockerfile',
  makefile: 'makefile',
}

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
