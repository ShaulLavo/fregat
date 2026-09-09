import type {
  LspFeatureId,
  LspFeatureRanks,
  LspLanguageServerLists,
  LspServerOverride,
  LspServerOverrides,
} from '@workspace/contracts'
import { access, readdir } from 'node:fs/promises'
import path from 'node:path'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'

import {
  spawnBiome,
  spawnClangd,
  spawnCommand,
  spawnDotnetTool,
  spawnElixirLs,
  spawnGemTool,
  spawnGoTool,
  spawnJdtls,
  spawnKotlinLs,
  spawnLuaLs,
  spawnNodePackageBin,
  spawnOxlint,
  spawnSourceKit,
  spawnTerraformLs,
  spawnTexlab,
  spawnTinymist,
  spawnRustAnalyzer,
  spawnTy,
  spawnZls,
} from './installers'
import { fileExtension, fileUriForPath } from './language'
import { recordProcessInfo } from '../observability'
import { spawnTypeScript } from './typescript/runtime'

export type LspServerHandle = {
  readonly process: ChildProcessWithoutNullStreams
  readonly initializationOptions?: Readonly<Record<string, unknown>>
}

export type LspServerDefinition = {
  readonly id: string
  readonly extensions: readonly string[]
  /** Registry definitions always provide this; transport-only test definitions need not. */
  readonly features?: LspFeatureRanks
  readonly adoptionMarkers?: readonly string[]
  readonly root: (filePath: string, workspaceRoot: string) => Promise<string | null>
  readonly spawn: (root: string) => Promise<LspServerHandle | null>
  readonly initializationOptions?: (root: string) => Promise<Record<string, unknown> | undefined>
  /** Settings pushed once through `workspace/didChangeConfiguration` after initialization. */
  readonly didChangeConfiguration?: Readonly<Record<string, unknown>>
  /**
   * What this server gets back when it asks `workspace/configuration`.
   *
   * A settings tree, resolved per requested `section` by dotted path. The root
   * is the pooled backend's root, so every tab sharing that backend sees the
   * same answer while servers such as ESLint still receive truthful workspace
   * fields.
   *
   * It exists because the blanket `[{}]` this proxy used to send is not a
   * neutral answer. gopls reads `semanticTokens` out of it, so an empty object
   * meant gopls advertised `semanticTokensProvider: { full: true, range: true }`
   * and then returned **zero** tokens for every file — a capability that is
   * advertised and then answers empty, which is indistinguishable from a boring
   * file. The same request with `{ semanticTokens: true }` returned 3 818.
   */
  readonly configuration?: (root: string) => Readonly<Record<string, unknown>>
}

export type LspServerMatch = {
  readonly root: string
  readonly server: LspServerDefinition
}

/**
 * What the registry needs from settings, resolved by the caller.
 *
 * Passed in rather than read here: the module used to snapshot `process.env` at
 * import, which made the experimental flag a one-way latch no test could clear.
 * A plain value parameter is the property that bug cost us.
 */
export type LspSettings = {
  readonly servers: LspServerOverrides
  readonly languageServers: LspLanguageServerLists
  readonly tyForPython: boolean
}

const serverPriority = ['deno', 'typescript', 'vue', 'eslint', 'oxlint', 'biome'] as const

const jsProjectMarkers = [
  'package-lock.json',
  'bun.lockb',
  'bun.lock',
  'pnpm-lock.yaml',
  'yarn.lock',
  'package.json',
] as const

const tsExtensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'] as const

/** Tool-specific markers keep supplementary linters and formatters opt-in per project. */
const eslintConfigMarkers = ['eslint.config.*', '.eslintrc*'] as const
const biomeConfigMarkers = ['biome.json', 'biome.jsonc'] as const
const oxlintConfigMarkers = ['.oxlintrc.json', '.oxlintrc.jsonc'] as const

const LANGUAGE_SERVER_FEATURES = {
  completion: 0,
  hover: 0,
  navigation: 0,
  signatureHelp: 0,
  diagnostics: 10,
  codeActions: 10,
  formatting: 10,
  rename: 0,
  documentHighlights: 0,
  semanticTokens: 0,
} as const satisfies LspFeatureRanks

