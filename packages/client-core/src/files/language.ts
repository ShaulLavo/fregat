import type { EditorSyntaxLanguageId } from '@singapore-editor/core/syntax'

/** The shared extension table both apps resolve a grammar name from. */
export const LANGUAGE_BY_EXTENSION: Record<string, EditorSyntaxLanguageId> = {
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

/** Basenames with no extension of their own. */
export const LANGUAGE_BY_BASENAME: Record<string, EditorSyntaxLanguageId> = {
  dockerfile: 'dockerfile',
  makefile: 'makefile',
}

/** The substring from the last `.`, or `''` when the name has none. */
function extensionOf(name: string): string {
  const dotIndex = name.lastIndexOf('.')
  return dotIndex === -1 ? '' : name.slice(dotIndex)
}

/** Grammar name for a file path. Null when unknown — never `'text'`, so a caller can refuse instead of mislabeling. */
export function languageIdForFilePath(filePath: string): EditorSyntaxLanguageId | null {
  const basename = filePath
    .slice(Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\')) + 1)
    .toLowerCase()
  return LANGUAGE_BY_BASENAME[basename] ?? LANGUAGE_BY_EXTENSION[extensionOf(basename)] ?? null
}

/**
 * The protocol's name for a document, where it differs from the grammar name.
 *
 * `languageIdForFilePath` returns shiki grammar names, and shiki has no JSX-flavoured TypeScript
 * grammar, so `.tsx` is `typescript` there. Sending that in `didOpen` makes tsserver parse the file
 * as ScriptKind TS: JSX becomes a syntax error and formatting mangles it.
 */
const LSP_LANGUAGE_BY_EXTENSION: Record<string, string> = {
  '.jsx': 'javascriptreact',
  '.tsx': 'typescriptreact',
  '.jsonc': 'jsonc',
}

/** Known `.json` configuration files whose ecosystems permit comments. */
const JSONC_BASENAMES = new Set([
  '.babelrc.json',
  '.devcontainer.json',
  '.eslintrc.json',
  'babel.config.json',
  'devcontainer.json',
  'jsconfig.json',
  'tsconfig.json',
  'typedoc.json',
])

/** `tsconfig.build.json`, `jsconfig.app.json`, and the rest of the flavoured configs. */
const JSONC_BASENAME_PATTERN = /^[tj]sconfig\..+\.json$/

/** Directories whose `.json` files are all editor/tool config, comments included. */
const JSONC_DIRECTORIES = new Set(['.devcontainer', '.platform', '.vscode'])

/** Accepts a path or a file uri — only the last segment's extension is read. */
export function lspLanguageIdForPath(pathOrUri: string): string | undefined {
  const segments = pathOrUri.split('/')
  const name = (segments.at(-1) ?? '').toLowerCase()
  const extension = extensionOf(name)
  if (extension === '.json' && isJsoncDocument(name, segments)) return 'jsonc'

  return LSP_LANGUAGE_BY_EXTENSION[extension]
}

function isJsoncDocument(name: string, segments: readonly string[]) {
  if (JSONC_BASENAMES.has(name) || JSONC_BASENAME_PATTERN.test(name)) return true

  const parent = segments.at(-2)?.toLowerCase()
  return parent !== undefined && JSONC_DIRECTORIES.has(parent)
}
