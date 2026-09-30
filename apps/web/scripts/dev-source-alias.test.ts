import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createServer, type ViteDevServer } from 'vite'
import { expect, test, vi } from 'vitest'
import { sourceAliases } from '../../../scripts/dev-sources'

const sourceTest = test.extend<{
  root: string
  hmr: { server: ViteDevServer; processed: Set<string> }
}>({
  root: async ({ task }, provide) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `fregat-source-hmr-${task.id}-`))
    for (const directory of ['src', 'library/src', 'library/dist']) {
      fs.mkdirSync(path.join(root, directory), { recursive: true })
    }
    fs.writeFileSync(path.join(root, 'src/main.ts'), "import 'fixture-library'\n")
    fs.writeFileSync(path.join(root, 'library/src/index.ts'), 'export const value = 1\n')
    fs.writeFileSync(path.join(root, 'library/src/unloaded.ts'), 'export const value = 1\n')
    fs.writeFileSync(path.join(root, 'library/dist/index.js'), 'export const value = 1\n')
    try {
      await provide(root)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  },
  hmr: async ({ root }, provide) => {
    const processed = new Set<string>()
    const library = path.join(root, 'library')
    const server = await createServer({
      configFile: false,
      root,
      logLevel: 'silent',
      optimizeDeps: { noDiscovery: true, include: [] },
      server: { middlewareMode: true, watch: null, ws: false },
      resolve: {
        alias: sourceAliases([
          {
            name: 'fixture-library',
            root: library,
            checkout: root,
            entries: new Map([['fixture-library', path.join(library, 'src/index.ts')]]),
          },
        ]),
      },
      plugins: [
        {
          name: 'record-processed-update',
          hotUpdate: {
            order: 'post',
            handler({ file }) {
              if (this.environment.name === 'client') processed.add(file)
            },
          },
        },
      ],
    })
    try {
      await server.transformRequest('/src/main.ts')
      await server.transformRequest('/library/src/index.ts')
      await provide({ server, processed })
    } finally {
      await server.close()
    }
  },
})

sourceTest(
  'Vite propagates package edits through the normal module graph',
  async ({ root, hmr: { server, processed } }) => {
    const send = vi.spyOn(server.environments.client.hot, 'send')
    const file = path.join(root, 'library/src/index.ts')
    expect(server.environments.client.moduleGraph.getModulesByFile(file)?.size).toBe(1)
    server.watcher.emit('change', file)
    await expect.poll(() => processed.has(file)).toBe(true)
    await expect
      .poll(() =>
        send.mock.calls.some(
          ([payload]) => typeof payload === 'object' && payload.type === 'full-reload',
        ),
      )
      .toBe(true)
  },
)

sourceTest.for(['library/dist/index.js', 'library/src/unloaded.ts'])(
  'an unserved package file does not reload the page: %s',
  async (relative, { root, hmr: { server, processed } }) => {
    const send = vi.spyOn(server.environments.client.hot, 'send')
    const file = path.join(root, relative)
    expect(server.environments.client.moduleGraph.getModulesByFile(file)).toBeUndefined()
    server.watcher.emit('change', file)
    await expect.poll(() => processed.has(file)).toBe(true)
    expect(send).not.toHaveBeenCalled()
  },
)
