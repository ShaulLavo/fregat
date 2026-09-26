import { mkdir, realpath, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { makeTestServer, type TestServer } from '../test/server'
import { askAppWrite, type AppSaveServer } from './app-save-hmr-plugin'

const servers: TestServer[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.cleanup()))
})

async function devServer() {
  const server = await makeTestServer({ filesystemWatch: false })
  servers.push(server)
  const root = await realpath(server.root)
  const source: AppSaveServer = {
    url: 'http://127.0.0.1:3001',
    origin: server.origin,
    fetcher: (request) => server.app.handle(request),
  }
  return { root, server, source }
}

// The app addresses files relative to the workspace root; Vite reports absolute paths.
async function appSave(server: TestServer, file: string, content: string) {
  const response = await server.app.handle(
    new Request('http://127.0.0.1:3001/fs/write', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: server.origin },
      body: JSON.stringify({ path: file, content, origin: 'editor', writeId: 'save-1' }),
    }),
  )
  expect(response.status, await response.clone().text()).toBe(200)
}

test('a file the app saved is its own save until something else changes it', async () => {
  const { root, server, source } = await devServer()
  const file = path.join(root, 'app.ts')
  await writeFile(file, 'before\n')

  await appSave(server, 'app.ts', 'saved\n')
  expect(await askAppWrite(source, file, 'saved\n')).toEqual({ appWrite: true })
  // Vite asks once per environment, so the answer does not change on a second ask.
  expect(await askAppWrite(source, file, 'saved\n')).toEqual({ appWrite: true })

  await writeFile(file, 'outside edit\n')
  expect(await askAppWrite(source, file, 'outside edit\n')).toEqual({ appWrite: false })
  expect(await askAppWrite(source, path.join(root, 'other.ts'), 'saved\n')).toEqual({
    appWrite: false,
  })
})

test('a save is recognised through either spelling of a symlinked folder', async () => {
  const { root, server, source } = await devServer()
  await mkdir(path.join(root, 'real'))
  await symlink('real', path.join(root, 'alias'))

  await appSave(server, 'alias/app.ts', 'saved\n')
  for (const folder of ['real', 'alias']) {
    const file = path.join(root, folder, 'app.ts')
    expect(await askAppWrite(source, file, 'saved\n')).toEqual({ appWrite: true })
  }
})

test('a refused save is not the app’s version of the file', async () => {
  const { root, server, source } = await devServer()
  const file = path.join(root, 'app.ts')
  await writeFile(file, 'on disk\n')

  const response = await server.app.handle(
    new Request('http://127.0.0.1:3001/fs/write', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: server.origin },
      body: JSON.stringify({ path: 'app.ts', content: 'stale\n', baseVersion: 'sha256:0' }),
    }),
  )
  expect(response.ok).toBe(false)
  expect(await askAppWrite(source, file, 'stale\n')).toEqual({ appWrite: false })
})

test('a server that cannot answer leaves the change to hot update, with a warning', async () => {
  const { root, source } = await devServer()
  const file = path.join(root, 'app.ts')

  const refused = await askAppWrite({ ...source, origin: 'http://127.0.0.1:1' }, file, 'x')
  expect(refused.appWrite).toBe(false)
  expect(refused.warning).toContain('answered 403')

  const down = await askAppWrite(
    {
      ...source,
      fetcher: () => Promise.reject(new TypeError('connect ECONNREFUSED')),
    },
    file,
    'x',
  )
  expect(down.appWrite).toBe(false)
  expect(down.warning).toContain('did not answer')
})
