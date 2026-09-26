import type { FileTreeIconConfig, RemappedIcon } from '@workspace/tree'

import {
  FILE_ICON_EXTENSIONS,
  FILE_ICON_FILE_NAMES,
  FILE_ICON_RULES,
  type FileIconRuleName,
} from '@/lib/file-icon-rules.generated'
import { VSCODE_ICON_GLYPHS, type FileIconGlyph } from '@/lib/vscode-icon-glyphs'
import { lastPathSegment } from '@/lib/path-formatters'

export type FileIconEntry = {
  name: string
  type: 'file' | 'directory' | 'symlink' | 'other'
}

export type ResolvedFileIcon = {
  name: FileIconRuleName
}

const TREE_ICON_SYMBOL_PREFIX = 'app-vscode-icon-'
const DEFAULT_FILE_ICON_TOKEN = 'default'
const GLYPH_NAMES = Object.keys(VSCODE_ICON_GLYPHS) as FileIconGlyph[]

const MIME_BY_EXTENSION = new Map<string, string>([
  ['.babelrc', 'application/json'],
  ['.commitlintrc', 'application/json'],
  ['.css', 'text/css'],
  ['.csv', 'text/csv'],
  ['.eslintrc', 'application/json'],
  ['.gif', 'image/gif'],
  ['.graphql', 'application/graphql'],
  ['.hintrc', 'application/json'],
  ['.htm', 'text/html'],
  ['.html', 'text/html'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'text/javascript'],
  ['.json', 'application/json'],
  ['.jsonc', 'application/json'],
  ['.lintstagedrc', 'application/json'],
  ['.lock', 'application/json'],
  ['.jsx', 'text/javascript'],
  ['.md', 'text/markdown'],
  ['.mdx', 'text/markdown'],
  ['.mjs', 'text/javascript'],
  ['.prettierrc', 'application/json'],
  ['.releaserc', 'application/json'],
  ['.stylelintrc', 'application/json'],
  ['.swcrc', 'application/json'],
  ['.png', 'image/png'],
  ['.rss', 'application/rss+xml'],
  ['.svg', 'image/svg+xml'],
  ['.ts', 'text/typescript'],
  ['.tsx', 'text/typescript'],
  ['.watchmanconfig', 'application/json'],
  ['.txt', 'text/plain'],
  ['.wasm', 'application/wasm'],
  ['.webp', 'image/webp'],
  ['.xml', 'application/xml'],
  ['.yaml', 'application/yaml'],
  ['.yml', 'application/yaml'],
  ['.zip', 'application/zip'],
])

export function iconForEntry(
  entry: FileIconEntry,
  options: { open?: boolean } = {},
): ResolvedFileIcon {
  if (entry.type === 'directory') {
    return iconResult(options.open ? 'folder-open-duo' : 'folder-duo')
  }

  if (entry.type === 'symlink') return iconResult('file-symlink-duo')
  if (entry.type !== 'file') return iconResult('file-duo')

  return iconResult(iconNameForFile(entry.name))
}

export function fileTreeIconsForPaths(paths: readonly string[]): FileTreeIconConfig {
  return {
    ...BASE_FILE_TREE_ICONS,
    byFileName: {
      ...BASE_FILE_TREE_ICONS.byFileName,
      ...fileTreeFileNameIconsForPaths(paths),
    },
  }
}

/** The glyph and the literal hue classes a resolved icon draws with. */
export function fileIconRule(icon: ResolvedFileIcon) {
  return FILE_ICON_RULES[icon.name]
}

export function fileMatchesAccept(name: string, accept?: readonly string[]) {
  if (!accept || accept.length === 0) return true

  return accept.some((token) => fileMatchesAcceptToken(name, token))
}

function mimeForFileName(name: string) {
  for (const extension of extensionCandidates(name)) {
    const mime = MIME_BY_EXTENSION.get(extension)
    if (mime) return mime
  }

  return 'application/octet-stream'
}

function iconNameForFile(name: string): FileIconRuleName {
  const normalizedName = normalizeName(name)
  const fileNameIcon = FILE_ICON_FILE_NAMES[normalizedName]
  if (fileNameIcon) return fileNameIcon

  for (const extension of extensionCandidates(normalizedName)) {
    const icon = FILE_ICON_EXTENSIONS[extension]
    if (icon) return icon
  }

  return 'file-duo'
}

function fileMatchesAcceptToken(name: string, token: string) {
  const normalizedToken = token.trim().toLocaleLowerCase()
  if (!normalizedToken) return false
  if (normalizedToken.startsWith('*.')) {
    return extensionCandidates(name).includes(normalizedToken.slice(1))
  }
  if (normalizedToken.startsWith('.')) {
    return extensionCandidates(name).includes(normalizedToken)
  }
  if (normalizedToken.includes('/')) return mimeMatches(name, normalizedToken)

  return normalizeName(name) === normalizedToken
}

function mimeMatches(name: string, token: string) {
  const mime = mimeForFileName(name)
  if (token.endsWith('/*')) return mime.startsWith(token.slice(0, -1))

  return mime === token
}

function iconResult(name: FileIconRuleName): ResolvedFileIcon {
  return {
    name,
  }
}

