import { afterEach, expect, test } from 'vitest'
import { createTestTerminalHost } from '../testing'
import { TerminalHostClient } from '../../terminal/host-client'
import { testSettingsOptions } from '../../settings/testing'
import { closeTestApps, createTestApp } from '../../../test/server'

const fixtures: Awaited<ReturnType<typeof createTestTerminalHost>>[] = []
afterEach(async () => {
  await closeTestApps()
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.close()))
})

async function fixture() {
  const host = await createTestTerminalHost({ idleMs: 60_000 })
  fixtures.push(host)
  return host
}

test('a probe requires an existing authenticated connection and never launches a host', async () => {
  const host = await fixture()
  let launches = 0
  const client = new TerminalHostClient({
    stateRoot: host.stateRoot,
    launch: () => {
      launches += 1
    },
  })
  await expect(client.probe()).rejects.toMatchObject({ code: 'terminal.HOST_UNREACHABLE' })
  expect(launches).toBe(0)
  expect(host.hosts).toHaveLength(0)
})

test('fresh probes answer through the retained connection without creating shells', async () => {
  const host = await fixture()
  const hello = await host.client.host()
  expect(await host.client.probe()).toEqual(hello)
  expect(await host.client.probe()).toEqual(hello)
  expect(host.hosts).toHaveLength(1)
  expect(await host.client.list()).toEqual([])
})

test.skipIf(process.platform === 'win32')(
  'a cached hello cannot make an unanswering host pass, and timeout leaves the connection usable',
  async () => {
    const host = await fixture()
    const hello = await host.client.host()
    process.kill(hello.pid, 'SIGSTOP')
    try {
      const started = performance.now()
      await expect(host.client.probe()).rejects.toMatchObject({ code: 'terminal.HOST_UNREACHABLE' })
      expect(performance.now() - started).toBeLessThan(3_000)
      expect(host.client.info()).toEqual(hello)
      expect(host.hosts).toHaveLength(1)
    } finally {
      process.kill(hello.pid, 'SIGCONT')
    }
    expect(await host.client.probe()).toEqual(hello)
    expect(await host.client.list()).toEqual([])
  },
)

test('the read-only HTTP probe requires a retained connection', async () => {
  const host = await fixture()
  const app = createTestApp({
    settings: testSettingsOptions(host.stateRoot),
    terminal: { ptyFactory: host.factory },
  })
  const response = await app.handle(
    new Request('http://localhost/terminal/health', {
      headers: { origin: 'http://localhost:5173' },
    }),
  )
  expect(response.status).toBe(503)
  expect(host.hosts).toHaveLength(0)
})

test('the read-only HTTP probe reports an answered round-trip', async () => {
  const host = await fixture()
  const hello = await host.client.host()
  const app = createTestApp({
    settings: testSettingsOptions(host.stateRoot),
    terminal: { hostClient: host.client },
  })
  const response = await app.handle(
    new Request('http://localhost/terminal/health', {
      headers: { origin: 'http://localhost:5173' },
    }),
  )
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual(hello)
  expect(await host.client.list()).toEqual([])
})

test.each(['hello-version', 'probe-reply'])('rejects a protocol mismatch in %s', async (mode) => {
  const { default: net } = await import('node:net')
  const { writeFile } = await import('node:fs/promises')
  const { FrameDecoder, encodeControl, ensureSocketDirectory } = await import('../protocol')
  const { processStart } = await import('../identity')
  const host = await fixture()
  ensureSocketDirectory(host.paths)
  await writeFile(
    host.paths.manifest,
    JSON.stringify({ hostPid: process.pid, processStart: processStart(process.pid) }),
  )
  let lists = 0
  const sockets = new Set<import('node:net').Socket>()
  const server = net.createServer((socket) => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
    const decoder = new FrameDecoder()
    socket.on('data', (bytes) => {
      for (const frame of decoder.push(bytes)) {
        if (frame.type !== 'control') continue
        const control = frame.message as { type: string; request: number }
        if (control.type === 'hello') {
          socket.write(
            encodeControl({
              type: 'hello',
              version: mode === 'hello-version' ? 2 : 1,
              capabilities: [],
              pid: process.pid,
              cgroup: null,
              startedAt: new Date().toISOString(),
              build: { release: null, commit: null, dirtyFiles: null },
            }),
          )
          continue
        }
        if (control.type !== 'list') continue
        lists++
        socket.write(
          encodeControl(
            lists === 1
              ? { type: 'list', request: control.request, sessions: [] }
              : {
                  type: 'attached',
                  request: control.request,
                  session: 0,
                  key: 'probe',
                  pid: process.pid,
                  replayedBytes: 0,
                  gapBytes: 0,
                },
          ),
        )
      }
    })
  })
  await new Promise<void>((resolve) => server.listen(host.paths.socket, resolve))
  try {
    if (mode === 'hello-version') {
      await expect(host.client.host()).rejects.toMatchObject({ code: 'terminal.HOST_PROTOCOL' })
      return
    }
    await host.client.host()
    await expect(host.client.probe()).rejects.toMatchObject({ code: 'terminal.HOST_PROTOCOL' })
    expect(host.hosts).toHaveLength(0)
  } finally {
    host.client.close()
    for (const socket of sockets) socket.destroy()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test.skipIf(process.platform === 'win32')(
  'the HTTP probe fails within its bound when an authenticated host stops answering',
  async () => {
    const host = await fixture()
    const hello = await host.client.host()
    const app = createTestApp({
      settings: testSettingsOptions(host.stateRoot),
      terminal: { hostClient: host.client },
    })
    process.kill(hello.pid, 'SIGSTOP')
    try {
      const started = performance.now()
      const response = await app.handle(
        new Request('http://localhost/terminal/health', {
          headers: { origin: 'http://localhost:5173' },
        }),
      )
      expect(response.status).toBe(503)
      expect(performance.now() - started).toBeLessThan(3_000)
      expect(host.hosts).toHaveLength(1)
    } finally {
      process.kill(hello.pid, 'SIGCONT')
    }
    expect(await host.client.list()).toEqual([])
  },
)
