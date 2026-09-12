import type { EditorSyntaxLanguageId } from '@singapor/core'

/**
 * Language ids the app can hand to the editor. The js/ts/html/css/json/markdown
 * ids double as tree-sitter language ids (folds/brackets); the rest are shiki's
 * own ids — they feed the shiki highlighter's `languages` map as identity
 * entries, so every value here must be a real shiki language name.
 */
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
  '.tsx': 'typescript',
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

export function languageIdForFilePath(filePath: string): EditorSyntaxLanguageId | null {
  return (
    LANGUAGE_BY_BASENAME[basenameForFilePath(filePath)] ??
    LANGUAGE_BY_EXTENSION[extensionForFilePath(filePath)] ??
    null
  )
}

function basenameForFilePath(filePath: string) {
  const slashIndex = filePath.lastIndexOf('/')
  return filePath.slice(slashIndex + 1).toLowerCase()
}

function extensionForFilePath(filePath: string) {
  const dotIndex = filePath.lastIndexOf('.')
  if (dotIndex === -1) return ''

  return filePath.slice(dotIndex).toLowerCase()
}
