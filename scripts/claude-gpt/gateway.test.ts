import { expect, test, vi } from 'vitest'
import { createGateway, waitForProxy } from './gateway'
import { configSchema, startGateway } from './run'
import * as v from 'valibot'

const fullRegistry = { data: [{ id: 'gpt-6.1-sol' }] }

test('cold registry health waits for models while the proxy TCP port already accepts', async () => {
  let registryReads = 0
  const upstream = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request) {
      expect(new URL(request.url).pathname).toBe('/v1/models')
      expect(request.headers.get('authorization')).toBe('Bearer proxy-key')
      registryReads++
      return Response.json(registryReads === 1 ? { data: [] } : fullRegistry)
    },
  })
  const server = startGateway({
    gatewayPort: 0,
    anthropicUrl: 'http://127.0.0.1:1',
    proxyUrl: upstream.url.toString(),
    apiKey: 'proxy-key',
  })
  try {
    const response = await fetch(new URL('/health', server.url))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ready' })
    expect(registryReads).toBeGreaterThanOrEqual(2)
  } finally {
    server.stop(true)
    upstream.stop(true)
  }
})

test('cold registry GPT request waits for models before forwarding', async () => {
  let registryReads = 0
  let modelRequests = 0
  const upstream = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request) {
      if (new URL(request.url).pathname === '/v1/models') {
        registryReads++
        return Response.json(registryReads === 1 ? { data: [] } : fullRegistry)
      }
      modelRequests++
      if (registryReads < 2) {
        return Response.json(
          { error: { message: 'unknown provider for model gpt-6.1-sol' } },
          { status: 400 },
        )
      }
      return Response.json({ ok: true })
    },
  })
  const server = startGateway({
    gatewayPort: 0,
    anthropicUrl: 'http://127.0.0.1:1',
    proxyUrl: upstream.url.toString(),
    apiKey: 'proxy-key',
  })
  try {
    const response = await fetch(new URL('/v1/messages', server.url), {
      method: 'POST',
      headers: { authorization: 'test' },
      body: '{"model":"gpt-6.1-sol"}',
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    expect(modelRequests).toBe(1)
  } finally {
    server.stop(true)
    upstream.stop(true)
  }
})

test('cold registry restart waits and replays unknown provider only once with the same bytes', async () => {
  let warming = false
  let registryReads = 0
  const bodies: string[] = []
  const upstream = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      if (new URL(request.url).pathname === '/v1/models') {
        if (!warming) return Response.json(fullRegistry)
        registryReads++
        return Response.json(registryReads === 1 ? { data: [] } : fullRegistry)
      }
      bodies.push(await request.text())
      if (bodies.length === 1) {
        return Response.json(
          { error: { message: 'unknown provider for model gpt-6.1-sol' } },
          { status: 400 },
        )
      }
      return new Response('event: message_stop\ndata: {"type":"message_stop"}\n\n', {
        headers: { 'content-type': 'text/event-stream' },
      })
    },
  })
  const server = startGateway({
    gatewayPort: 0,
    anthropicUrl: 'http://127.0.0.1:1',
    proxyUrl: upstream.url.toString(),
    apiKey: 'proxy-key',
  })
  const body = '{ "model": "gpt-6.1-sol", "stream": true, "messages": [] }'
  try {
    expect((await fetch(new URL('/health', server.url))).status).toBe(200)
    warming = true
    const response = await fetch(new URL('/v1/messages', server.url), {
      method: 'POST',
      headers: { authorization: 'test' },
      body,
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/event-stream')
    expect(await response.text()).toContain('message_stop')
    expect(registryReads).toBeGreaterThanOrEqual(2)
    expect(bodies).toEqual([body, body])
  } finally {
    server.stop(true)
    upstream.stop(true)
  }
})