const LINTER_FORMATTER_FEATURES = {
  diagnostics: 0,
  codeActions: 0,
  formatting: 0,
} as const satisfies LspFeatureRanks

const LINTER_FORMATTER_SERVER_IDS = new Set(['biome', 'eslint', 'oxlint'])

function eslintConfiguration(root: string): Readonly<Record<string, unknown>> {
  return {
    validate: 'on',
    packageManager: 'npm',
    useESLintClass: false,
    useRealpaths: false,
    experimental: { useFlatConfig: false },
    codeAction: {
      disableRuleComment: {
        enable: true,
        location: 'separateLine',
        commentStyle: 'line',
      },
      showDocumentation: { enable: true },
    },
    codeActionOnSave: { mode: 'all' },
    format: false,
    quiet: false,
    onIgnoredFiles: 'off',
    options: {},
    rulesCustomizations: [],
    run: 'onType',
    problems: { shortenToSingleLine: false },
    nodePath: null,
    workingDirectory: { mode: 'location' },
    workspaceFolder: {
      name: path.basename(root) || root,
      uri: fileUriForPath(root),
    },
  }
}

const lspServers: readonly LspServerDefinition[] = withBuiltInFeatures([
  {
    id: 'astro',
    extensions: ['.astro'],
    root: (filePath, workspaceRoot) => nearestRoot(filePath, workspaceRoot, jsProjectMarkers),
    spawn: (root) =>
      spawnNodePackageBin('@astrojs/language-server', 'astro-ls', ['--stdio'], {
        cwd: root,
      }),
    initializationOptions: async (root) => {
      const tsserver = await findUp(path.resolve(root), root, [
        'node_modules/typescript/lib/tsserver.js',
      ])
      if (!tsserver) return undefined

      return { typescript: { tsdk: path.dirname(tsserver) } }
    },
  },
  {
    id: 'bash',
    extensions: ['.sh', '.bash', '.zsh', '.ksh'],
    root: async (_filePath, workspaceRoot) => workspaceRoot,
    spawn: (root) =>
      spawnNodePackageBin('bash-language-server', 'bash-language-server', ['start'], { cwd: root }),
  },
  {
    id: 'clangd',
    extensions: ['.c', '.cpp', '.cc', '.cxx', '.c++', '.h', '.hpp', '.hh', '.hxx', '.h++'],
    root: (filePath, workspaceRoot) =>
      nearestRoot(filePath, workspaceRoot, [
        'compile_commands.json',
        'compile_flags.txt',
        '.clangd',
        'CMakeLists.txt',
        'Makefile',
      ]),
    spawn: (root) => spawnClangd(root),
  },
  {
    id: 'clojure-lsp',
    extensions: ['.clj', '.cljs', '.cljc', '.edn'],
    root: (filePath, workspaceRoot) =>
      nearestRoot(filePath, workspaceRoot, [
        'deps.edn',
        'project.clj',
        'shadow-cljs.edn',
        'bb.edn',
        'build.boot',
      ]),
    spawn: (root) => spawnCommand(['clojure-lsp', 'listen'], { cwd: root }),
  },
  {
    id: 'csharp',
    extensions: ['.cs'],
    root: (filePath, workspaceRoot) =>
      nearestRoot(filePath, workspaceRoot, ['.slnx', '.sln', '.csproj', 'global.json']),
    spawn: (root) => spawnDotnetTool('csharp-ls', 'csharp-ls', root),
  },
  {
    id: 'css-ls',
    extensions: ['.css'],
    root: async (_filePath, workspaceRoot) => workspaceRoot,
    spawn: (root) =>
      spawnNodePackageBin(
        'vscode-langservers-extracted',
        'vscode-css-language-server',
        ['--stdio'],
        {
          cwd: root,
        },
      ),
    // Same switch as `json-ls`: the server answers `documentFormattingProvider:
    // false` without it. Biome outranks it where a project adopts Biome.
    initializationOptions: async () => ({ provideFormatter: true }),
  },
  {
    id: 'dart',
    extensions: ['.dart'],
    root: (filePath, workspaceRoot) =>
      nearestRoot(filePath, workspaceRoot, ['pubspec.yaml', 'analysis_options.yaml']),
    spawn: (root) => spawnCommand(['dart', 'language-server', '--lsp'], { cwd: root }),
  },
  {
    id: 'deno',
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs'],
    root: (filePath, workspaceRoot) =>
      nearestRoot(filePath, workspaceRoot, ['deno.json', 'deno.jsonc'], {
        fallback: false,
      }),
    spawn: (root) => spawnCommand(['deno', 'lsp'], { cwd: root }),
  },
  {
    id: 'dockerfile',
    extensions: ['.dockerfile', 'Dockerfile'],
    root: async (_filePath, workspaceRoot) => workspaceRoot,
    spawn: (root) =>
      spawnNodePackageBin('dockerfile-language-server-nodejs', 'docker-langserver', ['--stdio'], {
        cwd: root,
      }),
  },
  {
    id: 'elixir-ls',
    extensions: ['.ex', '.exs'],
    root: (filePath, workspaceRoot) =>
      nearestRoot(filePath, workspaceRoot, ['mix.exs', 'mix.lock']),
    spawn: (root) => spawnElixirLs(root),
  },
  {
    id: 'eslint',
    extensions: Array.from<string>(tsExtensions).concat('.vue'),
    adoptionMarkers: eslintConfigMarkers,
    root: (filePath, workspaceRoot) => nearestRoot(filePath, workspaceRoot, jsProjectMarkers),
    spawn: (root) =>
      spawnNodePackageBin(
        'vscode-langservers-extracted',
        'vscode-eslint-language-server',
        ['--stdio'],
        {
          cwd: root,
        },
      ),
    configuration: eslintConfiguration,
  },
  {
    id: 'fsharp',
    extensions: ['.fs', '.fsi', '.fsx', '.fsscript'],
    root: (filePath, workspaceRoot) =>
      nearestRoot(filePath, workspaceRoot, ['.slnx', '.sln', '.fsproj', 'global.json']),
    spawn: (root) => spawnDotnetTool('fsautocomplete', 'fsautocomplete', root),
  },
  {
    id: 'gleam',
    extensions: ['.gleam'],
    root: (filePath, workspaceRoot) => nearestRoot(filePath, workspaceRoot, ['gleam.toml']),
    spawn: (root) => spawnCommand(['gleam', 'lsp'], { cwd: root }),
  },
  {
    id: 'gopls',
    extensions: ['.go'],
    root: async (filePath, workspaceRoot) =>
      (await nearestRoot(filePath, workspaceRoot, ['go.work'], {
        fallback: false,
      })) ?? nearestRoot(filePath, workspaceRoot, ['go.mod', 'go.sum']),
    spawn: (root) => spawnGoTool('gopls', 'golang.org/x/tools/gopls@latest', root),
    // gopls asks under its own section name and reads `semanticTokens` from the
    // answer. Measured on v0.21.0 against `net/http/request.go` (50.4 KB): with
    // the old blanket `[{}]`, 0 tokens for both `full` and `range`; with this,
    // 3 818.
    configuration: () => ({ gopls: { semanticTokens: true } }),
  },
  {
    id: 'haskell-language-server',
    extensions: ['.hs', '.lhs'],
    root: (filePath, workspaceRoot) =>
      nearestRoot(filePath, workspaceRoot, ['stack.yaml', 'cabal.project', 'hie.yaml', '*.cabal']),
    spawn: (root) => spawnCommand(['haskell-language-server-wrapper', '--lsp'], { cwd: root }),
  },
  {
    id: 'html-ls',
    extensions: ['.html', '.htm'],
    root: async (_filePath, workspaceRoot) => workspaceRoot,
    spawn: (root) =>
      spawnNodePackageBin(
        'vscode-langservers-extracted',
        'vscode-html-language-server',
        ['--stdio'],
        {
          cwd: root,
        },
      ),
    initializationOptions: async () => ({ provideFormatter: true }),
  },
  {
    id: 'jdtls',
    extensions: ['.java'],
    root: (filePath, workspaceRoot) =>
      nearestRoot(filePath, workspaceRoot, [
        'pom.xml',
        'build.gradle',
        'build.gradle.kts',
        '.project',
        '.classpath',
        'settings.gradle',
        'settings.gradle.kts',
        'gradlew',
        'gradlew.bat',
      ]),
    spawn: (root) => spawnJdtls(root),
  },
  {
    id: 'json-ls',
    extensions: ['.json', '.jsonc'],
    root: async (_filePath, workspaceRoot) => workspaceRoot,
    spawn: (root) =>
      spawnNodePackageBin(
        'vscode-langservers-extracted',
        'vscode-json-language-server',
        ['--stdio'],
        {
          cwd: root,
        },
      ),
    // Without this, 4.10.0 disables formatting; Biome still outranks it where adopted.
    initializationOptions: async () => ({ provideFormatter: true }),
    // json-ls disables diagnostics when this notification omits `validate.enable`.
    didChangeConfiguration: {
      json: {
        jsonFoldingLimit: 5000,
        jsoncFoldingLimit: 5000,
        resultLimit: 5000,
        validate: { enable: true },
      },
    },
  },
  {
    id: 'julials',
    extensions: ['.jl'],
    root: (filePath, workspaceRoot) =>
      nearestRoot(filePath, workspaceRoot, ['Project.toml', 'Manifest.toml', '*.jl']),
    spawn: (root) =>
      spawnCommand(
        [
          'julia',
          '--startup-file=no',
          '--history-file=no',
          '-e',
          'using LanguageServer; runserver()',
        ],
        {
          cwd: root,
        },
      ),
  },
  {
    id: 'kotlin-ls',
    extensions: ['.kt', '.kts'],
    root: (filePath, workspaceRoot) =>
      nearestRoot(filePath, workspaceRoot, [
        'settings.gradle.kts',
        'settings.gradle',
        'gradlew',
        'gradlew.bat',
        'build.gradle.kts',
        'build.gradle',
        'pom.xml',
      ]),
    spawn: (root) => spawnKotlinLs(root),
  },
  {
    id: 'lua-ls',
    extensions: ['.lua'],
    root: (filePath, workspaceRoot) =>
      nearestRoot(filePath, workspaceRoot, [
        '.luarc.json',
        '.luarc.jsonc',
        '.luacheckrc',
        '.stylua.toml',
        'stylua.toml',
        'selene.toml',
        'selene.yml',
      ]),
    spawn: (root) => spawnLuaLs(root),
  },
  {
    id: 'nixd',
    extensions: ['.nix'],
    root: async (filePath, workspaceRoot) =>
      (await nearestRoot(filePath, workspaceRoot, ['flake.nix'], {
        fallback: false,
      })) ?? workspaceRoot,
    spawn: (root) => spawnCommand(['nixd'], { cwd: root }),
  },
  {
    id: 'ocaml-lsp',
    extensions: ['.ml', '.mli'],
    root: (filePath, workspaceRoot) =>
      nearestRoot(filePath, workspaceRoot, ['dune-project', 'dune-workspace', '.merlin', 'opam']),
    spawn: (root) => spawnCommand(['ocamllsp'], { cwd: root }),
  },
  {
    id: 'oxlint',
    extensions: Array.from<string>(tsExtensions).concat('.vue', '.astro', '.svelte'),
    adoptionMarkers: oxlintConfigMarkers,
    root: (filePath, workspaceRoot) => nearestRoot(filePath, workspaceRoot, jsProjectMarkers),
    spawn: (root) => spawnOxlint(root),
  },
  {
    id: 'biome',
    extensions: [
      ...tsExtensions,
      '.json',
      '.jsonc',
      '.vue',
      '.astro',
      '.svelte',
      '.css',
      '.graphql',
      '.gql',
      '.html',
    ],
    adoptionMarkers: biomeConfigMarkers,
    root: (filePath, workspaceRoot) => nearestRoot(filePath, workspaceRoot, jsProjectMarkers),
    spawn: (root) => spawnBiome(root),
  },
  {
    id: 'php intelephense',
    extensions: ['.php'],
    root: (filePath, workspaceRoot) =>
      nearestRoot(filePath, workspaceRoot, ['composer.json', 'composer.lock', '.php-version']),
    spawn: (root) =>
      spawnNodePackageBin('intelephense', 'intelephense', ['--stdio'], {
        cwd: root,
      }),
    initializationOptions: async () => ({ telemetry: { enabled: false } }),
  },
  {
    id: 'prisma',
    extensions: ['.prisma'],
    root: (filePath, workspaceRoot) =>
      nearestRoot(filePath, workspaceRoot, ['schema.prisma', 'prisma/schema.prisma', 'prisma'], {
        exclude: ['package.json'],
      }),
    spawn: (root) => spawnCommand(['prisma', 'language-server'], { cwd: root }),
  },
  {
    id: 'pyright',
    extensions: ['.py', '.pyi'],
    root: (filePath, workspaceRoot) =>
      nearestRoot(filePath, workspaceRoot, [
        'pyproject.toml',
        'setup.py',
        'setup.cfg',
        'requirements.txt',
        'Pipfile',
        'pyrightconfig.json',
      ]),
    spawn: (root) =>
      spawnNodePackageBin('pyright', 'pyright-langserver', ['--stdio'], {
        cwd: root,
      }),
    initializationOptions: pythonInitializationOptions,
  },
  {
    id: 'ruby-lsp',
    extensions: ['.rb', '.rake', '.gemspec', '.ru'],
    root: (filePath, workspaceRoot) => nearestRoot(filePath, workspaceRoot, ['Gemfile']),
    spawn: (root) => spawnGemTool('rubocop', 'rubocop', ['--lsp'], root),
  },
  {
    id: 'rust',
    extensions: ['.rs'],
    root: (filePath, workspaceRoot) =>
      nearestRoot(filePath, workspaceRoot, ['Cargo.toml', 'Cargo.lock']),
    spawn: (root) => spawnRustAnalyzer(root),
  },
  {
    id: 'sourcekit-lsp',
    extensions: ['.swift', '.objc', '.objcpp'],
    root: (filePath, workspaceRoot) =>
      nearestRoot(filePath, workspaceRoot, ['Package.swift', '*.xcodeproj', '*.xcworkspace']),
    spawn: (root) => spawnSourceKit(root),
  },
  {
    id: 'svelte',
    extensions: ['.svelte'],
    root: (filePath, workspaceRoot) => nearestRoot(filePath, workspaceRoot, jsProjectMarkers),
    spawn: (root) =>
      spawnNodePackageBin('svelte-language-server', 'svelteserver', ['--stdio'], { cwd: root }),
    initializationOptions: async () => ({}),
  },
  {
    id: 'terraform',
    extensions: ['.tf', '.tfvars'],
    root: (filePath, workspaceRoot) =>
      nearestRoot(filePath, workspaceRoot, ['.terraform.lock.hcl', 'terraform.tfstate', '*.tf']),
    spawn: (root) => spawnTerraformLs(root),
    initializationOptions: async () => ({
      experimentalFeatures: {
        prefillRequiredFields: true,
        validateOnSave: true,
      },
    }),
  },
  {
    id: 'texlab',
    extensions: ['.tex', '.bib'],
    root: (filePath, workspaceRoot) =>
      nearestRoot(filePath, workspaceRoot, [
        '.latexmkrc',
        'latexmkrc',
        '.texlabroot',
        'texlabroot',
      ]),
    spawn: (root) => spawnTexlab(root),
  },
  {
    id: 'tinymist',
    extensions: ['.typ', '.typc'],
    root: (filePath, workspaceRoot) => nearestRoot(filePath, workspaceRoot, ['typst.toml']),
    spawn: (root) => spawnTinymist(root),
  },
  {
    id: 'ty',
    extensions: ['.py', '.pyi'],
    root: (filePath, workspaceRoot) =>
      nearestRoot(filePath, workspaceRoot, [
        'pyproject.toml',
        'ty.toml',
        'setup.py',
        'setup.cfg',
        'requirements.txt',
        'Pipfile',
        'pyrightconfig.json',
      ]),
    spawn: (root) => spawnTy(root),
    initializationOptions: pythonInitializationOptions,
  },
  {
    id: 'typescript',
    extensions: tsExtensions,
    root: (filePath, workspaceRoot) =>
      nearestRoot(filePath, workspaceRoot, jsProjectMarkers, {
        exclude: ['deno.json', 'deno.jsonc'],
      }),
    spawn: spawnTypeScript,
  },
  {
    id: 'vue',
    extensions: ['.vue'],
    root: (filePath, workspaceRoot) => nearestRoot(filePath, workspaceRoot, jsProjectMarkers),
    spawn: (root) =>
      spawnNodePackageBin('@vue/language-server', 'vue-language-server', ['--stdio'], {
        cwd: root,
      }),
    initializationOptions: async () => ({}),
  },
  {
    id: 'yaml-ls',
    extensions: ['.yaml', '.yml'],
    root: async (_filePath, workspaceRoot) => workspaceRoot,
    spawn: (root) =>
      spawnNodePackageBin('yaml-language-server', 'yaml-language-server', ['--stdio'], {
        cwd: root,
      }),
  },
  {
    id: 'zls',
    extensions: ['.zig', '.zon'],
    root: (filePath, workspaceRoot) => nearestRoot(filePath, workspaceRoot, ['build.zig']),
    spawn: (root) => spawnZls(root),
  },
])

