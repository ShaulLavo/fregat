import net from 'node:net'
import { existsSync, realpathSync } from 'node:fs'
import { htmlBootstrapPlugin } from './scripts/html-bootstrap-plugin.ts'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Alias } from 'vite'
import { portFromEnv } from '../../scripts/runtime-network.ts'
import { createScriptError } from '../../scripts/structured-errors.ts'
import { readDevSources, sourceAliases } from '../../scripts/dev-sources.ts'
import { bundleStatsPlugin } from './scripts/bundle-stats-plugin.ts'
import { devPagePlugin } from './scripts/dev-page-plugin.ts'
import { bootAppearancePlugin } from './scripts/boot-appearance-plugin.ts'
import { phosphorImportPlugin } from './scripts/phosphor-import-plugin.ts'
import { phosphorWeightPlugin } from './scripts/phosphor-weight-plugin.ts'
import {
  SHELL_ENTRIES,
  PHONE_BOOT_SCREENS,
  PHONE_OVERLAYS,
  shellChunksPlugin,
} from './scripts/shell-chunks-plugin.ts'
import { shellChunkGroups } from './scripts/shell-chunk-groups.ts'

const workspaceRoot = path.resolve(import.meta.dirname, '../..')
const markdownRequire = createRequire(path.join(workspaceRoot, 'packages/markdown/package.json'))
const sharedMarkdown = ['unified', 'remark-parse', 'remark-gfm', 'unist-util-visit']
const appAliases: readonly Alias[] = [
  { find: '@', replacement: path.resolve(import.meta.dirname, './src') },
]

const devServerHost = requireLiteralAddress(process.env.WEB_HOST, '127.0.0.1')
const devServerPort = portFromEnv(process.env, 'WEB_PORT', 5173)

/**
 * Bun's isolated linker can symlink a dependency (`@fontsource-variable/*`, at least under
 * install contention) straight into the shared cache instead of copying it into the
 * workspace; a real path there is otherwise outside every `fs.allow` root and Vite 403s it.
 */
export function bunInstallCacheRoot(env: NodeJS.ProcessEnv = process.env): string {
  return env.BUN_INSTALL_CACHE_DIR ?? path.join(os.homedir(), '.bun', 'install', 'cache')
}

export function bunDependencyRoots(root: string = workspaceRoot): string[] {
  const store = path.join(root, 'node_modules/.bun')
  return existsSync(store) ? [realpathSync(store)] : []
}

/**
 * A hostname needs DNS resolution and can land on a different address family than the one
 * already bound: `localhost` resolved to `::1` next to mesh's IPv4 `:5173` listener, and a stray
 * Vite bound there instead of colliding with it, shadowing the route for 90 minutes (2026-09-27).
 * Only a literal IP keeps `strictPort` below fighting over the same socket mesh holds.
 */
export function requireLiteralAddress(value: string | undefined, fallback: string): string {
  if (value === undefined) return fallback
  if (net.isIP(value)) return value
  throw createScriptError(`WEB_HOST must be a literal IP address, got ${JSON.stringify(value)}.`)
}

