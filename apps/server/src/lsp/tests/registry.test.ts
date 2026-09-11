import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { pinnedLspRuntimeManifest, type PinnedLspRuntimeManifestEntry } from '../installer-manifest'
import {
  bestLspMatchForFeature,
  lspServersFor,
  matchLspServers,
  resolveLspServer,
} from '../registry'

const NO_OVERRIDES = { servers: {}, languageServers: {}, tyForPython: false } as const

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('LSP server registry', () => {
  it('exposes the full built-in server set', () => {
    const ids = lspServersFor(NO_OVERRIDES)
      .map((server) => server.id)
      .toSorted()

    expect(ids).toEqual(
      [
        'astro',
        'bash',
        'biome',
        'clangd',
        'clojure-lsp',
        'csharp',
        'css-ls',
        'dart',
        'deno',
        'dockerfile',
        'elixir-ls',
        'eslint',
        'fsharp',
        'gleam',
        'gopls',
        'haskell-language-server',
        'html-ls',
        'jdtls',
        'json-ls',
        'julials',
        'kotlin-ls',
        'lua-ls',
        'nixd',
        'ocaml-lsp',
        'oxlint',
        'php intelephense',
        'prisma',
        'pyright',
        'ruby-lsp',
        'rust',
        'sourcekit-lsp',
        'svelte',
        'terraform',
        'texlab',
        'tinymist',
        'typescript',
        'vue',
        'yaml-ls',
        'zls',
      ].toSorted(),
    )
  })

  it('bounds json-ls computed items without disabling validation', () => {
    const json = lspServersFor(NO_OVERRIDES).find((server) => server.id === 'json-ls')
    const overridden = lspServersFor({
      servers: { 'json-ls': { command: ['custom-json-ls'], disabled: false } },
      languageServers: {},
      tyForPython: false,
    }).find((server) => server.id === 'json-ls')
    const expected = {
      json: {
        jsonFoldingLimit: 5000,
        jsoncFoldingLimit: 5000,
        resultLimit: 5000,
        validate: { enable: true },
      },
    }

    expect(json?.didChangeConfiguration).toEqual(expected)
    expect(overridden?.didChangeConfiguration).toEqual(expected)
  })

  it('gives ESLint a complete root-aware workspace configuration', () => {
    const root = '/workspace/packages/app'
    const eslint = lspServersFor(NO_OVERRIDES).find((server) => server.id === 'eslint')

    expect(eslint?.configuration?.(root)).toEqual({
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
        name: 'app',
        uri: 'file:///workspace/packages/app',
      },
    })
  })

  it('switches python support to ty when enabled', () => {
    const ids = lspServersFor({ servers: {}, languageServers: {}, tyForPython: true }).map(
      (server) => server.id,
    )

    expect(ids).toContain('ty')
    expect(ids).not.toContain('pyright')
  })

  it('matches TypeScript files to the nearest package root', async () => {
    const root = await fixtureRoot({
      'package.json': '{}',
      'src/index.ts': 'export const value = 1\n',
    })

    const matches = await matchLspServers({
      settings: NO_OVERRIDES,
      filePath: path.join(root, 'src/index.ts'),
      workspaceRoot: root,
    })

    expect(matches.map((match) => match.server.id)).toEqual(['typescript'])
    expect(matches.every((match) => match.root === root)).toBe(true)
  })

  it('detects a package root whose name begins with two dots', async () => {
    const root = await fixtureRoot({
      '..foo/package.json': '{}',
      '..foo/index.ts': 'export const value = 1\n',
    })

    const matches = await matchLspServers({
      settings: NO_OVERRIDES,
      filePath: path.join(root, '..foo/index.ts'),
      workspaceRoot: root,
    })

    expect(matches).toContainEqual(expect.objectContaining({ root: path.join(root, '..foo') }))
  })

  it('prefers deno for TypeScript files inside a Deno project', async () => {
    const root = await fixtureRoot({
      'deno.json': '{}',
      'src/index.ts': 'export const value = 1\n',
    })

    const matches = await matchLspServers({
      settings: NO_OVERRIDES,
      filePath: path.join(root, 'src/index.ts'),
      workspaceRoot: root,
    })

    expect(matches[0]).toMatchObject({
      root,
      server: { id: 'deno' },
    })
  })

  it('returns null for unknown file extensions', async () => {
    const root = await fixtureRoot({
      'notes.custom': 'custom\n',
    })

    const matches = await matchLspServers({
      settings: NO_OVERRIDES,
      filePath: path.join(root, 'notes.custom'),
      workspaceRoot: root,
    })

    expect(matches).toEqual([])
  })

  it('orders feature owners by rank, then server priority and id', async () => {
    const root = await fixtureRoot({
      '.oxlintrc.json': '{}',
      'biome.json': '{}',
      'eslint.config.js': 'export default []\n',
      'package.json': '{}',
      'src/index.ts': 'export const value = 1\n',
    })
    const matches = await matchLspServers({
      settings: NO_OVERRIDES,
      filePath: path.join(root, 'src/index.ts'),
      workspaceRoot: root,
    })

    expect(bestLspMatchForFeature(matches, 'completion')?.server.id).toBe('typescript')
    expect(bestLspMatchForFeature(matches, 'diagnostics')?.server.id).toBe('eslint')
    expect(bestLspMatchForFeature(matches, 'formatting')?.server.id).toBe('eslint')
  })

  it('applies numeric feature ranks and null exclusions', () => {
    const servers = lspServersFor({
      servers: {
        typescript: { disabled: false, features: { completion: 5, semanticTokens: null } },
      },
      languageServers: {},
      tyForPython: false,
    })
    const typescript = servers.find((server) => server.id === 'typescript')

    expect(typescript?.features?.completion).toBe(5)
    expect(typescript?.features?.semanticTokens).toBeUndefined()
  })

  it('resolves only the requested eligible server for explicit transport', async () => {
    const root = await fixtureRoot({
      'biome.json': '{}',
      'package.json': '{}',
      'src/index.ts': 'export const value = 1\n',
    })

    const match = await resolveLspServer({
      settings: NO_OVERRIDES,
      filePath: path.join(root, 'src/index.ts'),
      serverId: 'biome',
      workspaceRoot: root,
    })
    const unknown = await resolveLspServer({
      settings: NO_OVERRIDES,
      filePath: path.join(root, 'src/index.ts'),
      serverId: 'unknown',
      workspaceRoot: root,
    })

    expect(match?.server.id).toBe('biome')
    expect(unknown).toBeNull()
  })

  it('keeps Biome eligible for JSON and JSONC', async () => {
    const root = await fixtureRoot({
      'biome.json': '{}',
      'data.json': '{}',
      'data.jsonc': '{}',
    })

    for (const file of ['data.json', 'data.jsonc']) {
      const matches = await matchLspServers({
        settings: NO_OVERRIDES,
        filePath: path.join(root, file),
        workspaceRoot: root,
      })
      expect(matches.map((match) => match.server.id)).toContain('biome')
    }
  })

  it('serves JSON with the JSON server even where no tool is adopted', async () => {
    const root = await fixtureRoot({
      'data.json': '{}',
      'data.jsonc': '{}',
    })

    for (const file of ['data.json', 'data.jsonc']) {
      const matches = await matchLspServers({
        settings: NO_OVERRIDES,
        filePath: path.join(root, file),
        workspaceRoot: root,
      })
      expect(matches.map((match) => match.server.id)).toEqual(['json-ls'])
    }
  })

  it('matches a glob marker instead of throwing the whole match away', async () => {
    const root = await fixtureRoot({
      'app.cabal': 'name: app\n',
      'src/Main.hs': 'main = pure ()\n',
    })

    // `*.cabal` used to compile to `/^*\.cabal$/u` — a SyntaxError that
    // `resolveLspRouteMatches` swallowed, so a Haskell file matched nothing.
    expect(await serverIdsFor(root, 'src/Main.hs')).toEqual(['haskell-language-server'])
  })

  it('keeps a language server for the file types only Biome used to claim', async () => {
    const root = await fixtureRoot({
      'index.html': '<div></div>\n',
      'package.json': '{}',
      'styles.css': 'body { color: red }\n',
    })

    // Gating Biome must not leave a language with nothing: these are the
    // extensions Biome was the sole registry entry for.
    expect(await serverIdsFor(root, 'styles.css')).toEqual(['css-ls'])
    expect(await serverIdsFor(root, 'index.html')).toEqual(['html-ls'])
  })

  it('routes JSON features across JSON LS and an adopted Biome lane', async () => {
    const root = await fixtureRoot({
      'biome.json': '{}',
      'data.json': '{}',
      'data.jsonc': '{}',
    })

    for (const relativePath of ['data.json', 'data.jsonc']) {
      const matches = await matchLspServers({
        settings: NO_OVERRIDES,
        filePath: path.join(root, relativePath),
        workspaceRoot: root,
      })
      const ids = matches.map((match) => match.server.id)

      expect(ids).toEqual(expect.arrayContaining(['biome', 'json-ls']))
      expect(bestLspMatchForFeature(matches, 'completion')?.server.id).toBe('json-ls')
      expect(bestLspMatchForFeature(matches, 'hover')?.server.id).toBe('json-ls')
      expect(bestLspMatchForFeature(matches, 'formatting')?.server.id).toBe('biome')
    }
  })

  it('starts a linter or formatter only in a project that adopted it', async () => {
    const bare = await fixtureRoot({
      'package.json': '{}',
      'src/index.ts': 'export const value = 1\n',
    })
    const adopted = await fixtureRoot({
      '.oxlintrc.json': '{}',
      'biome.json': '{}',
      'eslint.config.mjs': 'export default []\n',
      'package.json': '{}',
      'src/index.ts': 'export const value = 1\n',
    })

    const bareIds = await serverIdsFor(bare, 'src/index.ts')
    const adoptedIds = await serverIdsFor(adopted, 'src/index.ts')

    expect(bareIds).not.toContain('eslint')
    expect(bareIds).not.toContain('oxlint')
    expect(bareIds).not.toContain('biome')
    expect(adoptedIds).toEqual(expect.arrayContaining(['eslint', 'oxlint', 'biome']))
  })

  it('lets an explicit server list opt a matching tool in without its marker', async () => {
    const root = await fixtureRoot({
      'package.json': '{}',
      'src/index.ts': 'export const value = 1\n',
    })
    const settings = {
      servers: {},
      languageServers: { '.ts': ['eslint', '...'] },
      tyForPython: false,
    } as const
    const matches = await matchLspServers({
      settings,
      filePath: path.join(root, 'src/index.ts'),
      workspaceRoot: root,
    })
    const explicit = await resolveLspServer({
      settings,
      filePath: path.join(root, 'src/index.ts'),
      serverId: 'eslint',
      workspaceRoot: root,
    })

    expect(matches.map((match) => match.server.id)).toEqual(['eslint', 'typescript'])
    expect(explicit).toMatchObject({ root, server: { id: 'eslint' } })
  })

  it("finds the adoption marker in an ancestor, not just the file's own directory", async () => {
    const root = await fixtureRoot({
      '.eslintrc.json': '{}',
      'package.json': '{}',
      'packages/app/src/index.ts': 'export const value = 1\n',
    })

    expect(await serverIdsFor(root, 'packages/app/src/index.ts')).toContain('eslint')
  })

  it('drops a server for one extension through the language-server list', async () => {
    const root = await fixtureRoot({
      'biome.json': '{}',
      'data.json': '{}',
      'src/index.ts': 'export const value = 1\n',
    })
    const settings = {
      servers: {},
      languageServers: { '.json': ['...', '!biome'] },
      tyForPython: false,
    } as const

    const json = await matchLspServers({
      settings,
      filePath: path.join(root, 'data.json'),
      workspaceRoot: root,
    })
    const typescript = await matchLspServers({
      settings,
      filePath: path.join(root, 'src/index.ts'),
      workspaceRoot: root,
    })

    expect(json.map((match) => match.server.id)).toEqual(['json-ls'])
    // The list answers for `.json` only: Biome keeps every other extension.
    expect(typescript.map((match) => match.server.id)).toContain('biome')
  })

  it('keeps only the listed servers when the list omits the rest entry', async () => {
    const root = await fixtureRoot({
      'biome.json': '{}',
      'data.json': '{}',
    })

    const matches = await matchLspServers({
      settings: { servers: {}, languageServers: { '.json': ['biome'] }, tyForPython: false },
      filePath: path.join(root, 'data.json'),
      workspaceRoot: root,
    })

    expect(matches.map((match) => match.server.id)).toEqual(['biome'])
  })

  it('disables every server when the configured list is empty', async () => {
    const root = await fixtureRoot({ 'data.json': '{}' })
    const matches = await matchLspServers({
      settings: { servers: {}, languageServers: { '.json': [] }, tyForPython: false },
      filePath: path.join(root, 'data.json'),
      workspaceRoot: root,
    })

    expect(matches).toEqual([])
  })

  it('cannot start a server the file never matched', async () => {
    const root = await fixtureRoot({
      'data.json': '{}',
    })

    const matches = await matchLspServers({
      settings: { servers: {}, languageServers: { '.json': ['gopls', '...'] }, tyForPython: false },
      filePath: path.join(root, 'data.json'),
      workspaceRoot: root,
    })

    expect(matches.map((match) => match.server.id)).toEqual(['json-ls'])
  })

  it('opens one lane for a server the list names twice', async () => {
    const root = await fixtureRoot({
      'biome.json': '{}',
      'data.json': '{}',
    })

    const matches = await matchLspServers({
      settings: {
        servers: {},
        languageServers: { '.json': ['biome', 'biome', 'json-ls'] },
        tyForPython: false,
      },
      filePath: path.join(root, 'data.json'),
      workspaceRoot: root,
    })

    expect(matches.map((match) => match.server.id)).toEqual(['biome', 'json-ls'])
  })

  it('refuses an explicit transport for a server the list removed', async () => {
    const root = await fixtureRoot({
      'biome.json': '{}',
      'data.json': '{}',
    })

    const match = await resolveLspServer({
      settings: {
        servers: {},
        languageServers: { '.json': ['...', '!biome'] },
        tyForPython: false,
      },
      filePath: path.join(root, 'data.json'),
      serverId: 'biome',
      workspaceRoot: root,
    })

    expect(match).toBeNull()
  })

  it('applies per-server overrides from settings', () => {
    const servers = lspServersFor({
      servers: {
        'custom-lsp': {
          command: ['custom-lsp-server', '--stdio'],
          disabled: false,
          extensions: ['.custom'],
        },
        typescript: { disabled: true },
      },
      languageServers: {},
      tyForPython: false,
    })

    expect(servers.some((server) => server.id === 'typescript')).toBe(false)
    expect(servers).toContainEqual(
      expect.objectContaining({
        extensions: ['.custom'],
        features: expect.objectContaining({
          completion: expect.any(Number),
          diagnostics: expect.any(Number),
          hover: expect.any(Number),
        }),
        id: 'custom-lsp',
      }),
    )
  })

  it('turns ty off again through the setting, whatever the old env var says', () => {
    // The bug this replaces: `truthy(process.env.FS_EXPERIMENTAL_LSP_TY)` was
    // snapshotted at module load and ORed into every call, so the flag could be
    // turned on and never off, and this suite passed only on machines that did
    // not export it.
    process.env.FS_EXPERIMENTAL_LSP_TY = 'true'
    try {
      const on = lspServersFor({ servers: {}, languageServers: {}, tyForPython: true }).map(
        (server) => server.id,
      )
      const off = lspServersFor({ servers: {}, languageServers: {}, tyForPython: false }).map(
        (server) => server.id,
      )

      expect(on).toContain('ty')
      expect(on).not.toContain('pyright')
      expect(off).toContain('pyright')
      expect(off).not.toContain('ty')
    } finally {
      delete process.env.FS_EXPERIMENTAL_LSP_TY
    }
  })

  it('pins runtime release downloads with checksums', () => {
    const manifest: Record<string, PinnedLspRuntimeManifestEntry> = pinnedLspRuntimeManifest
    for (const entry of Object.values(manifest)) {
      for (const platform of Object.values(entry.platforms)) {
        if (!platform) continue

        for (const asset of Object.values(platform)) {
          if (!asset) continue

          expect(asset.url).toContain(`/releases/download/${entry.version}/`)
          expect(asset.url).not.toContain('/latest')
          expect(asset.sha256).toMatch(/^[a-f0-9]{64}$/u)
        }
      }
    }
  })
})

async function serverIdsFor(root: string, relativePath: string) {
  const matches = await matchLspServers({
    settings: NO_OVERRIDES,
    filePath: path.join(root, relativePath),
    workspaceRoot: root,
  })

  return matches.map((match) => match.server.id)
}

async function fixtureRoot(files: Record<string, string>) {
  const root = await mkdtemp(path.join(tmpdir(), 'platform-lsp-'))
  roots.push(root)

  for (const [relativePath, content] of Object.entries(files)) {
    const target = path.join(root, relativePath)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, content)
  }

  return root
}
