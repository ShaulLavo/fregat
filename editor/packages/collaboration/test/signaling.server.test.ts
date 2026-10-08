import { expect, test } from 'vitest'
import { startSignalingServer } from '../server/signaling'

const origin = 'http://collaboration.test'

function packet(socket: WebSocket): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new TypeError('Broker response timed out')), 3000)
    socket.addEventListener(
      'message',
      (event) => {
        clearTimeout(timeout)
        resolve(JSON.parse(String(event.data)))
      },
      { once: true },
    )
  })
}

async function client(url: string): Promise<WebSocket> {
  // Bun accepts client headers; lib.dom exposes only the browser constructor.
  const Socket = WebSocket as unknown as new (
    url: string,
    options: { headers: Record<string, string> },
  ) => WebSocket
  const socket = new Socket(url, { headers: { Origin: origin } })
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  return socket
}

test('broker isolates topics, requires subscription and removes departed sockets', async () => {
  const server = startSignalingServer({ hostname: '127.0.0.1', port: 0, allowedOrigins: [origin] })
  const sockets: WebSocket[] = []
  try {
    const url = `ws://127.0.0.1:${server.port}`
    const a = await client(url)
    const b = await client(url)
    const outsider = await client(url)
    sockets.push(a, b, outsider)
    const topic = crypto.randomUUID()
    for (const socket of [a, b]) {
      const subscribed = packet(socket)
      socket.send(JSON.stringify({ type: 'subscribe', topic }))
      expect(await subscribed).toEqual({ type: 'subscribed', topic })
    }
    const received = packet(b)
    a.send(JSON.stringify({ type: 'publish', topic, payload: { ciphertext: 'opaque' } }))
    expect(await received).toEqual({ type: 'publish', topic, payload: { ciphertext: 'opaque' } })
    const closed = new Promise<number>((resolve) =>
      outsider.addEventListener('close', (event) => resolve(event.code), { once: true }),
    )
    outsider.send(JSON.stringify({ type: 'publish', topic, payload: 'unauthorized' }))
    expect(await closed).toBe(1008)
    b.close()
    const bClosed = new Promise<void>((resolve) =>
      b.addEventListener('close', () => resolve(), { once: true }),
    )
    await bClosed
  } finally {
    for (const socket of sockets) socket.close()
    await server.stop(true)
  }
})

test('broker refuses origins outside its explicit allowlist', async () => {
  const server = startSignalingServer({ hostname: '127.0.0.1', port: 0, allowedOrigins: [origin] })
  try {
    const response = await fetch(server.url, { headers: { Origin: 'http://untrusted.test' } })
    expect(response.status).toBe(403)
  } finally {
    await server.stop(true)
  }
})
