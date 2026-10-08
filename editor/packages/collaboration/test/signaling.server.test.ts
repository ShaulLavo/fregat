import { expect, test } from 'vitest'
import { startSignalingServer, type SignalingServerOptions } from '../server/signaling'

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

async function client(url: string, protocol?: string): Promise<WebSocket> {
  // Bun accepts client headers; lib.dom exposes only the browser constructor.
  const Socket = WebSocket as unknown as new (
    url: string,
    options: { headers: Record<string, string> },
  ) => WebSocket
  const socket = new Socket(url, {
    headers: { Origin: origin, ...(protocol ? { 'Sec-WebSocket-Protocol': protocol } : {}) },
  })
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  return socket
}

test('broker isolates topics, requires subscription and removes departed sockets', async () => {
  const server = startSignalingServer({
    hostname: '127.0.0.1',
    port: 0,
    allowedOrigins: [origin],
    authorize: () => true,
    limits: { ...limits, subscribeTimeout: 3000, idleTimeout: 3000 },
  })
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
  const server = startSignalingServer({
    hostname: '127.0.0.1',
    port: 0,
    allowedOrigins: [origin],
    authorize: () => true,
    limits: { ...limits, subscribeTimeout: 3000, idleTimeout: 3000 },
  })
  try {
    const response = await fetch(server.url, { headers: { Origin: 'http://untrusted.test' } })
    expect(response.status).toBe(403)
  } finally {
    await server.stop(true)
  }
})

const limits = {
  connections: 16,
  connectionsPerIP: 8,
  subscribeTimeout: 50,
  idleTimeout: 100,
  framesPerSecond: 8,
  bytesPerSecond: 1024,
}

test('broker requires an explicit admission policy', async () => {
  let server: ReturnType<typeof startSignalingServer> | undefined
  try {
    expect(() => {
      server = startSignalingServer({
        hostname: '127.0.0.1',
        port: 0,
        allowedOrigins: [origin],
      } as unknown as SignalingServerOptions)
    }).toThrow('admission policy')
  } finally {
    await server?.stop(true)
  }
})

for (const kind of ['global', 'IP'] as const) {
  test(`broker bounds ${kind} connections before upgrade`, async () => {
    const options = {
      hostname: '127.0.0.1',
      port: 0,
      allowedOrigins: [origin],
      authorize: () => true,
      limits: {
        ...limits,
        connections: kind === 'global' ? 2 : 16,
        connectionsPerIP: kind === 'IP' ? 2 : 8,
        subscribeTimeout: 3000,
      },
    }
    const server = startSignalingServer(options)
    const sockets: WebSocket[] = []
    try {
      const url = `ws://127.0.0.1:${server.port}`
      sockets.push(await client(url), await client(url))
      const response = await fetch(server.url, { headers: { Origin: origin } })
      expect(response.status).toBe(429)
      sockets[0]!.close()
      await expect
        .poll(async () => (await fetch(server.url, { headers: { Origin: origin } })).status, {
          timeout: 1000,
        })
        .toBe(426)
    } finally {
      for (const socket of sockets) socket.close()
      await server.stop(true)
    }
  })
}

test('broker evicts never-subscribing and application-idle sockets', async () => {
  const options = {
    hostname: '127.0.0.1',
    port: 0,
    allowedOrigins: [origin],
    authorize: () => true,
    limits,
  }
  const server = startSignalingServer(options)
  const sockets: WebSocket[] = []
  try {
    const url = `ws://127.0.0.1:${server.port}`
    const idle = await client(url)
    sockets.push(idle)
    await expect.poll(() => idle.readyState, { timeout: 500 }).toBe(WebSocket.CLOSED)
    const subscribed = await client(url)
    sockets.push(subscribed)
    const acknowledged = packet(subscribed)
    subscribed.send(JSON.stringify({ type: 'subscribe', topic: crypto.randomUUID() }))
    await acknowledged
    await expect.poll(() => subscribed.readyState, { timeout: 500 }).toBe(WebSocket.CLOSED)
  } finally {
    for (const socket of sockets) socket.close()
    await server.stop(true)
  }
})

