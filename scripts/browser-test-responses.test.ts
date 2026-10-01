import { createRequire } from 'node:module'
import path from 'node:path'
import { expect, test } from 'vitest'
import { workspaceRoot } from '../editor/scripts/workspace-root'

const require = createRequire(path.join(workspaceRoot, 'editor/package.json'))
const { createServer } = await import(require.resolve('vite'))

const configurations = [
  { config: 'editor/packages/editor/vitest.config.ts', project: 'browser', source: 'src/index.ts' },
  {
    config: 'editor/packages/editor/vitest.config.ts',
    project: 'highlight-paint',
    source: 'src/index.ts',
  },
  {
    config: 'editor/packages/highlighting/vitest.config.ts',
    project: 'browser',
    source: 'src/index.ts',
  },
  {
    config: 'apps/web/vitest.browser.config.ts',
    project: '',
    source: 'src/lib/path-formatters.ts',
  },
  {
    config: 'apps/web/vitest.tree-browser.config.ts',
    project: '',
    source: 'src/lib/path-formatters.ts',
  },
]

test.each(configurations)(
  '$config $project completes conditional module responses',
  async ({ config: configPath, project, source }) => {
    const absoluteConfig = path.join(workspaceRoot, configPath)
    const config = (await import(absoluteConfig)).default
    let plugins = config.plugins
    if (project) {
      plugins = config.test.projects.find(
        (entry: { test: { name: string } }) => entry.test.name === project,
      ).plugins
    }
    const server = await createServer({
      root: path.dirname(absoluteConfig),
      configFile: false,
      plugins,
      resolve: config.resolve,
      optimizeDeps: { noDiscovery: true },
      // Direct Vite servers bind an ephemeral port when given zero.
      server: { host: '127.0.0.1', port: 0, strictPort: false, fs: { allow: [workspaceRoot] } },
    })
    try {
      await server.listen()
      const address = server.httpServer!.address()
      expect(address).not.toBeNull()
      expect(typeof address).toBe('object')
      const url = `http://127.0.0.1:${(address as { port: number }).port}/${source}`
      const initial = await fetch(url)
      expect(initial.status).toBe(200)
      const text = await initial.text()
      const etag = initial.headers.get('etag')
      expect(etag).not.toBeNull()
      const conditional = await fetch(url, {
        headers: { 'if-none-match': etag!, 'if-modified-since': new Date().toUTCString() },
      })
      expect(conditional.status).toBe(200)
      expect(await conditional.text()).toBe(text)
    } finally {
      await server.close()
    }
  },
)
