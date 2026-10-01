import { createRequire } from 'node:module'
import path from 'node:path'
import { expect, test } from 'vitest'
import { workspaceRoot } from '../editor/scripts/workspace-root'

const require = createRequire(path.join(workspaceRoot, 'editor/package.json'))
const { createServer } = await import(require.resolve('vite'))

const projects = [
  { directory: 'editor', project: 'browser' },
  { directory: 'editor', project: 'highlight-paint' },
  { directory: 'highlighting', project: 'browser' },
]

test.each(projects)(
  '$directory $project completes conditional module responses',
  async ({ directory, project }) => {
    const root = path.join(workspaceRoot, 'editor/packages', directory)
    const config = (await import(path.join(root, 'vitest.config.ts'))).default
    const browser = config.test.projects.find(
      (entry: { test: { name: string } }) => entry.test.name === project,
    )
    const server = await createServer({
      root,
      configFile: false,
      plugins: browser.plugins,
      optimizeDeps: { noDiscovery: true },
      server: { host: '127.0.0.1', port: 0, strictPort: true, fs: { allow: [workspaceRoot] } },
    })
    try {
      await server.listen()
      const address = server.httpServer!.address()
      expect(address).not.toBeNull()
      expect(typeof address).toBe('object')
      const url = `http://127.0.0.1:${(address as { port: number }).port}/src/index.ts`
      const initial = await fetch(url)
      expect(initial.status).toBe(200)
      const text = await initial.text()
      const etag = initial.headers.get('etag')
      expect(etag).not.toBeNull()
      const conditional = await fetch(url, { headers: { 'if-none-match': etag! } })
      expect(conditional.status).toBe(200)
      expect(await conditional.text()).toBe(text)
    } finally {
      await server.close()
    }
  },
)