export async function matchLspServers(input: {
  filePath: string
  settings: LspSettings
  workspaceRoot: string
}): Promise<readonly LspServerMatch[]> {
  const extension = fileExtension(input.filePath)
  const { considered, eligible, explicitlySelected } = eligibleLspServers(input.settings, extension)
  const matches = await Promise.all(
    eligible.map((server) =>
      resolveServerRoot(
        server,
        input.filePath,
        input.workspaceRoot,
        explicitlySelected.has(server.id),
      ),
    ),
  )
  const resolved = matches.filter((match): match is LspServerMatch => match !== null)

  // Preserve each eligibility stage so a missing tool is explainable from one event.
  recordProcessInfo('lsp.match', {
    area: 'lsp',
    operation: 'match',
    extension,
    considered: considered.map((server) => server.id),
    eligible: eligible.map((server) => server.id),
    matched: resolved.map((match) => match.server.id),
    outcome: resolved.length > 0 ? 'matched' : 'none',
    workspaceRoot: input.workspaceRoot,
  })

  return resolved
}

export async function resolveLspServer(input: {
  filePath: string
  serverId: string
  settings: LspSettings
  workspaceRoot: string
}): Promise<LspServerMatch | null> {
  // A stale socket must not reopen a server the match route has filtered out.
  const { eligible, explicitlySelected } = eligibleLspServers(
    input.settings,
    fileExtension(input.filePath),
  )
  const server = eligible.find((candidate) => candidate.id === input.serverId)
  if (!server) return null

  return resolveServerRoot(
    server,
    input.filePath,
    input.workspaceRoot,
    explicitlySelected.has(server.id),
  )
}

