import { createServer, connect, type Socket } from 'node:net'
import assert from 'node:assert/strict'
import { mkdtemp, readdir, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, vi } from 'vitest'
import {
  assertLayoutPortFree,
  selectLayoutPeerOrigin,
  startLayoutServers,
} from '../../apps/web/test/env/retention-acceptance-layout-server'
import { isPortAvailable } from '../runtime-network'
import { fixtureReadiness } from './fixture-readiness'

test('layout startup admits an available TCP port', async () => {
  const probe = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response(null) })
  const origin = new URL(probe.url)
  await probe.stop(true)
  await expect(assertLayoutPortFree(origin)).resolves.toBeUndefined()
})

test('layout startup rejects a port held by an outbound socket', async () => {
  const held = await holdOutboundPort()
  const origin = held.origin
  try {
    expect(() =>
      Bun.serve({
        hostname: '127.0.0.1',
        port: Number(origin.port),
        fetch: () => new Response(null),
      }),
    ).toThrow()
    const selected = await selectLayoutPeerOrigin(
      origin,
      held.destination,
      new URL('http://127.0.0.1:5179'),
    )
    expect(selected.port).not.toBe(origin.port)
    expect(await isPortAvailable('127.0.0.1', Number(selected.port))).toBe(true)
    await expect(assertLayoutPortFree(origin)).rejects.toThrow('Layout fixture port is occupied')
  } finally {
    await held.close()
  }
})

test.skipIf(process.platform === 'win32')(
  'layout pair starts beside an occupied peer port and stops only its servers',
  async () => {
    const held = await holdOutboundPort()
    const scratch = await mkdtemp(join(tmpdir(), 'layout-port-startup-test-'))
    const probe = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response(null) })
    const primary = probe.url.origin
    await probe.stop(true)
    vi.stubEnv('TMPDIR', scratch)
    let servers: Awaited<ReturnType<typeof startLayoutServers>> | undefined
    try {
      servers = await startLayoutServers(held.origin.origin, primary)
      expect(servers.peer).not.toBe(held.origin.origin)
      for (const origin of [primary, servers.peer]) {
        expect((await fixtureReadiness(new URL(origin), 'http://127.0.0.1:5179')).ok).toBe(true)
      }
      const homes = (await readdir(scratch)).filter((name) =>
        /retention-layout-(primary|peer)-/.test(name),
      )
      expect(homes).toHaveLength(2)
      const pids = await Promise.all(
        homes.map((home) => readFile(join(scratch, home, 'home/server.lock'), 'utf8')),
      )
      await servers.stop()
      servers = undefined
      for (const pid of pids) {
        expect(() => process.kill(Number(pid), 0)).toThrow()
      }
      expect(await isPortAvailable('127.0.0.1', Number(new URL(primary).port))).toBe(true)
      expect(held.socket.destroyed).toBe(false)
      await expect(assertLayoutPortFree(held.origin)).rejects.toThrow(
        'Layout fixture port is occupied',
      )
      expect((await readdir(scratch)).every((name) => name.includes('server-evidence'))).toBe(true)
    } finally {
      await servers?.stop()
      await held.close()
      vi.unstubAllEnvs()
      await rm(scratch, { recursive: true, force: true })
    }
  },
  40_000,
)

async function holdOutboundPort() {
  const sockets = new Set<Socket>()
  const destination = createServer((socket) => {
    sockets.add(socket)
    socket.on('error', () => {})
  })
  await new Promise<void>((resolve) => destination.listen(0, '127.0.0.1', resolve))
  const address = destination.address()
  assert(address && typeof address === 'object')
  const socket = connect({ host: '127.0.0.1', port: address.port })
  await new Promise<void>((resolve, reject) =>
    socket.once('connect', resolve).once('error', reject),
  )
  return {
    socket,
    origin: new URL(`http://127.0.0.1:${socket.localPort}`),
    destination: new URL(`http://127.0.0.1:${address.port}`),
    close: async () => {
      socket.destroy()
      for (const accepted of sockets) accepted.destroy()
      await new Promise<void>((resolve) => destination.close(() => resolve()))
    },
  }
}