test('preserves Claude OAuth, beta headers, request bytes and streaming tool events', async () => {
  const body = '{ "model": "claude-opus-5-5", "stream": true, "messages": [] }'
  const events =
    'event: content_block_start\ndata: {"type":"content_block_start","content_block":{"type":"tool_use","id":"tool-1","name":"Read","input":{}}}\n\n'
  let closeStream: (() => void) | undefined
  let observed: { authorization: string | null; beta: string | null; body: string } | undefined
  const upstream = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      observed = {
        authorization: request.headers.get('authorization'),
        beta: request.headers.get('anthropic-beta'),
        body: await request.text(),
      }
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(events))
            closeStream = () => controller.close()
          },
        }),
        { headers: { 'content-type': 'text/event-stream' } },
      )
    },
  })
  const gateway = createGateway({
    anthropicUrl: upstream.url.toString(),
    proxyUrl: 'http://127.0.0.1:1',
    apiKey: 'proxy-key',
    gatewayPort: 8318,
  })
  try {
    const response = await Promise.race([
      gateway(
        new Request('http://localhost:8318/v1/messages', {
          method: 'POST',
          body,
          headers: {
            host: 'localhost:8318',
            authorization: 'Bearer claude-oauth',
            'anthropic-beta': 'oauth-2025-04-20',
          },
        }),
      ),
      Bun.sleep(500).then(() => new Response('stream timed out', { status: 504 })),
    ])
    expect(response.status).toBe(200)
    expect(observed).toEqual({
      authorization: 'Bearer claude-oauth',
      beta: 'oauth-2025-04-20',
      body,
    })
    expect(response.headers.get('content-type')).toBe('text/event-stream')
    const reader = response.body!.getReader()
    const first = await Promise.race([reader.read(), Bun.sleep(500).then(() => 'timed out')])
    expect(first).not.toBe('timed out')
    expect(new TextDecoder().decode((first as ReadableStreamReadResult<Uint8Array>).value)).toBe(
      events,
    )
    closeStream!()
    closeStream = undefined
    expect((await reader.read()).done).toBe(true)
  } finally {
    closeStream?.()
    upstream.stop(true)
  }
})

test('GPT count_tokens reaches the translator with proxy auth and no Claude credentials', async () => {
  let observed:
    | { auth: string | null; apiKey: string | null; cookie: string | null; path: string }
    | undefined
  const upstream = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request) {
      observed = {
        auth: request.headers.get('authorization'),
        apiKey: request.headers.get('x-api-key'),
        cookie: request.headers.get('cookie'),
        path: new URL(request.url).pathname,
      }
      return Response.json({ input_tokens: 12 })
    },
  })
  const gateway = createGateway({
    anthropicUrl: 'http://127.0.0.1:1',
    proxyUrl: upstream.url.toString(),
    apiKey: 'proxy-key',
    gatewayPort: 8318,
  })
  try {
    const response = await gateway(
      new Request('http://localhost:8318/v1/messages/count_tokens', {
        method: 'POST',
        body: JSON.stringify({ model: 'gpt-6.1-sol', messages: [] }),
        headers: {
          host: 'localhost:8318',
          authorization: 'Bearer claude-oauth',
          'x-api-key': 'claude-key',
          cookie: 'claude-session=secret',
        },
      }),
    )
    expect(observed).toEqual({
      auth: 'Bearer proxy-key',
      apiKey: null,
      cookie: null,
      path: '/v1/messages/count_tokens',
    })
    expect(await response.json()).toEqual({ input_tokens: 12 })
  } finally {
    upstream.stop(true)
  }
})

test('rejects management paths, missing auth, malformed JSON and unsupported models', async () => {
  const gateway = createGateway({
    anthropicUrl: 'http://127.0.0.1:1',
    proxyUrl: 'http://127.0.0.1:1',
    apiKey: 'proxy-key',
    gatewayPort: 8318,
  })
  expect(
    (
      await gateway(
        new Request('http://localhost:8318/v8/management', { headers: { host: 'localhost:8318' } }),
      )
    ).status,
  ).toBe(404)
  expect(
    (
      await gateway(
        new Request('http://localhost:8318/v1/messages', {
          method: 'POST',
          headers: { host: 'localhost:8318' },
        }),
      )
    ).status,
  ).toBe(401)
  const headers = { host: 'localhost:8318', authorization: 'Bearer test' }
  expect(
    (
      await gateway(
        new Request('http://localhost:8318/v1/messages', { method: 'POST', headers, body: '{' }),
      )
    ).status,
  ).toBe(400)
  expect(
    (
      await gateway(
        new Request('http://localhost:8318/v1/messages', {
          method: 'POST',
          headers,
          body: '{"model":"other"}',
        }),
      )
    ).status,
  ).toBe(400)
})

