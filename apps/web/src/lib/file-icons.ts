import { getBuiltInFileIconColor } from '@workspace/tree'
import type { FileTreeIconConfig, RemappedIcon } from '@workspace/tree'

import { VSCODE_ICON_SYMBOLS } from './vscode-icon-symbols'

export type FileIconEntry = {
  name: string
  type: 'file' | 'directory' | 'symlink' | 'other'
}

const VSCODE_ICON_NAMES = [
  'IconLayers3Middle',
  'astro',
  'babel',
  'bash-duo',
  'bash',
  'biome',
  'bootstrap-duo',
  'bootstrap',
  'braces',
  'browserslist-duo',
  'bun-duo',
  'bun',
  'claude',
  'code-block-duo',
  'code',
  'css',
  'docker',
  'eslint',
  'extension',
  'file-duo',
  'file-plus-duo',
  'file-symlink-duo',
  'file-symlink',
  'file-table-duo',
  'file-table',
  'file-text-duo',
  'file-text',
  'file-zip-duo',
  'file-zip',
  'file',
  'folder-duo',
  'folder-open-duo',
  'folder-open',
  'folder-plus-duo',
  'folder-zip-duo',
  'folder-zip',
  'folder',
  'folders',
  'font',
  'gear',
  'git',
  'graphql',
  'html',
  'image-duo',
  'image',
  'javascript',
  'lang-c',
  'lang-css-duo',
  'lang-css',
  'lang-go',
  'lang-html-duo',
  'lang-html',
  'lang-html5-duo',
  'lang-html5',
  'lang-javascript-duo',
  'lang-javascript',
  'lang-markdown',
  'lang-python',
  'lang-ruby',
  'lang-rust',
  'lang-swift',
  'lang-typescript-duo',
  'lang-typescript',
  'markdown',
  'mcp',
  'nextjs',
  'npm-duo',
  'npm',
  'oxc-fill',
  'oxc',
  'postcss',
  'prettier',
  'react',
  'rss',
  'sass',
  'server-duo',
  'server',
  'stylelint',
  'svelte',
  'svg-2',
  'svg',
  'svgo',
  'tailwind',
  'terraform',
  'typescript',
  'vite',
  'vscode',
  'vue',
  'wasm-duo',
  'wasm',
  'webpack',
  'yml',
  'zig',
] as const

type VscodeIconName = (typeof VSCODE_ICON_NAMES)[number]

type IconRule = {
  filenames?: readonly string[]
  stems?: readonly string[]
  extensions?: readonly string[]
}

export type ResolvedFileIcon = {
  name: VscodeIconName
  src: string
}

const ICON_BASE_PATH = `${import.meta.env.BASE_URL}vscode-icons`
const TREE_ICON_SYMBOL_PREFIX = 'app-vscode-icon-'
const DEFAULT_FILE_ICON_TOKEN = 'default'

