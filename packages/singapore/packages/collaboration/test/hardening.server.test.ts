import { beforeAll, expect, test } from 'vitest'
import { memberAdmission } from '../examples/signaling-server'
import { startSignalingServer, type SignalingServerOptions } from '../server/signaling'
import { probe, type BrokerProbe } from './broker-probe'

const options = {
  hostname: '127.0.0.1',
  port: 0,
  allowedOrigins: ['http://collaboration.test'],
  authorize: () => true,
  limits: {
    connections: 32,
    connectionsPerIP: 2,
    connectionsPerMember: 16,
    subscribeTimeout: 10_000,
    idleTimeout: 30_000,
    framesPerSecond: 64,
    bytesPerSecond: 2 * 1024 * 1024,
  },
}

let distinctLoopback = true
beforeAll(async () => {
  const server = startSignalingServer(options)
  try {
    const client = await probe(server.port!, '127.0.0.2')
    client.socket.destroy()
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'EADDRNOTAVAIL')
      distinctLoopback = false
    else throw error
  } finally {
    await server.stop(true)
  }
})

async function subscribe(client: BrokerProbe, topic = crypto.randomUUID()) {
  client.send({ type: 'subscribe', topic })
  await expect.poll(() => client.messages[0]).toEqual({ type: 'subscribed', topic })
  return topic
}

async function withBroker(
  configuration: SignalingServerOptions,
  run: (port: number, clients: BrokerProbe[]) => Promise<void>,
) {
  const server = startSignalingServer(configuration)
  const clients: BrokerProbe[] = []
  try {
    await run(server.port!, clients)
  } finally {
    for (const client of clients) client.socket.destroy()
    await server.stop(true)
  }
}

test('admission tokens never appear in any response header', async () => {
  const token = 'private-admission-token'
  await withBroker(
    {
      ...options,
      authorize: (request) =>
        request.headers.get('sec-websocket-protocol')?.includes(token) === true,
    },
    async (port, clients) => {
      const accepted = await probe(port, '127.0.0.1', {
        'Sec-WebSocket-Protocol': `${token}, singapore-collaboration`,
      })
      clients.push(accepted)
      expect(accepted.status).toBe(101)
      expect(accepted.headers).not.toContain(token)
      expect(accepted.headers).toMatch(/sec-websocket-protocol: singapore-collaboration\r?$/im)
      await subscribe(accepted)
      const rejected = await probe(port, '127.0.0.1', {
        'Sec-WebSocket-Protocol': token,
      })
      clients.push(rejected)
      expect(rejected.headers).not.toContain(token)
      expect(rejected.status).toBe(400)
    },
  )
})

test('forwarded headers stay untrusted without an address hook', async () => {
  await withBroker(options, async (port, clients) => {
    for (let index = 0; index < 3; index++) {
      const client = await probe(port, '127.0.0.1', {
        'X-Forwarded-For': `192.0.2.${index + 1}`,
        Forwarded: `for=192.0.2.${index + 1}`,
        'X-Real-IP': `192.0.2.${index + 1}`,
      })
      clients.push(client)
      expect(client.status).toBe(index < 2 ? 101 : 429)
    }
  })
})

test('trusted proxies opt into client addresses and keep their per-address quotas', async () => {
  await withBroker(
    {
      ...options,
      clientAddress: (request, server) =>
        server.requestIP(request)?.address === '127.0.0.1'
          ? (request.headers.get('x-forwarded-for') ?? undefined)
          : server.requestIP(request)?.address,
    },
    async (port, clients) => {
      for (const [address, status] of [
        ['192.0.2.1', 101],
        ['192.0.2.1', 101],
        ['192.0.2.1', 429],
        ['192.0.2.2', 101],
        ['192.0.2.2', 101],
      ] as const) {
        const client = await probe(port, '127.0.0.1', { 'X-Forwarded-For': address })
        clients.push(client)
        expect(client.status).toBe(status)
      }
    },
  )
})