test('rejects rebound Host, Origin and Sec-Fetch-Site on messages and health', async () => {
  const gateway = createGateway({
    anthropicUrl: 'http://127.0.0.1:1',
    proxyUrl: 'http://127.0.0.1:1',
    apiKey: 'proxy-key',
    gatewayPort: 8318,
  })
  for (const path of ['/health', '/v1/messages']) {
    for (const headers of [
      { host: 'attacker.example:8318' },
      { host: '127.0.0.1.attacker.example:8317' },
      {},
      { host: '127.0.0.1:8318', origin: 'null' },
      { host: '127.0.0.1:8318', 'sec-fetch-site': 'same-origin' },
    ]) {
      const response = await gateway(
        new Request(`http://127.0.0.1:8318${path}`, { headers: headers as HeadersInit }),
      )
      expect(response.status).toBe(403)
      expect(await response.json()).toMatchObject({
        type: 'error',
        error: { type: 'permission_error' },
      })
    }
  }
  for (const host of ['127.0.0.1:8318', 'localhost:8318', '[::1]:8318']) {
    expect(
      (await gateway(new Request('http://127.0.0.1:8318/health', { headers: { host } }))).status,
    ).toBe(503)
  }
})

test('Node HTTP client supplies the expected Host without browser markers', async () => {
  let headers: Headers | undefined
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request) {
      headers = request.headers
      return new Response('ok')
    },
  })
  try {
    const client = Bun.spawn(
      [
        'node',
        '-e',
        `require('node:http').get(${JSON.stringify(server.url.toString())}, response => response.resume()).on('error', () => process.exit(1))`,
      ],
      { stdout: 'pipe', stderr: 'pipe' },
    )
    expect(await client.exited).toBe(0)
    expect(headers!.get('host')).toBe(`127.0.0.1:${server.port}`)
    for (const name of ['origin', 'sec-fetch-site', 'sec-fetch-mode'])
      expect(headers!.has(name)).toBe(false)
  } finally {
    server.stop(true)
  }
})

test('health stays unavailable and GPT waits for readiness while Claude proceeds', async () => {
  let requests = 0
  const reservation = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('ok') })
  const proxyPort = reservation.port!
  reservation.stop(true)
  const upstream = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch() {
      requests++
      return Response.json({ ok: true })
    },
  })
  let proxy: ReturnType<typeof Bun.serve> | undefined
  const gateway = createGateway({
    anthropicUrl: upstream.url.toString(),
    proxyUrl: `http://127.0.0.1:${proxyPort}`,
    apiKey: 'proxy-key',
    gatewayPort: 8318,
  })
  const request = (model: string) =>
    new Request('http://127.0.0.1:8318/v1/messages', {
      method: 'POST',
      headers: { host: '127.0.0.1:8318', authorization: 'test' },
      body: JSON.stringify({ model }),
    })
  try {
    expect(
      (
        await gateway(
          new Request('http://127.0.0.1:8318/health', { headers: { host: '127.0.0.1:8318' } }),
        )
      ).status,
    ).toBe(503)
    const gpt = gateway(request('gpt-6.1-sol'))
    expect((await gateway(request('claude-opus-5-5'))).status).toBe(200)
    expect(requests).toBe(1)
    proxy = Bun.serve({
      hostname: '127.0.0.1',
      port: proxyPort,
      fetch() {
        requests++
        return Response.json({ ok: true })
      },
    })
    expect((await gpt).status).toBe(200)
    expect(requests).toBe(2)
    expect(
      (
        await gateway(
          new Request('http://127.0.0.1:8318/health', { headers: { host: '127.0.0.1:8318' } }),
        )
      ).status,
    ).toBe(200)
  } finally {
    proxy?.stop(true)
    upstream.stop(true)
  }
})

