import path from 'node:path'
import type { Plugin } from 'vite'
import { reportDevSources, resolveDevSource, type DevPackage } from '../../../scripts/dev-sources'

export function devSourcePlugin(packages: readonly DevPackage[]): Plugin {
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
    // Fast Refresh retains the Editor controller in state and Ghostty's cached runtime.
    // Reload only when the changed file belongs to the browser's loaded module graph.
    hotUpdate: {
      order: 'pre',
      handler({ file, modules }) {
        if (this.environment.name !== 'client' || modules.length === 0) return
        if (!roots.some((root) => file.startsWith(`${root}${path.sep}`))) return
        this.environment.hot.send({ type: 'full-reload' })
        return []
      },
    },
  }
}