test('broker refuses strangers without consuming a legitimate room slot', async () => {
  const options = {
    hostname: '127.0.0.1',
    port: 0,
    allowedOrigins: [origin],
    limits,
    authorize: (request: Request) =>
      request.headers.get('sec-websocket-protocol') === 'test-admission',
  }
  const server = startSignalingServer(options)
  const sockets: WebSocket[] = []
  try {
    const strangers = await Promise.all(
      Array.from({ length: 32 }, () => fetch(server.url, { headers: { Origin: origin } })),
    )
    expect(strangers.every((response) => response.status === 403)).toBe(true)
    const topic = crypto.randomUUID()
    const url = `ws://127.0.0.1:${server.port}`
    const upgrades = await Promise.allSettled(Array.from({ length: 32 }, () => client(url)))
    expect(upgrades.every((result) => result.status === 'rejected')).toBe(true)
    sockets.push(await client(url, 'test-admission'), await client(url, 'test-admission'))
    for (const socket of sockets) {
      const acknowledged = packet(socket)
      socket.send(JSON.stringify({ type: 'subscribe', topic }))
      expect(await acknowledged).toEqual({ type: 'subscribed', topic })
    }
    const received = packet(sockets[1]!)
    sockets[0]!.send(JSON.stringify({ type: 'publish', topic, payload: 'legitimate-room' }))
    expect(await received).toEqual({ type: 'publish', topic, payload: 'legitimate-room' })
  } finally {
    for (const socket of sockets) socket.close()
    await server.stop(true)
  }
})

for (const budget of ['frames', 'bytes'] as const) {
  test(`broker enforces per-connection ${budget} budget`, async () => {
    const options = {
      hostname: '127.0.0.1',
      port: 0,
      allowedOrigins: [origin],
      authorize: () => true,
      limits: {
        ...limits,
        subscribeTimeout: 3000,
        idleTimeout: 3000,
        bytesPerSecond: budget === 'bytes' ? 256 : 4096,
        framesPerSecond: budget === 'frames' ? 1 : 8,
      },
    }
    const server = startSignalingServer(options)
    const socket = await client(`ws://127.0.0.1:${server.port}`)
    try {
      const topic = crypto.randomUUID()
      const acknowledged = packet(socket)
      socket.send(JSON.stringify({ type: 'subscribe', topic }))
      await acknowledged
      socket.send(JSON.stringify({ type: 'publish', topic, payload: 'x'.repeat(512) }))
      await expect.poll(() => socket.readyState, { timeout: 500 }).toBe(WebSocket.CLOSED)
    } finally {
      socket.close()
      await server.stop(true)
    }
  })
}

test('broker bounds stalled authorization and releases its reservation', async () => {
  let accept = false
  let admitted: () => void = () => {}
  const started = new Promise<void>((resolve) => {
    admitted = resolve
  })
  const server = startSignalingServer({
    hostname: '127.0.0.1',
    port: 0,
    allowedOrigins: [origin],
    limits: { ...limits, connections: 1, connectionsPerIP: 1 },
    authorize: () => {
      if (accept) return true
      admitted()
      return new Promise<boolean>(() => {})
    },
  })
  try {
    const stalled = fetch(server.url, { headers: { Origin: origin } })
    await started
    expect((await fetch(server.url, { headers: { Origin: origin } })).status).toBe(429)
    expect((await stalled).status).toBe(403)
    accept = true
    expect((await fetch(server.url, { headers: { Origin: origin } })).status).toBe(426)
  } finally {
    await server.stop(true)
  }
})

for (const limitsCase of [
  {},
  { ...limits, subscribeTimeout: 0 },
  { ...limits, framesPerSecond: NaN },
]) {
  test(`broker requires complete positive limits ${JSON.stringify(limitsCase)}`, () => {
    expect(() =>
      startSignalingServer({
        hostname: '127.0.0.1',
        port: 0,
        allowedOrigins: [origin],
        authorize: () => true,
        limits: limitsCase,
      } as unknown as SignalingServerOptions),
    ).toThrow('Positive integer broker limits')
  })
}