test('TCP readiness polls cold proxy startup and gives up with a clear GPT 503', async () => {
  const reservation = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('ok') })
  const port = reservation.port!
  reservation.stop(true)
  const ready = waitForProxy(port, 1000)
  await Bun.sleep(150)
  const upstream = Bun.serve({ hostname: '127.0.0.1', port, fetch: () => new Response('ok') })
  try {
    expect(await ready).toBe(true)
  } finally {
    upstream.stop(true)
  }
  expect(await waitForProxy(port, 50)).toBe(false)
  const gateway = createGateway({
    anthropicUrl: 'http://127.0.0.1:1',
    proxyUrl: `http://127.0.0.1:${port}`,
    apiKey: 'proxy-key',
    gatewayPort: 8318,
  })
  const response = await gateway(
    new Request('http://127.0.0.1:8318/v1/messages', {
      method: 'POST',
      headers: { host: '127.0.0.1:8318', authorization: 'test' },
      body: '{"model":"gpt-6.1-sol"}',
    }),
  )
  expect(response.status).toBe(503)
  expect(await response.json()).toMatchObject({
    type: 'error',
    error: { type: 'api_error', message: expect.stringContaining('proxy') },
  })
})

test('strips fixed and Connection-nominated hop headers in both directions', async () => {
  let observed: Headers | undefined
  const hop = {
    connection: 'x-private-hop, X-Other-Hop',
    'x-private-hop': 'private',
    'x-other-hop': 'other',
    'keep-alive': 'timeout=5',
    'proxy-connection': 'keep-alive',
    te: 'trailers',
    trailer: 'x-trailer',
    upgrade: 'h2c',
    'proxy-authorization': 'private',
    'proxy-authenticate': 'private',
  }
  const upstream = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request) {
      observed = request.headers
      return new Response('ok', { headers: hop })
    },
  })
  const gateway = createGateway({
    anthropicUrl: upstream.url.toString(),
    proxyUrl: upstream.url.toString(),
    apiKey: 'proxy-key',
    gatewayPort: 8318,
  })
  try {
    const response = await gateway(
      new Request('http://localhost:8318/v1/messages', {
        method: 'POST',
        headers: { ...hop, host: 'localhost:8318', authorization: 'test' },
        body: '{"model":"claude-opus-5-5"}',
      }),
    )
    await response.text()
    for (const name of Object.keys(hop).filter((name) => name !== 'connection')) {
      expect(observed!.get(name), name).toBeNull()
      expect(response.headers.get(name), name).toBeNull()
    }
    // fetch may generate its own Connection header after sanitizing the client's one.
    expect(observed!.get('connection')).not.toContain('x-private-hop')
    expect(response.headers.get('connection')).toBeNull()
  } finally {
    upstream.stop(true)
  }
})

test('GPT allowlist preserves Claude affinity while dropping arbitrary credentials', async () => {
  let observed: Headers | undefined
  const upstream = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request) {
      observed = request.headers
      return new Response('ok')
    },
  })
  const kept = {
    'content-type': 'application/json',
    accept: 'application/json',
    'anthropic-version': '2023-06-01',
    'anthropic-beta': 'test-beta',
    'x-claude-code-session-id': 'session',
    'x-claude-code-agent-id': 'agent',
    'x-claude-code-parent-agent-id': 'parent',
  }
  const dropped = {
    'x-auth-key': 'private',
    'x-access-token': 'private',
    'x-secret': 'private',
    'session-key': 'private',
    'x-cookie': 'private',
    'x-arbitrary': 'private',
    'x-api-key': 'private',
    cookie: 'private',
    'proxy-authorization': 'private',
  }
  const gateway = createGateway({
    anthropicUrl: upstream.url.toString(),
    proxyUrl: upstream.url.toString(),
    apiKey: 'proxy-key',
    gatewayPort: 8318,
  })
  try {
    await gateway(
      new Request('http://localhost:8318/v1/messages', {
        method: 'POST',
        headers: { ...kept, ...dropped, host: 'localhost:8318', authorization: 'claude-secret' },
        body: '{"model":"gpt-6.1-sol","metadata":{"user_id":"unchanged"}}',
      }),
    )
    for (const [name, value] of Object.entries(kept)) expect(observed!.get(name), name).toBe(value)
    for (const name of Object.keys(dropped)) expect(observed!.get(name), name).toBeNull()
    expect(observed!.get('authorization')).toBe('Bearer proxy-key')
  } finally {
    upstream.stop(true)
  }
})