export function matchDescriptor(match: LspServerMatch) {
  return {
    root: match.root,
    serverId: match.server.id,
    features: match.server.features ?? {},
  }
}

export function bestLspMatchForFeature(
  matches: readonly LspServerMatch[],
  feature: LspFeatureId,
): LspServerMatch | null {
  return (
    matches
      .filter((match) => match.server.features?.[feature] !== undefined)
      .toSorted((left, right) => compareFeatureRank(left, right, feature))[0] ?? null
  )
}

async function resolveServerRoot(
  server: LspServerDefinition,
  filePath: string,
  workspaceRoot: string,
  explicitlySelected = false,
): Promise<LspServerMatch | null> {
  if (!explicitlySelected && !(await serverIsAdopted(server, filePath, workspaceRoot))) return null

  const root = await server.root(filePath, workspaceRoot)
  if (!root) return null

  return { root, server }
}

/** Stands for every server the extension matched that the list does not name. */
const REST_SERVERS_ENTRY = '...'

/** Keeps match discovery and explicit websocket resolution on one eligibility policy. */
function eligibleLspServers(settings: LspSettings, extension: string) {
  const considered = lspServersFor(settings)
    .filter((server) => serverMatches(server, extension))
    .sort(compareServerPriority)
  const list = serverListFor(settings.languageServers, extension)

  return {
    considered,
    eligible: applyServerList(considered, list),
    explicitlySelected: explicitlySelectedServerIds(list),
  }
}