const ICON_TOKENS: Partial<Record<FileIconGlyph, string>> = {
  astro: 'astro',
  babel: 'babel',
  'bash-duo': 'bash',
  bash: 'bash',
  biome: 'biome',
  'bootstrap-duo': 'bootstrap',
  bootstrap: 'bootstrap',
  braces: 'json',
  'browserslist-duo': 'browserslist',
  'bun-duo': 'bun',
  bun: 'bun',
  claude: 'claude',
  css: 'css',
  docker: 'docker',
  eslint: 'eslint',
  'file-table-duo': 'table',
  'file-table': 'table',
  'file-text-duo': 'text',
  'file-text': 'text',
  'file-zip-duo': 'zip',
  'file-zip': 'zip',
  font: 'default',
  git: 'git',
  graphql: 'graphql',
  html: 'html',
  'image-duo': 'image',
  image: 'image',
  javascript: 'javascript',
  'lang-css-duo': 'css',
  'lang-css': 'css',
  'lang-go': 'go',
  'lang-html-duo': 'html',
  'lang-html': 'html',
  'lang-html5-duo': 'html',
  'lang-html5': 'html',
  'lang-javascript-duo': 'javascript',
  'lang-javascript': 'javascript',
  'lang-markdown': 'markdown',
  'lang-python': 'python',
  'lang-ruby': 'ruby',
  'lang-rust': 'rust',
  'lang-swift': 'swift',
  'lang-typescript-duo': 'typescript',
  'lang-typescript': 'typescript',
  markdown: 'markdown',
  mcp: 'mcp',
  nextjs: 'default',
  'npm-duo': 'npm',
  npm: 'npm',
  'oxc-fill': 'oxc',
  oxc: 'oxc',
  postcss: 'postcss',
  prettier: 'prettier',
  react: 'react',
  rss: 'text',
  sass: 'sass',
  stylelint: 'default',
  svelte: 'svelte',
  'svg-2': 'svg',
  svg: 'svg',
  svgo: 'svgo',
  tailwind: 'tailwind',
  terraform: 'terraform',
  typescript: 'typescript',
  vite: 'vite',
  vscode: 'vscode',
  vue: 'vue',
  'wasm-duo': 'wasm',
  wasm: 'wasm',
  webpack: 'webpack',
  yml: 'yml',
  zig: 'zig',
}

const BASE_FILE_TREE_ICONS = {
  set: 'complete',
  colored: true,
  spriteSheet: vscodeIconSpriteSheet(),
  remap: {
    'file-tree-icon-file': treeIconReference('file-duo'),
  },
  byFileName: fileTreeFileNameIconRules(),
  byFileExtension: fileTreeExtensionIconRules(),
} satisfies FileTreeIconConfig

function fileTreeFileNameIconsForPaths(paths: readonly string[]) {
  const icons: Record<string, RemappedIcon> = {}

  for (const path of paths) {
    if (path.endsWith('/')) continue

    const name = lastPathSegment(path)
    icons[normalizeName(name)] = treeIconReference(iconNameForFile(name))
  }

  return icons
}

function fileTreeFileNameIconRules() {
  const icons: Record<string, RemappedIcon> = {}
  for (const [name, rule] of Object.entries(FILE_ICON_FILE_NAMES)) {
    icons[name] = treeIconReference(rule)
  }
  return icons
}

function fileTreeExtensionIconRules() {
  const icons: Record<string, RemappedIcon> = {}
  for (const [extension, rule] of Object.entries(FILE_ICON_EXTENSIONS)) {
    icons[extension.replace(/^\./u, '')] = treeIconReference(rule)
  }
  return icons
}

function vscodeIconSpriteSheet() {
  const symbols = GLYPH_NAMES.map(vscodeIconSymbol).join('')

  return `<svg data-vscode-icon-sprite aria-hidden="true" width="0" height="0">${symbols}</svg>`
}

function vscodeIconSymbol(name: FileIconGlyph) {
  const glyph = VSCODE_ICON_GLYPHS[name]
  return `<symbol id="${TREE_ICON_SYMBOL_PREFIX}${name}" viewBox="${glyph.viewBox}">${glyph.paths}</symbol>`
}

/** The tree draws each rule's glyph with the tree's own colour token for it. */
function treeIconReference(rule: FileIconRuleName): RemappedIcon {
  const glyph = FILE_ICON_RULES[rule].glyph
  return {
    name: `${TREE_ICON_SYMBOL_PREFIX}${glyph}`,
    token: ICON_TOKENS[glyph] ?? DEFAULT_FILE_ICON_TOKEN,
  } as RemappedIcon
}

function extensionCandidates(name: string) {
  const normalizedName = normalizeName(name)
  const dotIndexes = indexesOf(normalizedName, '.')
  return dotIndexes.map((index) => normalizedName.slice(index))
}

function indexesOf(value: string, needle: string) {
  const indexes: number[] = []
  let index = value.indexOf(needle)

  while (index >= 0) {
    indexes.push(index)
    index = value.indexOf(needle, index + needle.length)
  }

  return indexes
}

function normalizeName(name: string) {
  return name.trim().toLocaleLowerCase()
}
