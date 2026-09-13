import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { portFromEnv } from '../../scripts/runtime-network'
import { readDevSources, reportDevSources, type DevPackage } from '../../scripts/dev-sources'
import { consumeAppSave } from '../server/src/fs/app-save-marker'
import { bundleStatsPlugin } from './scripts/bundle-stats-plugin'

const workspaceRoot = path.resolve(__dirname, '../..')
const devServerHost = process.env.WEB_HOST ?? '127.0.0.1'
const devServerPort = portFromEnv(process.env, 'WEB_PORT', 5173)

export default defineConfig(({ command, isPreview }) => {
  const packages = command === 'serve' && !isPreview ? readDevSources(__dirname) : []
  return {
    define: {
      'import.meta.env.OBSERVABILITY_ENABLED': JSON.stringify(
        process.env.OBSERVABILITY_ENABLED ?? '',
      ),
    },
    optimizeDeps: {
      // Theme subpaths are loaded after boot and must survive optimizer cache invalidation.
      exclude: ['@shikijs/themes', 'ghostty-webgpu', ...packages.map((pkg) => pkg.name)],
    },
    plugins: [
      devSourcePlugin(packages),
      platformSelfSaveHmrPlugin(),
      react({
        compiler: true,
        exclude: [
          /\/node_modules\//,
          ...packages
            .filter((pkg) => pkg.name !== '@singapor/react')
            .map((pkg) => new RegExp(`^${escapeRegExp(pkg.root)}/`)),
        ],
      }),
      tailwindcss(),
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
        allow: [workspaceRoot, ...packages.map((pkg) => pkg.root)],
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
      const source = entries.get(specifier)
      if (source) return source + id.slice(specifier.length)
      if (specifier.startsWith('@singapor/') || specifier.startsWith('ghostty-webgpu/')) {
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