function explicitlySelectedServerIds(list: readonly string[] | undefined): ReadonlySet<string> {
  if (!list) return new Set()

  return new Set(list.filter((entry) => entry !== REST_SERVERS_ENTRY && !entry.startsWith('!')))
}

async function serverIsAdopted(
  server: LspServerDefinition,
  filePath: string,
  workspaceRoot: string,
): Promise<boolean> {
  if (!server.adoptionMarkers) return true

  return Boolean(await findUp(path.dirname(filePath), workspaceRoot, server.adoptionMarkers))
}

function serverListFor(lists: LspLanguageServerLists, extension: string) {
  const key = Object.keys(lists).find((candidate) => equalsIgnoreCase(candidate, extension))
  return key === undefined ? undefined : lists[key]
}

/** Named ids order, `!id` removes, and `...` retains every other matched server. */
function applyServerList(
  matched: readonly LspServerDefinition[],
  list: readonly string[] | undefined,
): readonly LspServerDefinition[] {
  if (!list) return matched

  // Deduplicate ids before they become lanes and collide in per-server state.
  const named = new Set(
    list.filter((entry) => entry !== REST_SERVERS_ENTRY && !entry.startsWith('!')),
  )
  const removed = new Set(
    list.filter((entry) => entry.startsWith('!')).map((entry) => entry.slice(1)),
  )
  const ordered = Array.from(named)
    .map((id) => matched.find((server) => server.id === id))
    .filter((server): server is LspServerDefinition => server !== undefined)
  const rest = list.includes(REST_SERVERS_ENTRY)
    ? matched.filter((server) => !named.has(server.id))
    : []

  return ordered.concat(rest).filter((server) => !removed.has(server.id))
}