for (const prefix of [undefined, 48, 63, 128]) {
  test(`IPv6 limits group canonical client addresses by prefix ${prefix ?? 64}`, async () => {
    await withBroker(
      {
        ...options,
        ipv6Prefix: prefix,
        clientAddress: (request) => request.headers.get('x-client-address') ?? undefined,
      },
      async (port, clients) => {
        const overflowing =
          new Map([
            [48, '2001:db8:1234:2::3'],
            [63, '2001:db8:1234:0::3'],
          ]).get(prefix ?? 64) ?? '2001:db8:1234:1::3'
        const addresses =
          prefix === 128
            ? ['2001:db8::1', '2001:0db8:0:0:0:0:0:1', '2001:db8::1', '2001:db8::2']
            : [
                '2001:db8:1234:1::1',
                '2001:0db8:1234:0001::2',
                overflowing,
                prefix === 48 ? '2001:db8:1235::1' : '2001:db8:1234:2::1',
              ]
        for (const [index, address] of addresses.entries()) {
          const client = await probe(port, '127.0.0.1', { 'X-Client-Address': address })
          clients.push(client)
          expect(client.status).toBe(index === 2 ? 429 : 101)
        }
      },
    )
  })
}

test('one admitted member cannot consume total capacity from many socket addresses', async (context) => {
  if (!distinctLoopback) context.skip('This host cannot bind distinct 127.0.0.x client addresses')
  await withBroker(
    {
      ...options,
      authorize: (request) =>
        request.headers.has('x-test-member')
          ? { member: request.headers.get('x-test-member')! }
          : { member: 'attacker' },
      limits: { ...options.limits, connections: 8, connectionsPerMember: 4 },
    },
    async (port, clients) => {
      for (let index = 0; index < 8; index++) {
        const client = await probe(port, `127.0.0.${index + 2}`)
        clients.push(client)
        expect(client.status).toBe(index < 4 ? 101 : 429)
        if (index < 4) await subscribe(client)
      }
      const topic = crypto.randomUUID()
      for (let index = 0; index < 2; index++) {
        const client = await probe(port, `127.0.0.${index + 20}`, { 'X-Test-Member': 'legitimate' })
        clients.push(client)
        expect(client.status).toBe(101)
        await subscribe(client, topic)
      }
      clients.at(-2)!.send({ type: 'publish', topic, payload: 'still-relays' })
      await expect
        .poll(() => clients.at(-1)!.messages[1])
        .toEqual({ type: 'publish', topic, payload: 'still-relays' })
      clients[0]!.socket.destroy()
      await expect
        .poll(async () => {
          const retry = await probe(port, '127.0.0.30')
          clients.push(retry)
          return retry.status
        })
        .toBe(101)
    },
  )
})

test('room capacity follows a configured connection limit above 1024', async () => {
  await withBroker(
    {
      ...options,
      limits: {
        ...options.limits,
        connections: 1025,
        connectionsPerIP: 1025,
        connectionsPerMember: 1025,
      },
    },
    async (port, clients) => {
      for (let start = 0; start < 1025; start += 32) {
        const batch = await Promise.all(
          Array.from({ length: Math.min(32, 1025 - start) }, () => probe(port, '127.0.0.1')),
        )
        clients.push(...batch)
        for (const client of batch) expect(client.status).toBe(101)
        await Promise.all(batch.map((client) => subscribe(client)))
      }
      expect(clients).toHaveLength(1025)
    },
  )
}, 30_000)

test('mapped IPv6 and IPv4 addresses share one quota', async () => {
  await withBroker(
    {
      ...options,
      clientAddress: (request) => request.headers.get('x-client-address') ?? undefined,
    },
    async (port, clients) => {
      for (const [index, address] of [
        '192.0.2.1',
        '::ffff:c000:201',
        '::ffff:192.0.2.1',
        '192.0.2.2',
      ].entries()) {
        const client = await probe(port, '127.0.0.1', { 'X-Client-Address': address })
        clients.push(client)
        expect(client.status).toBe(index === 2 ? 429 : 101)
      }
    },
  )
})

for (const ipv6Prefix of [-1, 129, 63.5, NaN]) {
  test(`invalid IPv6 prefix ${ipv6Prefix} is refused at startup`, () => {
    let server: ReturnType<typeof startSignalingServer> | undefined
    try {
      expect(() => {
        server = startSignalingServer({ ...options, ipv6Prefix })
      }).toThrow('IPv6 prefix')
    } finally {
      server?.stop(true)
    }
  })
}

for (const connectionsPerMember of [0, -1, 1.5, NaN]) {
  test(`invalid per-member limit ${connectionsPerMember} is refused at startup`, () => {
    let server: ReturnType<typeof startSignalingServer> | undefined
    try {
      expect(() => {
        server = startSignalingServer({
          ...options,
          limits: { ...options.limits, connectionsPerMember },
        })
      }).toThrow('per-member limit')
    } finally {
      server?.stop(true)
    }
  })
}