test('configuration rejects identical gateway and proxy ports', () => {
  const config = {
    binary: 'proxy',
    proxyConfig: 'config',
    proxyPort: 8317,
    gatewayPort: 8317,
    apiKey: 'test',
  }
  expect(v.safeParse(configSchema, config).success).toBe(false)
  expect(v.safeParse(configSchema, { ...config, gatewayPort: 8318 }).success).toBe(true)
})

test('runtime server enforces the documented 32 MiB Messages body cap', async () => {
  const server = startGateway({
    gatewayPort: 0,
    anthropicUrl: 'http://127.0.0.1:1',
    proxyUrl: 'http://127.0.0.1:1',
    apiKey: 'test',
  })
  try {
    const response = await fetch(new URL('/v1/messages', server.url), {
      method: 'POST',
      headers: { authorization: 'test' },
      body: 'x'.repeat(32 * 1024 * 1024 + 1),
    })
    expect(response.status).toBe(413)
    const atLimit = await fetch(new URL('/v1/messages', server.url), {
      method: 'POST',
      headers: { authorization: 'test' },
      body: 'x'.repeat(32 * 1024 * 1024),
    })
    expect(atLimit.status).toBe(400)
  } finally {
    server.stop(true)
  }
})

test.each(['GPT', 'health'])(
  'late proxy startup recovers via %s and logs give-up/recovery once',
  async (first) => {
    const logs: Record<string, unknown>[] = []
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      logs.push(JSON.parse(String(chunk)))
      return true
    })
    const reservation = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: () => new Response('ok'),
    })
    const port = reservation.port!
    reservation.stop(true)
    const startup = waitForProxy(port, 25)
    const gateway = createGateway({
      gatewayPort: 8318,
      anthropicUrl: 'http://127.0.0.1:1',
      proxyUrl: `http://127.0.0.1:${port}`,
      apiKey: 'test',
    })
    const health = () =>
      new Request('http://127.0.0.1:8318/health', { headers: { host: '127.0.0.1:8318' } })
    const gpt = () =>
      new Request('http://127.0.0.1:8318/v1/messages', {
        method: 'POST',
        headers: { host: '127.0.0.1:8318', authorization: 'test' },
        body: '{"model":"gpt-6.1-sol"}',
      })
    let upstream: ReturnType<typeof Bun.serve> | undefined
    try {
      expect(await startup).toBe(false)
      expect((await gateway(gpt())).status).toBe(503)
      expect((await gateway(health())).status).toBe(503)
      upstream = Bun.serve({
        hostname: '127.0.0.1',
        port,
        fetch: () => Response.json({ ok: true }),
      })
      const recovered = await gateway(first === 'GPT' ? gpt() : health())
      expect(recovered.status).toBe(200)
      await recovered.text()
      expect((await gateway(health())).status).toBe(200)
      expect(await (await gateway(gpt())).json()).toEqual({ ok: true })
      expect(
        logs.map((log) => ({ level: log.level, operation: log.operation, state: log.state })),
      ).toEqual([
        { level: 'warn', operation: 'proxy-readiness', state: 'unavailable' },
        { level: 'info', operation: 'proxy-readiness', state: 'reachable' },
      ])
      expect(logs[1]!.count).toBe(2)
      upstream.stop(true)
      upstream = undefined
      expect((await gateway(health())).status).toBe(200)
      expect(logs).toHaveLength(2)
      for (const log of logs) {
        expect(log).toMatchObject({
          timestamp: expect.any(String),
          source: 'be',
          area: 'claude-gpt',
          fix: expect.any(String),
        })
        expect(JSON.stringify(log)).not.toContain('test')
      }
    } finally {
      upstream?.stop(true)
      stderr.mockRestore()
    }
  },
)