function equalsIgnoreCase(left: string, right: string) {
  return left.localeCompare(right, undefined, { sensitivity: 'accent' }) === 0
}

export function lspServersFor(settings: LspSettings) {
  const base = experimentalFilteredServers(settings.tyForPython)
  const overrides = Object.entries(settings.servers)
  if (overrides.length === 0) return base

  const servers = new Map(base.map((server) => [server.id, server]))
  for (const [id, config] of overrides) {
    if (config.disabled) {
      servers.delete(id)
      continue
    }

    const existing = servers.get(id)
    if (!config.command && !existing) continue

    servers.set(id, configuredServer(id, config, existing))
  }

  return Array.from(servers.values())
}

function experimentalFilteredServers(tyForPython: boolean) {
  if (tyForPython) return lspServers.filter((server) => server.id !== 'pyright')

  return lspServers.filter((server) => server.id !== 'ty')
}

async function nearestRoot(
  filePath: string,
  workspaceRoot: string,
  markers: readonly string[],
  options: {
    readonly exclude?: readonly string[]
    readonly fallback?: boolean
  } = {},
) {
  const excluded = await findUp(path.dirname(filePath), workspaceRoot, options.exclude ?? [])
  if (excluded) return null

  const marker = await findUp(path.dirname(filePath), workspaceRoot, markers)
  if (marker) return path.dirname(marker)
  if (options.fallback === false) return null

  return workspaceRoot
}