test('address hooks fail closed on missing and invalid addresses', async () => {
  await withBroker(
    {
      ...options,
      clientAddress: (request) => request.headers.get('x-client-address') ?? undefined,
    },
    async (port, clients) => {
      for (const address of ['', 'anything', '192.0.2.1, 192.0.2.2']) {
        const client = await probe(port, '127.0.0.1', { 'X-Client-Address': address })
        clients.push(client)
        expect(client.status).toBe(403)
      }
    },
  )
})

test('shared-token admission uses address quotas without a pooled member quota', async () => {
  const token = 'shared-test-token'
  await withBroker(
    {
      ...options,
      clientAddress: (request) => request.headers.get('x-client-address') ?? undefined,
      authorize: (request) =>
        request.headers
          .get('sec-websocket-protocol')
          ?.split(',')
          .some((value) => value.trim() === token) === true,
      limits: { ...options.limits, connections: 4, connectionsPerMember: 1 },
    },
    async (port, clients) => {
      for (const [address, status] of [
        ['192.0.2.1', 101],
        ['192.0.2.1', 101],
        ['192.0.2.1', 429],
        ['192.0.2.2', 101],
        ['192.0.2.2', 101],
        ['192.0.2.3', 429],
      ] as const) {
        const client = await probe(port, '127.0.0.1', {
          'X-Client-Address': address,
          'Sec-WebSocket-Protocol': `singapore-collaboration, ${token}`,
        })
        clients.push(client)
        expect(client.status).toBe(status)
      }
    },
  )
})

test('one example member at its quota leaves another authenticated member capacity', async () => {
  const aliceToken = 'a'.repeat(43)
  const bobToken = 'b'.repeat(43)
  await withBroker(
    {
      ...options,
      authorize: memberAdmission(`alice ${aliceToken}\nbob ${bobToken}`),
      limits: { ...options.limits, connectionsPerIP: 32 },
    },
    async (port, clients) => {
      for (let index = 0; index < 17; index++) {
        const client = await probe(port, '127.0.0.1', {
          'Sec-WebSocket-Protocol': `singapore-collaboration, ${aliceToken}`,
          'X-Test-Member': 'bob',
        })
        clients.push(client)
        expect(client.status).toBe(index < 16 ? 101 : 429)
        if (index < 16) await subscribe(client)
      }
      const bob = await probe(port, '127.0.0.1', {
        'Sec-WebSocket-Protocol': `singapore-collaboration, ${bobToken}`,
      })
      clients.push(bob)
      expect(bob.status).toBe(101)
      expect(bob.headers).not.toContain(bobToken)
      await subscribe(bob)
    },
  )
})

test('example admission rejects a shared-token file at startup', () => {
  expect(() => memberAdmission('a'.repeat(43))).toThrow('member token')
})

test('example admission binds verified tokens to configured member identities', () => {
  const token = 'a'.repeat(43)
  const authorize = memberAdmission(`alice ${token}`)
  expect(
    authorize(
      new Request('http://collaboration.test', {
        headers: {
          'Sec-WebSocket-Protocol': `singapore-collaboration, ${token}`,
          'X-Test-Member': 'bob',
        },
      }),
    ),
  ).toEqual({ member: 'alice' })
  expect(
    authorize(
      new Request('http://collaboration.test', {
        headers: { 'Sec-WebSocket-Protocol': `singapore-collaboration, ${'b'.repeat(43)}` },
      }),
    ),
  ).toBe(false)
  expect(authorize(new Request('http://collaboration.test'))).toBe(false)
})

for (const [name, contents] of [
  ['empty file', ''],
  ['short token', 'alice short'],
  ['invalid member', `alice@example.com ${'a'.repeat(43)}`],
  ['extra field', `alice ${'a'.repeat(43)} extra`],
  ['duplicate member', `alice ${'a'.repeat(43)}\nalice ${'b'.repeat(43)}`],
  ['duplicate token', `alice ${'a'.repeat(43)}\nbob ${'a'.repeat(43)}`],
] as const) {
  test(`example admission refuses ${name}`, () => {
    expect(() => memberAdmission(contents)).toThrow('member token')
  })
}
