/**
 * Which file gets which glyph and hue. `generate.ts` reads this with the pinned
 * `@pierre/vscode-icons` pack and writes the app's glyph file, rule maps and hue tokens.
 */

export const HUES = [
  'gray',
  'red',
  'vermilion',
  'orange',
  'yellow',
  'green',
  'mint',
  'teal',
  'cyan',
  'blue',
  'indigo',
  'purple',
  'pink',
  'brown',
  'mauve',
] as const

export type IconHue = (typeof HUES)[number]

/** Hues the pack's palette lacks, as `[light, dark]`. The file tree drew `bun` in this mauve. */
export const LOCAL_HUES: Partial<Record<IconHue, readonly [string, string]>> = {
  mauve: ['#594c5b', '#79697b'],
}

/**
 * Light values that replace the pack's 600 so every hue clears 3:1 on the light background:
 * the 700 level of the Pierre colour theme. Dark keeps the pack's 400.
 */
export const LIGHT_OVERRIDES: Partial<Record<IconHue, string>> = {
  orange: '#ac6023',
  yellow: '#ac8816',
  mint: '#1d8978',
  teal: '#1e858e',
  cyan: '#2182a1',
}

export type IconRule = {
  /** The pack SVG to draw; defaults to the rule's own name. */
  readonly glyph?: string
  readonly hue: IconHue
  /** A second hue for the glyph's `bg` layer. */
  readonly backHue?: IconHue
  readonly fileNames?: readonly string[]
  readonly extensions?: readonly string[]
}

/**
 * Our picks. A rule named like a pack SVG draws that SVG; the pack's own maps fill in the file names
 * and extensions no rule here claims. Every pack SVG not listed is gray and matches nothing.
 */
