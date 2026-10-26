import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import path from 'node:path'
import { expect, test } from 'vitest'

const workspaceRoot = path.resolve(import.meta.dirname, '..')

const require = createRequire(path.join(workspaceRoot, 'apps/web/package.json'))
const { createServer } = await import(require.resolve('vite'))

const configurations = [
  {
    config: 'apps/web/vitest.browser.config.ts',
    source: 'src/lib/path-formatters.ts',
  },
  {
    config: 'apps/web/vitest.tree-browser.config.ts',
    source: 'src/lib/path-formatters.ts',
  },
]

test.each(configurations)(
  '$config completes conditional module responses',
  async ({ config: configPath, source }) => {
    const absoluteConfig = path.join(workspaceRoot, configPath)
    const config = (await import(absoluteConfig)).default
    const server = await createServer({
      root: path.dirname(absoluteConfig),
      configFile: false,
      plugins: config.plugins,
      resolve: config.resolve,
      optimizeDeps: { noDiscovery: true },
      // Direct Vite servers bind an ephemeral port when given zero.
      server: { host: '127.0.0.1', port: 0, strictPort: false, fs: { allow: [workspaceRoot] } },
    })
    try {
      await server.listen()
      const address = server.httpServer!.address()
      assert(address && typeof address === 'object')
      const url = `http://127.0.0.1:${address.port}/${source}`
      const initial = await fetch(url)
      expect(initial.status).toBe(200)
      const text = await initial.text()
      const etag = initial.headers.get('etag')
      assert(etag)
      const conditional = await fetch(url, {
        headers: { 'if-none-match': etag, 'if-modified-since': new Date().toUTCString() },
      })
      expect(conditional.status).toBe(200)
      expect(await conditional.text()).toBe(text)
    } finally {
      await server.close()
    }
  },
)