async function findUp(start: string, stop: string, markers: readonly string[]) {
  if (markers.length === 0) return null

  let current = path.resolve(start)
  const root = path.resolve(stop)
  while (isInsideOrEqual(root, current)) {
    const match = await firstExistingMarker(current, markers)
    if (match) return match
    if (current === root) return null

    current = path.dirname(current)
  }

  return null
}

async function firstExistingMarker(directory: string, markers: readonly string[]) {
  for (const marker of markers) {
    const candidate = await existingMarker(directory, marker)
    if (!candidate) continue

    return candidate
  }

  return null
}

async function existingMarker(directory: string, marker: string) {
  if (!marker.includes('*')) {
    const candidate = path.join(directory, marker)
    return (await exists(candidate)) ? candidate : null
  }

  const matcher = globMarkerRegex(marker)
  const entries = await readdir(directory).catch(() => [])
  const match = entries.find((entry) => matcher.test(entry))
  return match ? path.join(directory, match) : null
}

function configuredServer(
  id: string,
  config: LspServerOverride,
  existing: LspServerDefinition | undefined,
): LspServerDefinition {
  const command = config.command
  if (!command) {
    return {
      ...existing!,
      extensions: config.extensions ?? existing!.extensions,
      features: configuredFeatures(config, existing!.features),
      initializationOptions: configuredInitialization(config, existing),
    }
  }

  return {
    id,
    extensions: config.extensions ?? existing?.extensions ?? [],
    features: configuredFeatures(config, existing?.features ?? LANGUAGE_SERVER_FEATURES),
    adoptionMarkers: existing?.adoptionMarkers,
    root: existing?.root ?? (async (_filePath, workspaceRoot) => workspaceRoot),
    spawn: (root) =>
      spawnCommand(command, {
        cwd: root,
        env: {
          ...process.env,
          ...config.env,
        },
      }),
    initializationOptions: configuredInitialization(config, existing),
    // A binary override retains the built-in server's protocol configuration.
    configuration: existing?.configuration,
    didChangeConfiguration: existing?.didChangeConfiguration,
  }
}

