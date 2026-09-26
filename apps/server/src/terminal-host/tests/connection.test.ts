import { mkdtemp, rm } from 'node:fs/promises'
import net from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, test } from 'vitest'

import { HostConnection, MAX_QUEUED_BYTES } from '../main'
import type { HostSession } from '../session'

const cleanups: (() => Promise<void>)[] = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup()
})

// A real socket pair whose client end never reads, so the host end's queue only grows.
async function stalledPair() {
  const directory = await mkdtemp(path.join(tmpdir(), 'platform-host-connection-'))
  const socketPath = path.join(directory, 'host.sock')
  const accepted = Promise.withResolvers<net.Socket>()
  const server = net.createServer((socket) => accepted.resolve(socket))
  await new Promise<void>((resolve) => server.listen(socketPath, resolve))
  const client = net.connect(socketPath)
  client.pause()
  const hostSide = await accepted.promise
  cleanups.push(async () => {
    client.destroy()
    hostSide.destroy()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(directory, { recursive: true, force: true })
  })
  return hostSide
}

test('drops a connection whose reader stalls instead of queueing output without bound', async () => {
  const socket = await stalledPair()
  const disconnected: HostConnection[] = []
  const host = { disconnect: (connection: HostConnection) => disconnected.push(connection) }
  const connection = new HostConnection(
    host as unknown as ConstructorParameters<typeof HostConnection>[0],
    socket,
  )
  const session = { id: 1 } as HostSession
  const chunk = new Uint8Array(64 * 1024)

  let offset = 0
  while (!socket.destroyed && offset < 4 * MAX_QUEUED_BYTES) {
    connection.output(session, offset, chunk)
    offset += chunk.byteLength
  }

  expect(socket.destroyed).toBe(true)
  // The kernel's socket buffer absorbs some output before the queue starts to grow.
  expect(offset).toBeLessThan(2 * MAX_QUEUED_BYTES)
  await expect.poll(() => disconnected).toEqual([connection])
})
