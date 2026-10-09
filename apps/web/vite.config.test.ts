import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { createServer } from 'vite'
import { afterEach, expect, test } from 'vitest'
import configFn, { bunInstallCacheRoot, requireLiteralAddress } from './vite.config'

test('bunInstallCacheRoot reads BUN_INSTALL_CACHE_DIR when set', () => {
  expect(bunInstallCacheRoot({ BUN_INSTALL_CACHE_DIR: '/work/cache/bun/cache' })).toBe(
    '/work/cache/bun/cache',
  )
})

test('bunInstallCacheRoot falls back to the default Bun cache location', () => {
  expect(bunInstallCacheRoot({})).toBe(path.join(os.homedir(), '.bun', 'install', 'cache'))
})

test('dev server fs.allow includes the bun install cache root', () => {
  // Bun's isolated linker can symlink a dependency straight into this cache
  // instead of the workspace; Vite denies serving a real path outside `fs.allow`.
  const previous = process.env.BUN_INSTALL_CACHE_DIR
  process.env.BUN_INSTALL_CACHE_DIR = '/work/cache/bun/cache'
  try {
    // A build never reads dev-linked packages (that needs editor deps in package.json).
    const resolved = configFn({ command: 'build', mode: 'production' })
    expect(resolved.server?.fs?.allow).toContain('/work/cache/bun/cache')
  } finally {
    if (previous === undefined) delete process.env.BUN_INSTALL_CACHE_DIR
    else process.env.BUN_INSTALL_CACHE_DIR = previous
  }
})

test('requireLiteralAddress falls back when WEB_HOST is unset', () => {
  expect(requireLiteralAddress(undefined, '127.0.0.1')).toBe('127.0.0.1')
})

test('requireLiteralAddress passes through a literal IP unchanged', () => {
  expect(requireLiteralAddress('127.0.0.1', '0.0.0.0')).toBe('127.0.0.1')
})

test('requireLiteralAddress rejects a hostname that needs DNS resolution', () => {
  // `localhost` resolved to `::1` next to mesh's IPv4 listener and shadowed :5173 for 90 minutes
  // (2026-09-27); only a literal address keeps `strictPort` fighting over the same socket.
  expect(() => requireLiteralAddress('localhost', '127.0.0.1')).toThrow(/literal IP address/)
})

let blocker: net.Server | undefined
let stray: Awaited<ReturnType<typeof createServer>> | undefined

afterEach(async () => {
  await stray?.close()
  stray = undefined
  if (blocker) {
    const server = blocker
    blocker = undefined
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('a second dev server on a port already bound on 127.0.0.1 fails instead of shadowing it on ::1', async () => {
  // Reproduces the 2026-09-27 incident: mesh (or here, a plain listener) already holds the
  // port on 127.0.0.1, and a stray Vite must collide with it rather than bind ::1 instead.
  const port = await freePort()
  blocker = net.createServer()
  await new Promise<void>((resolve) => {
    blocker?.listen({ host: '127.0.0.1', port }, () => resolve())
  })

  const resolved = configFn({ command: 'serve', isPreview: false, mode: 'development' })
  stray = await createServer({
    configFile: false,
    root: os.tmpdir(),
    logLevel: 'silent',
    plugins: [],
    server: { ...resolved.server, host: resolved.server?.host, port, strictPort: true },
  })

  await expect(stray.listen()).rejects.toThrow(/already in use/)
  await expect(canConnect('::1', port)).resolves.toBe(false)
}, 20_000)

test.for([
  'workbench?tabs=-',
  'workbench/f/a.ts?tabs=@',
  'workbench/f/a.tsx?tabs=@',
  'workbench/f/a.js?tabs=@',
  'workbench/f/a.jsx?tabs=@',
])('inline boot CSS loads at %s', async (route) => {
  const resolved = configFn({ command: 'serve', isPreview: false, mode: 'development' })
  stray = await createServer({
    ...resolved,
    configFile: false,
    root: import.meta.dirname,
    logLevel: 'silent',
    optimizeDeps: { noDiscovery: true, include: [] },
    server: { ...resolved.server, middlewareMode: true, hmr: false },
  })

  const html = await stray.transformIndexHtml(
    `/~fixture.workspace/${route}`,
    '<!doctype html><html><head></head><body></body></html>',
  )
  expect(html).toContain('id="fregat-boot-style"')
  expect(html).toContain('@layer boot')
})

function freePort() {
  return new Promise<number>((resolve) => {
    const probe = net.createServer()
    probe.listen({ host: '127.0.0.1', port: 0 }, () => {
      const address = probe.address()
      const port = typeof address === 'object' && address ? address.port : 0
      probe.close(() => resolve(port))
    })
  })
}

function canConnect(host: string, port: number) {
  return new Promise<boolean>((resolve) => {
    const socket = net.createConnection({ host, port })
    const done = (connected: boolean) => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(connected)
    }
    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
    socket.setTimeout(500, () => done(false))
  })
}
