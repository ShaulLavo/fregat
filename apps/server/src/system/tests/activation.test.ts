import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import net from 'node:net'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { activatedSocket } from '../activation'

// systemd's own activation harness hands the socket over exactly as a socket unit would.
const activator = Bun.which('systemd-socket-activate')
const children: Bun.Subprocess[] = []
const runtimeDirectories: string[] = []

afterEach(async () => {
  for (const child of children.splice(0)) {
    child.kill('SIGKILL')
    await child.exited
  }
  await Promise.all(
    runtimeDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

async function freePort() {
  const server = net.createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  if (typeof address !== 'object' || !address) throw new Error('no port')
  return address.port
}

async function activate(expectedPort?: number) {
  const port = await freePort()
  const fixture = path.join(import.meta.dirname, 'fixtures', 'activated-server.ts')
  const runtime = await mkdtemp(path.join(tmpdir(), 'platform-activation-'))
  runtimeDirectories.push(runtime)
  const child = Bun.spawn({
    cmd: [
      activator!,
      '-l',
      `127.0.0.1:${port}`,
      process.execPath,
      fixture,
      String(expectedPort ?? port),
      runtime,
    ],
    stdout: 'ignore',
    stderr: 'pipe',
  })
  children.push(child)
  const base = `http://127.0.0.1:${port}`
  // The harness listens before it starts the server; wait only for the listener.
  for (let attempt = 0; attempt < 200; attempt++) {
    const open = await new Promise<boolean>((resolve) => {
      const probe = net.connect({ host: '127.0.0.1', port }, () => {
        probe.destroy()
        resolve(true)
      })
      probe.on('error', () => resolve(false))
    })
    if (open) return { base, port, child }
    await Bun.sleep(10)
  }
  throw new Error('activation harness never listened')
}

describe.skipIf(!activator)('socket activation relay', () => {
  it('serves the first queued request and concurrent ones', async () => {
    const { base } = await activate()
    const responses = await Promise.all(
      Array.from({ length: 24 }, (_, index) => fetch(`${base}/hello/${index}`)),
    )
    expect(responses.map((response) => response.status)).toEqual(Array(24).fill(200))
    const body = (await responses[0]!.json()) as { path: string; socket: string }
    expect(body.path).toBe('/hello/0')
    expect((await stat(body.socket)).mode & 0o077).toBe(0)
    expect((await stat(path.dirname(body.socket))).mode & 0o077).toBe(0)
  })

  it('carries large bodies both ways', async () => {
    const { base } = await activate()
    const upload = await fetch(`${base}/upload`, {
      method: 'POST',
      body: new Uint8Array(48 * 1024 * 1024).fill(1),
    })
    expect(await upload.json()).toEqual({ bytes: 48 * 1024 * 1024 })
    const download = await fetch(`${base}/download`)
    expect((await download.arrayBuffer()).byteLength).toBe(32 * 1024 * 1024)
  })

  it('streams server-sent events and WebSocket frames', async () => {
    const { base, port } = await activate()
    const events = await (await fetch(`${base}/sse`)).text()
    expect(events).toBe('data: 0\n\ndata: 1\n\ndata: 2\n\n')

    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`)
    const echoed = await new Promise<string>((resolve, reject) => {
      socket.onopen = () => socket.send('ping')
      socket.onmessage = (event) => resolve(String(event.data))
      socket.onerror = () => reject(new Error('socket failed'))
    })
    socket.close()
    expect(echoed).toBe('ping')
  })

  it('refuses a socket on another address than the one it was given', async () => {
    const { base, child } = await activate(1)
    await fetch(`${base}/hello`).catch(() => null)
    expect(await child.exited).not.toBe(0)
    expect(await new Response(child.stderr as ReadableStream).text()).toContain(
      'system.ACTIVATION_INVALID',
    )
  })

  it('shuts down within its grace while a client stays connected', async () => {
    const { port, child } = await activate()
    const held = net.connect({ host: '127.0.0.1', port })
    await new Promise<void>((resolve) => held.once('connect', () => resolve()))
    // Half a request: the relay holds the connection open, waiting for the rest.
    held.write('GET /hello HTTP/1.1\r\nHost: 127.0.0.1\r\n')
    await Bun.sleep(200)
    const started = Date.now()
    child.kill('SIGTERM')
    const exited = await Promise.race([child.exited, Bun.sleep(5000).then(() => 'hung')])
    held.destroy()
    expect(exited).toBe(0)
    expect(Date.now() - started).toBeLessThan(3000)
  })

  it('keeps serving after a client disconnects mid-request', async () => {
    const { base } = await activate()
    const controller = new AbortController()
    const download = fetch(`${base}/download`, { signal: controller.signal }).then((response) =>
      response.body?.getReader().read(),
    )
    await download.catch(() => null)
    controller.abort()
    expect((await fetch(`${base}/after`)).status).toBe(200)
  })
})

describe('activated socket detection', () => {
  it('ignores LISTEN_FDS meant for another process', () => {
    expect(activatedSocket({ LISTEN_PID: '1', LISTEN_FDS: '1' }, [])).toBeNull()
  })

  it('takes fd 3 and clears the variables so children do not inherit them', () => {
    const env = { LISTEN_PID: String(process.pid), LISTEN_FDS: '1', LISTEN_FDNAMES: 'x' }
    expect(activatedSocket(env, [])).toEqual({ fd: 3, manager: 'systemd' })
    expect(env).toEqual({})
  })

  it('refuses more than one socket', () => {
    expect(() => activatedSocket({ LISTEN_PID: String(process.pid), LISTEN_FDS: '2' }, [])).toThrow(
      expect.objectContaining({ code: 'system.ACTIVATION_INVALID' }),
    )
  })
})
