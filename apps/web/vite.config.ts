import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { portFromEnv } from '../../scripts/runtime-network'
import {
  readDevSources,
  reportDevSources,
  resolveDevSource,
  type DevPackage,
} from '../../scripts/dev-sources'
import { consumeAppSave } from '../server/src/fs/app-save-marker'
import { bundleStatsPlugin } from './scripts/bundle-stats-plugin'
import { demoPreviewPlugin } from './scripts/demo-preview-plugin'
import { devPagePlugin } from './scripts/dev-page-plugin'
import { bootAppearancePlugin } from './scripts/boot-appearance-plugin'
import { phosphorWeightPlugin } from './scripts/phosphor-weight-plugin'

const workspaceRoot = path.resolve(__dirname, '../..')
const devServerHost = process.env.WEB_HOST ?? '127.0.0.1'
const devServerPort = portFromEnv(process.env, 'WEB_PORT', 5173)

export default defineConfig(({ command, isPreview, mode }) => {
  const packages = command === 'serve' && !isPreview ? readDevSources(__dirname) : []
  // A build compiles the linked checkouts' pre-built `dist`; none of it is ours to memoize.
  const linkedDist = command === 'build' ? readDevSources(__dirname) : []
  return {
    build: {
      rollupOptions: {
        input:
          mode === 'demo'
            ? path.resolve(__dirname, 'demo.html')
            : {
                index: path.resolve(__dirname, 'index.html'),
                dev: path.resolve(__dirname, 'dev.html'),
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
      bootAppearancePlugin(__dirname),
      demoPreviewPlugin(__dirname),
      devPagePlugin(),
      devSourcePlugin(packages),
      platformSelfSaveHmrPlugin(),
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
        path.resolve(__dirname, 'src'),
        path.resolve(workspaceRoot, 'packages/ui/src'),
      ]),
      bundleStatsPlugin(),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
      dedupe: ['react', 'react-dom'],
    },
    server: {
      fs: {
        allow: [workspaceRoot, ...packages.map((pkg) => pkg.checkout)],
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
    // Mounted editor and terminal instances retain old implementations after Fast Refresh.
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

function platformSelfSaveHmrPlugin(): Plugin {
  return {
    name: 'platform-self-save-hmr',
    apply: 'serve',
    hotUpdate: {
      order: 'pre',
      handler({ file }) {
        if (!consumeAppSave(file)) return

        return []
      },
    },
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
