import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { portFromEnv, runtimeUrl, serverUrlFromEnv } from '../../scripts/runtime-network'
import {
  readDevSources,
  reportDevSources,
  resolveDevSource,
  type DevPackage,
} from '../../scripts/dev-sources'
import { appSaveHmrPlugin } from './scripts/app-save-hmr-plugin'
import { bundleStatsPlugin } from './scripts/bundle-stats-plugin'
import { demoPreviewPlugin } from './scripts/demo-preview-plugin'
import { devPagePlugin } from './scripts/dev-page-plugin'
import { bootAppearancePlugin } from './scripts/boot-appearance-plugin'
import { phosphorWeightPlugin } from './scripts/phosphor-weight-plugin'
import { shellChunksPlugin } from './scripts/shell-chunks-plugin'
import { staticGraphChunk } from './scripts/initial-chunk'

const workspaceRoot = path.resolve(import.meta.dirname, '../..')
const markdownRequire = createRequire(path.join(workspaceRoot, 'packages/markdown/package.json'))
const sharedMarkdown = ['unified', 'remark-parse', 'remark-gfm', 'unist-util-visit']

const devServerHost = process.env.WEB_HOST ?? '127.0.0.1'
const devServerPort = portFromEnv(process.env, 'WEB_PORT', 5173)

/**
 * Bun's isolated linker can symlink a dependency (`@fontsource-variable/*`, at least under
 * install contention) straight into the shared cache instead of copying it into the
 * workspace; a real path there is otherwise outside every `fs.allow` root and Vite 403s it.
 */
export function bunInstallCacheRoot(env: NodeJS.ProcessEnv = process.env): string {
  return env.BUN_INSTALL_CACHE_DIR ?? path.join(os.homedir(), '.bun', 'install', 'cache')
}

export default defineConfig(({ command, isPreview, mode }) => {
  const packages = command === 'serve' && !isPreview ? readDevSources(import.meta.dirname) : []
  // A build compiles the linked checkouts' pre-built `dist`; none of it is ours to memoize.
  const linkedDist = command === 'build' ? readDevSources(import.meta.dirname) : []
  return {
    build: {
      rollupOptions: {
        output: {
          // The app entry's initial modules ship as one chunk. Left to automatic splitting, every
          // lazy chunk that shares a module with them cuts them into another file, and many small
          // files gzip worse than one. Traced from main.tsx, so the dev gallery's modules stay out.
          codeSplitting: {
            groups: [
              {
                name: staticGraphChunk(path.resolve(import.meta.dirname, 'src/main.tsx')),
                tags: ['$initial'],
              },
            ],
          },
        },
        input:
          mode === 'demo'
            ? path.resolve(import.meta.dirname, 'demo.html')
            : {
                index: path.resolve(import.meta.dirname, 'index.html'),
                dev: path.resolve(import.meta.dirname, 'dev.html'),
              },
      },
    },
    define: {
      ...(mode === 'demo' ? { 'import.meta.env.VITE_SERVER_URL': 'undefined' } : {}),
      'import.meta.env.OBSERVABILITY_ENABLED': JSON.stringify(
        process.env.OBSERVABILITY_ENABLED ?? '',
      ),
    },
    optimizeDeps: {
      // Theme subpaths are loaded after boot and must survive optimizer cache invalidation.
      exclude: ['@shikijs/themes', 'ghostty-webgpu', ...packages.map((pkg) => pkg.name)],
    },
    plugins: [
      bootAppearancePlugin(import.meta.dirname),
      shellChunksPlugin(import.meta.dirname),
      demoPreviewPlugin(import.meta.dirname),
      devPagePlugin(),
      devSourcePlugin(packages),
      appSaveHmrPlugin({
        url: serverUrlFromEnv(process.env),
        origin: runtimeUrl(devServerHost, devServerPort),
      }),
      react({
        // Vitest configs keep `compiler: true`: the flag would reprint every diagnostic per run.
        compiler: { logDiagnostics: true },
        exclude: [
          /\/node_modules\//,
          ...linkedDist.map((pkg) => new RegExp(`^${escapeRegExp(pkg.root)}/`)),
          ...packages
            .filter((pkg) => pkg.name !== '@singapore-editor/react')
            .map((pkg) => new RegExp(`^${escapeRegExp(pkg.root)}/`)),
        ],
      }),
      tailwindcss(),
      phosphorWeightPlugin([
        path.resolve(import.meta.dirname, 'src'),
        path.resolve(workspaceRoot, 'packages/ui/src'),
      ]),
      bundleStatsPlugin(),
    ],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, './src'),
        // Isolated installs resolve these from their owning workspace, where they are declared.
        ...Object.fromEntries(sharedMarkdown.map((name) => [name, markdownRequire.resolve(name)])),
      },
      // Linked checkouts share the app's React, hotkey manager and evlog globals.
      dedupe: ['react', 'react-dom', 'evlog', '@tanstack/hotkeys'],
    },
    server: {
      fs: {
        allow: [workspaceRoot, bunInstallCacheRoot(), ...packages.map((pkg) => pkg.checkout)],
      },
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

function devSourcePlugin(packages: readonly DevPackage[]): Plugin {
  const entries = new Map(packages.flatMap((pkg) => [...pkg.entries]))
  const roots = packages.map((pkg) => pkg.root)
  return {
    name: 'platform-dev-sources',
    apply: 'serve',
    enforce: 'pre',
    configureServer(server) {
      reportDevSources(packages, (line) => server.config.logger.info(line))
      server.watcher.add(roots)
    },
    resolveId(id) {
      const specifier = id.split('?')[0] ?? id
      const source = resolveDevSource(entries, specifier)
      if (source) return source + id.slice(specifier.length)
      if (specifier.startsWith('@singapore-editor/') || specifier.startsWith('ghostty-webgpu/')) {
        this.error(`No development source for ${id}. Add its source entry before importing it.`)
      }
      return null
    },
    // Mounted editors and terminals keep the old implementation after Fast Refresh: neither
    // @singapore-editor/react's controller nor ghostty-webgpu's Terminal has `import.meta.hot.dispose`.
    hotUpdate: {
      order: 'pre',
      handler({ file }) {
        if (!roots.some((root) => file.startsWith(`${root}${path.sep}`))) return
        this.environment.hot.send({ type: 'full-reload' })
        return []
      },
    },
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