export const RULES: Readonly<Record<string, IconRule>> = {
  astro: {
    hue: 'purple',
    backHue: 'pink',
    fileNames: ['astro.config.js', 'astro.config.mjs', 'astro.config.ts'],
    extensions: ['.astro'],
  },
  babel: {
    hue: 'yellow',
    fileNames: [
      '.babelrc',
      '.babelrc.json',
      'babel.config.js',
      'babel.config.json',
      'babel.config.cjs',
      'babel.config.mjs',
    ],
  },
  'bash-duo': {
    hue: 'green',
    fileNames: ['.bashrc', '.bash_profile', '.bash_aliases', '.zshrc', '.zprofile'],
    extensions: ['.bash', '.zsh'],
  },
  bash: {
    hue: 'green',
    fileNames: ['bashrc', 'zshrc'],
    extensions: ['.sh', '.fish', '.ksh', '.ps1', '.bat', '.cmd'],
  },
  biome: { hue: 'blue', fileNames: ['biome.json', 'biome.jsonc'] },
  'bootstrap-duo': { hue: 'indigo' },
  bootstrap: { hue: 'indigo' },
  braces: { hue: 'orange', extensions: ['.json', '.jsonc', '.webmanifest', '.map'] },
  'browserslist-duo': { hue: 'yellow', fileNames: ['.browserslistrc', 'browserslist'] },
  'bun-duo': { hue: 'mauve', fileNames: ['bun.lock', 'bun.lockb'] },
  bun: { hue: 'mauve', fileNames: ['bunfig.toml'] },
  claude: { hue: 'orange', fileNames: ['claude.md'] },
  'code-block-duo': { hue: 'gray', extensions: ['.code-snippets'] },
  code: { hue: 'gray', extensions: ['.editorconfig', '.xml', '.plist', '.scm'] },
  css: { hue: 'indigo', extensions: ['.css', '.less'] },
  docker: {
    hue: 'blue',
    fileNames: [
      'dockerfile',
      '.dockerignore',
      'docker-compose.yml',
      'docker-compose.yaml',
      'compose.yml',
      'compose.yaml',
    ],
  },
  eslint: {
    hue: 'indigo',
    fileNames: [
      '.eslintrc',
      '.eslintrc.js',
      '.eslintrc.cjs',
      '.eslintrc.json',
      'eslint.config.js',
      'eslint.config.mjs',
      'eslint.config.ts',
    ],
  },
  extension: { hue: 'gray', extensions: ['.vsix'] },
  'file-symlink': { hue: 'gray', extensions: ['.lnk'] },
  'file-table-duo': { hue: 'teal', extensions: ['.csv', '.tsv'] },
  'file-table': { hue: 'teal', extensions: ['.xls', '.xlsx', '.ods'] },
  'file-text-duo': {
    hue: 'gray',
    fileNames: ['license', 'notice', 'codeowners', 'authors', 'contributors', 'changelog'],
    extensions: ['.txt', '.log', '.patch', '.diff', '.lock', '.snap'],
  },
  'file-text': { hue: 'gray', extensions: ['.rtf'] },
  'file-zip-duo': { hue: 'orange', extensions: ['.zip', '.tar', '.gz'] },
  'file-zip': { hue: 'orange', extensions: ['.7z', '.bz2', '.rar', '.tgz', '.xz'] },
  font: { hue: 'gray', extensions: ['.eot', '.otf', '.ttf', '.woff', '.woff2'] },
  gear: {
    hue: 'gray',
    fileNames: ['.env', '.env.local', '.env.development', '.env.production'],
    extensions: ['.toml', '.nix', '.gradle', '.service'],
  },
  git: {
    hue: 'vermilion',
    fileNames: ['.gitignore', '.gitattributes', '.gitmodules', '.gitkeep', 'gitconfig'],
  },
  graphql: { hue: 'pink', extensions: ['.graphql', '.gql'] },
  html: { hue: 'orange', extensions: ['.html', '.htm'] },
  'image-duo': { hue: 'pink', extensions: ['.apng', '.avif', '.bmp', '.gif'] },
  image: { hue: 'pink', extensions: ['.ico', '.jpeg', '.jpg', '.png', '.webp'] },
  javascript: { hue: 'yellow', extensions: ['.cjs', '.js', '.mjs'] },
  'lang-c': { hue: 'blue', extensions: ['.c', '.h'] },
  'lang-cpp': {
    glyph: 'lang-c',
    hue: 'blue',
    extensions: ['.cc', '.cpp', '.cxx', '.hpp', '.hh', '.hxx', '.inl'],
  },
  'lang-csharp': { glyph: 'lang-c', hue: 'purple', extensions: ['.cs'] },
  'lang-objc': { glyph: 'lang-c', hue: 'vermilion', extensions: ['.m', '.mm'] },
  'lang-css-duo': { hue: 'indigo' },
  'lang-css': { hue: 'indigo' },
  'lang-go': { hue: 'cyan', extensions: ['.go', '.mod', '.sum'] },
  'lang-html-duo': { hue: 'orange' },
  'lang-html': { hue: 'orange' },
  'lang-html5-duo': { hue: 'orange' },
  'lang-html5': { hue: 'orange' },
  'lang-javascript-duo': { hue: 'yellow', extensions: ['.jsx'] },
  'lang-javascript': { hue: 'yellow' },
  'lang-markdown': { hue: 'green' },
  'lang-python': {
    hue: 'blue',
    backHue: 'yellow',
    extensions: ['.py', '.pyi', '.pyw', '.ipynb'],
  },
  'lang-ruby': { hue: 'red', extensions: ['.rb', '.erb', '.gemspec', '.rake'] },
  'lang-rust': { hue: 'orange', extensions: ['.rs'] },
  'lang-swift': { hue: 'orange', extensions: ['.swift'] },
  'lang-typescript-duo': { hue: 'blue', extensions: ['.tsx'] },
  'lang-typescript': { hue: 'blue', extensions: ['.d.ts'] },
  markdown: { hue: 'green', extensions: ['.markdown', '.md', '.mdx'] },
  mcp: { hue: 'teal', fileNames: ['mcp.json', '.mcp.json'] },
  nextjs: { hue: 'gray', fileNames: ['next.config.js', 'next.config.mjs', 'next.config.ts'] },
  'npm-duo': { hue: 'red', fileNames: ['package-lock.json', '.npmrc'] },
  npm: { hue: 'red', fileNames: ['package.json', 'npm-shrinkwrap.json'] },
  'oxc-fill': { hue: 'cyan' },
  oxc: { hue: 'cyan', fileNames: ['.oxlintrc.json', 'oxlint.json'] },
  postcss: {
    hue: 'red',
    fileNames: [
      'postcss.config.js',
      'postcss.config.cjs',
      'postcss.config.mjs',
      'postcss.config.ts',
      '.postcssrc',
    ],
  },
  prettier: {
    hue: 'teal',
    fileNames: [
      '.prettierrc',
      '.prettierrc.json',
      '.prettierrc.js',
      '.prettierrc.cjs',
      'prettier.config.js',
      'prettier.config.cjs',
    ],
  },
  react: { hue: 'cyan', extensions: ['.jsx', '.tsx'] },
  rss: { hue: 'gray', extensions: ['.atom', '.rss'] },
  sass: { hue: 'pink', extensions: ['.sass', '.scss'] },
  'server-duo': { hue: 'purple' },
  server: { hue: 'purple' },
  stylelint: {
    hue: 'gray',
    fileNames: [
      '.stylelintrc',
      '.stylelintrc.json',
      '.stylelintrc.js',
      'stylelint.config.js',
      'stylelint.config.mjs',
    ],
  },
  svelte: { hue: 'red', fileNames: ['svelte.config.js'], extensions: ['.svelte'] },
  'svg-2': { hue: 'orange' },
  svg: { hue: 'orange', extensions: ['.svg'] },
  svgo: { hue: 'green', fileNames: ['svgo.config.js', 'svgo.config.mjs', 'svgo.config.ts'] },
  tailwind: {
    hue: 'cyan',
    fileNames: [
      'tailwind.config.js',
      'tailwind.config.cjs',
      'tailwind.config.mjs',
      'tailwind.config.ts',
    ],
  },
  terraform: { hue: 'indigo', extensions: ['.tf', '.tfvars'] },
  typescript: {
    hue: 'blue',
    fileNames: ['tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json'],
    extensions: ['.ts'],
  },
  vite: { hue: 'purple', fileNames: ['vite.config.js', 'vite.config.mjs', 'vite.config.ts'] },
  vscode: { hue: 'blue', fileNames: ['.vscodeignore'] },
  vue: { hue: 'green', extensions: ['.vue'] },
  'wasm-duo': { hue: 'indigo' },
  wasm: { hue: 'indigo', extensions: ['.wasm', '.wat'] },
  webpack: {
    hue: 'blue',
    backHue: 'cyan',
    fileNames: [
      'webpack.config.js',
      'webpack.config.cjs',
      'webpack.config.mjs',
      'webpack.config.ts',
    ],
  },
  yml: { hue: 'red', extensions: ['.yaml', '.yml'] },
  zig: { hue: 'orange', extensions: ['.zig', '.zon'] },
}

/**
 * Pack map entries whose SVG we draw under another rule. The pack lists `LICENSE`, `AUTHORS` and
 * friends as extensions; they are file names here (see `file-text-duo`).
 */
export const PACK_NAME_ALIASES: Readonly<Record<string, string>> = {
  'lang-css-duo': 'css',
  'lang-html-duo': 'html',
  'lang-javascript-duo': 'javascript',
  'lang-typescript-duo': 'typescript',
}

export const PACK_EXTENSIONS_THAT_ARE_FILE_NAMES = new Set([
  'LICENSE',
  'AUTHORS',
  'CONTRIBUTORS',
  'CHANGELOG',
])