export default defineConfig(({ command, isPreview }) => {
  const packages = command === 'serve' && !isPreview ? readDevSources(import.meta.dirname) : []
  // A build compiles the linked checkouts' pre-built `dist`; none of it is ours to memoize.
  const linkedDist = command === 'build' ? readDevSources(import.meta.dirname) : []
  return {
    build: {
      // Every browser the app runs in supports `modulepreload`; the polyfill is a first-load file.
      modulePreload: { polyfill: false },
      rollupOptions: {
        output: {
          // The entry's initial modules and the lazy workbench each ship as whole chunks. Left to
          // automatic splitting, every lazy chunk that shares a module with them cuts them into
          // another file, and many small files gzip worse than one. Traced from main.tsx, so the
          // dev gallery's modules stay out.
          codeSplitting: {
            groups: shellChunkGroups(path.resolve(import.meta.dirname, 'src/main.tsx'), {
              phone: path.resolve(import.meta.dirname, SHELL_ENTRIES.phone),
              workbench: path.resolve(import.meta.dirname, SHELL_ENTRIES.workbench),
              phoneScreens: PHONE_BOOT_SCREENS.map((entry) =>
                path.resolve(import.meta.dirname, entry),
              ),
              phoneOverlays: PHONE_OVERLAYS.map((entry) =>
                path.resolve(import.meta.dirname, entry),
              ),
            }),
          },
        },
        input: {
          index: path.resolve(import.meta.dirname, 'index.html'),
          dev: path.resolve(import.meta.dirname, 'dev.html'),
          // An entry, so rolldown tags the modules it reaches `$initial` like the app's.
          workbench: path.resolve(import.meta.dirname, SHELL_ENTRIES.workbench),
        },
      },
    },
    define: {
      'import.meta.env.OBSERVABILITY_ENABLED': JSON.stringify(
        process.env.OBSERVABILITY_ENABLED ?? '',
      ),
    },
    optimizeDeps: {
      // Theme subpaths are loaded after boot and must survive optimizer cache invalidation.
      exclude: ['@shikijs/themes', 'ghostty-webgpu'].concat(packages.map((pkg) => pkg.name)),
      // Linked workspace imports and editor workers can enter the graph after boot.
      // Prebundle their dependencies so opening a lazy screen keeps the optimizer graph.
      include: [
        'evlog/client',
        '@fregat/hotkeys > @tanstack/store',
        '@singapore-editor/markdown > micromark-util-decode-string',
        '@singapore-editor/markdown > micromark-util-normalize-identifier',
        '@singapore-editor/markdown > tree-sitter-md',
        '@singapore-editor/core > @shikijs/engine-oniguruma',
        '@singapore-editor/core > @shikijs/engine-oniguruma/wasm-inlined',
        '@singapore-editor/core > shiki/core',
        '@singapore-editor/core > shiki/textmate',
        '@singapore-editor/diff > diff',
        '@singapore-editor/highlighting > shiki/langs',
        '@singapore-editor/highlighting > shiki/themes',
        '@singapore-editor/plugin-ui > remark-stringify',
        '@singapore-editor/spellcheck > cspell-trie-lib',
        '@singapore-editor/tree-sitter > web-tree-sitter',
      ],
    },
    plugins: [
      htmlBootstrapPlugin(
        process.env.VITE_SERVER_URL ?? `http://localhost:${process.env.PORT ?? '3001'}`,
      ),
      bootAppearancePlugin(import.meta.dirname),
      shellChunksPlugin(import.meta.dirname),
      devPagePlugin(),
      react({
        // Vitest configs keep `compiler: true`: the flag would reprint every diagnostic per run.
        compiler: { logDiagnostics: true },
        exclude: [/\/node_modules\//].concat(
          packages.length > 0
            ? [/\/features\/terminal\/components\/(panel|saved-viewport)\.tsx$/]
            : [],
          linkedDist.map((pkg) => new RegExp(`^${escapeRegExp(pkg.root)}/`)),
          packages
            .filter((pkg) => pkg.name !== '@singapore-editor/react')
            .map((pkg) => new RegExp(`^${escapeRegExp(pkg.root)}/`)),
        ),
      }),
      tailwindcss(),
      phosphorImportPlugin(),
      phosphorWeightPlugin([
        path.resolve(import.meta.dirname, 'src'),
        path.resolve(workspaceRoot, 'packages/ui/src'),
      ]),
      bundleStatsPlugin(),
    ],
    resolve: {
      alias: appAliases.concat(
        sharedMarkdown.map((name) => ({
          find: name,
          replacement: markdownRequire.resolve(name),
        })),
        sourceAliases(packages),
      ),
      // Linked checkouts share the app's React, hotkey manager and evlog globals.
      dedupe: ['react', 'react-dom', 'evlog', '@tanstack/hotkeys'],
    },
    server: {
      fs: {
        allow: [workspaceRoot, bunInstallCacheRoot()].concat(
          bunDependencyRoots(),
          packages.map((pkg) => pkg.checkout),
        ),
      },
      // A literal address (see `requireLiteralAddress`), never a hostname Vite would resolve itself.
      host: devServerHost,
      port: devServerPort,
      // The port is authoritative, not a preference: the server's origin
      // allowlist is exact (apps/server/src/auth.ts) and the launcher computed
      // this port with `selectAvailablePort` before spawning us. Silently moving
      // to another port would produce an app that loads and then 403s on every
      // request; failing to bind is the honest outcome.
      strictPort: true,
    },
    worker: {
      format: 'es',
    },
  }
})

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