const VSCODE_ICON_RULES = {
  IconLayers3Middle: { stems: ['layers', 'layer', 'stack'] },
  astro: {
    filenames: ['astro.config.js', 'astro.config.mjs', 'astro.config.ts'],
    extensions: ['.astro'],
  },
  babel: {
    filenames: [
      '.babelrc',
      '.babelrc.json',
      'babel.config.js',
      'babel.config.json',
      'babel.config.cjs',
      'babel.config.mjs',
    ],
  },
  'bash-duo': {
    filenames: ['.bashrc', '.bash_profile', '.bash_aliases', '.zshrc', '.zprofile'],
    extensions: ['.bash', '.zsh'],
  },
  bash: {
    filenames: ['bashrc', 'zshrc'],
    extensions: ['.sh', '.fish', '.ksh'],
  },
  biome: { filenames: ['biome.json', 'biome.jsonc'] },
  'bootstrap-duo': { stems: ['bootstrap-duo'] },
  bootstrap: { stems: ['bootstrap'] },
  braces: { stems: ['braces'], extensions: ['.json', '.jsonc'] },
  'browserslist-duo': { filenames: ['.browserslistrc', 'browserslist'] },
  'bun-duo': { filenames: ['bun.lock', 'bun.lockb'] },
  bun: { filenames: ['bunfig.toml'], stems: ['bun'] },
  claude: { filenames: ['claude.md'], stems: ['claude'] },
  'code-block-duo': {
    stems: ['code-block', 'snippet'],
    extensions: ['.code-snippets'],
  },
  code: { stems: ['code'], extensions: ['.editorconfig'] },
  css: { extensions: ['.css'] },
  docker: {
    filenames: [
      'dockerfile',
      '.dockerignore',
      'docker-compose.yml',
      'docker-compose.yaml',
      'compose.yml',
      'compose.yaml',
    ],
  },
  eslint: {
    filenames: [
      '.eslintrc',
      '.eslintrc.js',
      '.eslintrc.cjs',
      '.eslintrc.json',
      'eslint.config.js',
      'eslint.config.mjs',
      'eslint.config.ts',
    ],
  },
  extension: { stems: ['extension'], extensions: ['.vsix'] },
  'file-duo': { stems: ['file-duo'] },
  'file-plus-duo': { stems: ['file-plus', 'new-file'] },
  'file-symlink-duo': { stems: ['file-symlink-duo'] },
  'file-symlink': { stems: ['file-symlink'], extensions: ['.lnk'] },
  'file-table-duo': { extensions: ['.csv', '.tsv'] },
  'file-table': { extensions: ['.xls', '.xlsx', '.ods'] },
  'file-text-duo': { extensions: ['.txt', '.log'] },
  'file-text': { extensions: ['.rtf'] },
  'file-zip-duo': { extensions: ['.zip', '.tar', '.gz'] },
  'file-zip': { extensions: ['.7z', '.bz2', '.rar', '.tgz', '.xz'] },
  file: { stems: ['file'] },
  'folder-duo': { stems: ['folder-duo'] },
  'folder-open-duo': { stems: ['folder-open-duo'] },
  'folder-open': { stems: ['folder-open'] },
  'folder-plus-duo': { stems: ['folder-plus'] },
  'folder-zip-duo': { stems: ['folder-zip-duo'] },
  'folder-zip': { stems: ['folder-zip'] },
  folder: { stems: ['folder'] },
  folders: { stems: ['folders'] },
  font: { extensions: ['.eot', '.otf', '.ttf', '.woff', '.woff2'] },
  gear: {
    filenames: ['.env', '.env.local', '.env.development', '.env.production'],
    stems: ['config', 'settings'],
  },
  git: {
    filenames: ['.gitignore', '.gitattributes', '.gitmodules', '.gitkeep', 'gitconfig'],
  },
  graphql: { extensions: ['.graphql', '.gql'] },
  html: { extensions: ['.html', '.htm'] },
  'image-duo': { extensions: ['.apng', '.avif', '.bmp', '.gif'] },
  image: { extensions: ['.ico', '.jpeg', '.jpg', '.png', '.webp'] },
  javascript: { extensions: ['.cjs', '.js', '.mjs'] },
  'lang-c': {
    extensions: ['.c', '.cc', '.cpp', '.cxx', '.h', '.hpp', '.m', '.mm'],
  },
  'lang-css-duo': { stems: ['lang-css-duo'] },
  'lang-css': { stems: ['lang-css'] },
  'lang-go': { extensions: ['.go', '.mod', '.sum'] },
  'lang-html-duo': { stems: ['lang-html-duo'] },
  'lang-html': { stems: ['lang-html'] },
  'lang-html5-duo': { stems: ['lang-html5-duo'] },
  'lang-html5': { stems: ['lang-html5'] },
  'lang-javascript-duo': { extensions: ['.jsx'] },
  'lang-javascript': { stems: ['lang-javascript'] },
  'lang-markdown': { stems: ['lang-markdown'] },
  'lang-python': { extensions: ['.py', '.pyi', '.pyw'] },
  'lang-ruby': { extensions: ['.rb', '.erb', '.gemspec', '.rake'] },
  'lang-rust': { extensions: ['.rs'] },
  'lang-swift': { extensions: ['.swift'] },
  'lang-typescript-duo': { extensions: ['.tsx'] },
  'lang-typescript': { extensions: ['.d.ts'] },
  markdown: { extensions: ['.markdown', '.md', '.mdx'] },
  mcp: { filenames: ['mcp.json'], stems: ['mcp'] },
  nextjs: {
    filenames: ['next.config.js', 'next.config.mjs', 'next.config.ts'],
  },
  'npm-duo': { filenames: ['package-lock.json', '.npmrc'] },
  npm: { filenames: ['package.json', 'npm-shrinkwrap.json'] },
  'oxc-fill': { stems: ['oxc-fill'] },
  oxc: { filenames: ['.oxlintrc.json', 'oxlint.json'], stems: ['oxc'] },
  postcss: {
    filenames: [
      'postcss.config.js',
      'postcss.config.cjs',
      'postcss.config.mjs',
      'postcss.config.ts',
      '.postcssrc',
    ],
  },
  prettier: {
    filenames: [
      '.prettierrc',
      '.prettierrc.json',
      '.prettierrc.js',
      '.prettierrc.cjs',
      'prettier.config.js',
      'prettier.config.cjs',
    ],
  },
  react: { stems: ['react'], extensions: ['.jsx', '.tsx'] },
  rss: { extensions: ['.atom', '.rss'] },
  sass: { extensions: ['.sass', '.scss'] },
  'server-duo': { stems: ['server-duo'] },
  server: { stems: ['server'] },
  stylelint: {
    filenames: [
      '.stylelintrc',
      '.stylelintrc.json',
      '.stylelintrc.js',
      'stylelint.config.js',
      'stylelint.config.mjs',
    ],
  },
  svelte: { filenames: ['svelte.config.js'], extensions: ['.svelte'] },
  'svg-2': { stems: ['svg-2'] },
  svg: { extensions: ['.svg'] },
  svgo: { filenames: ['svgo.config.js', 'svgo.config.mjs', 'svgo.config.ts'] },
  tailwind: {
    filenames: [
      'tailwind.config.js',
      'tailwind.config.cjs',
      'tailwind.config.mjs',
      'tailwind.config.ts',
    ],
  },
  terraform: { extensions: ['.tf', '.tfvars'] },
  typescript: {
    filenames: ['tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json'],
    extensions: ['.ts'],
  },
  vite: { filenames: ['vite.config.js', 'vite.config.mjs', 'vite.config.ts'] },
  vscode: { filenames: ['.vscodeignore'], stems: ['vscode'] },
  vue: { extensions: ['.vue'] },
  'wasm-duo': { stems: ['wasm-duo'] },
  wasm: { extensions: ['.wasm', '.wat'] },
  webpack: {
    filenames: [
      'webpack.config.js',
      'webpack.config.cjs',
      'webpack.config.mjs',
      'webpack.config.ts',
    ],
  },
  yml: { extensions: ['.yaml', '.yml'] },
  zig: { extensions: ['.zig', '.zon'] },
} satisfies Record<VscodeIconName, IconRule>