function configuredInitialization(
  config: LspServerOverride,
  existing: LspServerDefinition | undefined,
) {
  if (!config.initialization) return existing?.initializationOptions

  return async () => config.initialization
}

function configuredFeatures(
  config: LspServerOverride,
  inherited: LspFeatureRanks | undefined,
): LspFeatureRanks {
  const features: Partial<Record<LspFeatureId, number>> = { ...inherited }
  for (const [feature, rank] of Object.entries(config.features ?? {}) as [
    LspFeatureId,
    number | null,
  ][]) {
    if (rank === null) {
      delete features[feature]
      continue
    }

    features[feature] = rank
  }

  return features
}

function withBuiltInFeatures(
  servers: readonly Omit<LspServerDefinition, 'features'>[],
): readonly LspServerDefinition[] {
  return servers.map((server) => ({
    ...server,
    features: LINTER_FORMATTER_SERVER_IDS.has(server.id)
      ? LINTER_FORMATTER_FEATURES
      : LANGUAGE_SERVER_FEATURES,
  }))
}

async function pythonInitializationOptions(root: string) {
  const pythonPath = await firstExistingPath(
    virtualEnvironmentPaths(root).map((venvPath) =>
      process.platform === 'win32'
        ? path.join(venvPath, 'Scripts', 'python.exe')
        : path.join(venvPath, 'bin', 'python'),
    ),
  )
  if (!pythonPath) return undefined

  return { pythonPath }
}

function serverMatches(server: LspServerDefinition, extension: string) {
  return server.extensions.includes(extension)
}

function compareServerPriority(left: LspServerDefinition, right: LspServerDefinition) {
  return (
    serverPriorityIndex(left.id) - serverPriorityIndex(right.id) || left.id.localeCompare(right.id)
  )
}

function compareFeatureRank(left: LspServerMatch, right: LspServerMatch, feature: LspFeatureId) {
  const rank = (left.server.features?.[feature] ?? 0) - (right.server.features?.[feature] ?? 0)
  return rank || compareServerPriority(left.server, right.server)
}

function serverPriorityIndex(id: string) {
  const index = serverPriority.indexOf(id as (typeof serverPriority)[number])
  return index === -1 ? serverPriority.length : index
}

async function firstExistingPath(candidates: readonly string[]) {
  for (const candidate of candidates) {
    if (!(await exists(candidate))) continue

    return candidate
  }

  return null
}

async function exists(candidate: string) {
  try {
    await access(candidate)
    return true
  } catch {
    return false
  }
}

function virtualEnvironmentPaths(root: string) {
  return [process.env.VIRTUAL_ENV, path.join(root, '.venv'), path.join(root, 'venv')].filter(
    (item): item is string => Boolean(item),
  )
}

function isInsideOrEqual(root: string, candidate: string) {
  const relative = path.relative(root, candidate)
  if (relative === '') return true
  if (relative.startsWith('..')) return false

  return !path.isAbsolute(relative)
}

function globMarkerRegex(marker: string) {
  const escaped = marker.replace(/[.+?^${}()|[\]\\]/gu, '\\$&')
  // The escape pass leaves `*` bare; replacing `\*` produces an invalid glob regex.
  return new RegExp(`^${escaped.replaceAll('*', '.*')}$`, 'u')
}