test('Sec-Fetch-Mode alone passes while Origin and Sec-Fetch-Site still fail', async () => {
  const upstream = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: () => Response.json({ ok: true }),
  })
  const gateway = createGateway({
    gatewayPort: 8318,
    anthropicUrl: upstream.url.toString(),
    proxyUrl: upstream.url.toString(),
    apiKey: 'test',
  })
  const headers = { host: '127.0.0.1:8318', authorization: 'test', 'sec-fetch-mode': 'cors' }
  try {
    const response = await gateway(
      new Request('http://127.0.0.1:8318/v1/messages', {
        method: 'POST',
        headers,
        body: '{"model":"claude-opus-5-5"}',
      }),
    )
    expect(response.status).toBe(200)
    const browserMarkers: Record<string, string>[] = [
      { origin: 'http://attacker.example' },
      { 'sec-fetch-site': 'same-origin' },
    ]
    for (const marker of browserMarkers) {
      expect(
        (
          await gateway(
            new Request('http://127.0.0.1:8318/v1/messages', {
              method: 'POST',
              headers: { ...headers, ...marker },
              body: '{"model":"claude-opus-5-5"}',
            }),
          )
        ).status,
      ).toBe(403)
    }
  } finally {
    upstream.stop(true)
  }
})

test('real Node fetch reaches the gateway with undici Sec-Fetch-Mode', async () => {
  const server = startGateway({
    gatewayPort: 0,
    anthropicUrl: 'http://127.0.0.1:1',
    proxyUrl: 'http://127.0.0.1:1',
    apiKey: 'test',
  })
  const endpoint = new URL('/v1/messages', server.url).toString()
  // A malformed body proves admission without reaching a provider.
  try {
    const client = Bun.spawn(
      [
        'node',
        '-e',
        `fetch(${JSON.stringify(endpoint)}, {method:'POST', headers:{authorization:'test','sec-fetch-mode':'cors'}, body:'{'}).then(async response => { console.log(response.status); console.log(await response.text()) }).catch(() => process.exit(1))`,
      ],
      { stdout: 'pipe', stderr: 'pipe' },
    )
    const output = await new Response(client.stdout).text()
    expect(await client.exited).toBe(0)
    expect(output).toContain('400\n')
    expect(output).toContain('invalid_request_error')
  } finally {
    server.stop(true)
  }
})

test('loopback Host matching tolerates changed ports, casing, trailing dot and missing port', async () => {
  const upstream = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('ok') })
  const gateway = createGateway({
    gatewayPort: 45001,
    anthropicUrl: upstream.url.toString(),
    proxyUrl: upstream.url.toString(),
    apiKey: 'test',
  })
  try {
    for (const host of [
      '127.0.0.1:45002',
      '127.0.0.1',
      '127.0.0.1.:80',
      'localhost:45002',
      'LOCALHOST:45002',
      'localhost.',
      'LOCALHOST.:443',
      '[::1]:45002',
      '[::1]',
    ]) {
      expect(
        (await gateway(new Request('http://127.0.0.1:45001/health', { headers: { host } }))).status,
        host,
      ).toBe(200)
    }
    for (const host of [
      'localhost.attacker.example',
      '127.0.0.1.attacker.example',
      'localhost:45002,localhost:45001',
      '[::ffff:127.0.0.1]:45002',
      'user@localhost:45002',
      'localhost/path',
      'localhost:bad',
    ]) {
      expect(
        (await gateway(new Request('http://127.0.0.1:45001/health', { headers: { host } }))).status,
        host,
      ).toBe(403)
    }
  } finally {
    upstream.stop(true)
  }
})