const ICON_RULES: Record<VscodeIconName, IconRule> = VSCODE_ICON_RULES
const EXACT_FILENAME_ICONS = iconMapFor('filenames')
const STEM_ICONS = iconMapFor('stems')
const EXTENSION_ICONS = iconMapFor('extensions')

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

export function colorForFileIcon(icon: ResolvedFileIcon) {
  return (
    getBuiltInFileIconColor(tokenForIconName(icon.name)) ??
    getBuiltInFileIconColor(DEFAULT_FILE_ICON_TOKEN)
  )
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

function iconNameForFile(name: string): VscodeIconName {
  const normalizedName = normalizeName(name)
  const filenameIcon = EXACT_FILENAME_ICONS.get(normalizedName)
  if (filenameIcon) return filenameIcon

  const stemIcon = STEM_ICONS.get(stemForName(normalizedName))
  if (stemIcon) return stemIcon

  const extensionIcon = iconForExtension(normalizedName)
  if (extensionIcon) return extensionIcon

  return 'file-duo'
}

function iconForExtension(name: string) {
  for (const extension of extensionCandidates(name)) {
    const icon = EXTENSION_ICONS.get(extension)
    if (icon) return icon
  }

  return null
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

function iconMapFor(key: keyof IconRule) {
  const map = new Map<string, VscodeIconName>()

  for (const iconName of VSCODE_ICON_NAMES) {
    const values = ICON_RULES[iconName][key] ?? []
    for (const value of values) setIconMapValue(map, value, iconName)
  }

  return map
}

function setIconMapValue(
  map: Map<string, VscodeIconName>,
  value: string,
  iconName: VscodeIconName,
) {
  const normalizedValue = normalizeRuleValue(value)
  if (map.has(normalizedValue)) return

  map.set(normalizedValue, iconName)
}

function iconResult(name: VscodeIconName): ResolvedFileIcon {
  return {
    name,
    src: iconSrc(name),
  }
}

const ICON_TOKENS: Partial<Record<VscodeIconName, string>> = {
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

    const name = basenameForIconPath(path)
    icons[normalizeName(name)] = treeIconReference(iconNameForFile(name))
  }

  return icons
}

function fileTreeFileNameIconRules() {
  const icons: Record<string, RemappedIcon> = {}

  for (const iconName of VSCODE_ICON_NAMES) {
    const rule = ICON_RULES[iconName]
    addFileTreeIconRules(icons, rule.filenames, iconName)
    addFileTreeIconRules(icons, rule.stems, iconName)
  }

  return icons
}

function fileTreeExtensionIconRules() {
  const icons: Record<string, RemappedIcon> = {}

  for (const iconName of VSCODE_ICON_NAMES) {
    const extensions = ICON_RULES[iconName].extensions ?? []
    for (const extension of extensions) {
      icons[extension.replace(/^\./u, '')] = treeIconReference(iconName)
    }
  }

  return icons
}

function addFileTreeIconRules(
  icons: Record<string, RemappedIcon>,
  values: readonly string[] | undefined,
  iconName: VscodeIconName,
) {
  if (!values) return

  for (const value of values) {
    icons[normalizeRuleValue(value)] = treeIconReference(iconName)
  }
}

function vscodeIconSpriteSheet() {
  const symbols = VSCODE_ICON_NAMES.map(vscodeIconSymbol).join('')

  return `<svg data-vscode-icon-sprite aria-hidden="true" width="0" height="0">${symbols}</svg>`
}

function vscodeIconSymbol(name: VscodeIconName) {
  return VSCODE_ICON_SYMBOLS[name]
}

function treeIconReference(name: VscodeIconName): RemappedIcon {
  return {
    name: treeIconSymbolName(name),
    token: tokenForIconName(name),
  } as RemappedIcon
}

function treeIconSymbolName(name: VscodeIconName) {
  return `${TREE_ICON_SYMBOL_PREFIX}${name}`
}

function iconSrc(name: VscodeIconName) {
  return `${ICON_BASE_PATH}/${name}.svg`
}

function basenameForIconPath(path: string) {
  const parts = path.split('/').filter(Boolean)
  return parts.at(-1) ?? path
}

function tokenForIconName(name: VscodeIconName) {
  return ICON_TOKENS[name] ?? DEFAULT_FILE_ICON_TOKEN
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

function stemForName(name: string) {
  const index = name.indexOf('.')
  if (index < 0) return name

  return name.slice(0, index)
}

function normalizeName(name: string) {
  return name.trim().toLocaleLowerCase()
}

function normalizeRuleValue(value: string) {
  return normalizeName(value)
}
