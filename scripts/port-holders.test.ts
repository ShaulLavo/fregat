import net from 'node:net'
import { afterEach, expect, test } from 'vitest'

import { requireFreeDevPorts } from './port-holders'

const servers: net.Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))))
})

function listen() {
  return new Promise<number>((resolve) => {
    const server = net.createServer()
    servers.push(server)
    server.listen({ host: '127.0.0.1', port: 0 }, () => {
      const address = server.address()
      resolve(typeof address === 'object' && address ? address.port : 0)
    })
  })
}

async function freePort() {
  const port = await listen()
  await new Promise((done) => servers.pop()?.close(done))
  return port
}

test('passes when every dev port is free', async () => {
  await expect(requireFreeDevPorts('127.0.0.1', [await freePort()], ':5173')).resolves.toBe(
    undefined,
  )
})

test('names the process holding a dev port instead of picking another', async () => {
  const held = await listen()
  const error = await requireFreeDevPorts('127.0.0.1', [await freePort(), held], ':5173').catch(
    (caught: unknown) => caught,
  )

  expect(error).toMatchObject({ code: 'scripts.DEV_PORT_IN_USE' })
  expect(String((error as Error).message)).toContain(`Port ${held} is in use by `)
  expect(String((error as Error).message)).toContain(`(pid ${process.pid})`)
})
