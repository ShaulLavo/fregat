import './run.test'
import './credits.test'
import './producer-retirement-deploy.test'
import { expect, test, vi } from 'vitest'
import { createGateway, waitForProxy } from './gateway'
import { configSchema, startGateway } from './run'
import * as v from 'valibot'
import { chmod, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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

test.each(['boot', 'long-running'])(
  'cold registry restart in a %s gateway waits and replays unknown provider once with the same bytes',
  async (age) => {
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
    const now = performance.now.bind(performance)
    let clock: ReturnType<typeof vi.spyOn> | undefined
    try {
      expect((await fetch(new URL('/health', server.url))).status).toBe(200)
      if (age === 'long-running')
        clock = vi.spyOn(performance, 'now').mockImplementation(() => now() + 60_000)
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
      clock?.mockRestore()
      server.stop(true)
      upstream.stop(true)
    }
  },
)

test.each([
  {
    name: 'missing model',
    model: 'gpt-missing',
    message: 'unknown provider for model gpt-missing',
    attempts: 1,
    expected: 'absent from the loaded proxy registry',
    old: false,
  },
  {
    name: 'persistent provider error',
    model: 'gpt-6.1-sol',
    message: 'unknown provider for model gpt-6.1-sol',
    attempts: 2,
    expected: 'unknown provider for model gpt-6.1-sol',
    old: false,
  },
  {
    name: 'other invalid request',
    model: 'gpt-6.1-sol',
    message: 'invalid token budget',
    attempts: 1,
    expected: 'invalid token budget',
    old: false,
  },
  {
    name: 'loaded registry beyond the startup window',
    model: 'gpt-6.1-sol',
    message: 'unknown provider for model gpt-6.1-sol',
    attempts: 1,
    expected: 'unknown provider for model gpt-6.1-sol',
    old: true,
  },
])(
  'registry recovery preserves $name with bounded attempts',
  async (scenario) => {
    let attempts = 0
    const upstream = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch(request) {
        if (new URL(request.url).pathname === '/v1/models') return Response.json(fullRegistry)
        attempts++
        return Response.json({ error: { message: scenario.message } }, { status: 400 })
      },
    })
    const server = startGateway({
      gatewayPort: 0,
      anthropicUrl: 'http://127.0.0.1:1',
      proxyUrl: upstream.url.toString(),
      apiKey: 'test',
    })
    const now = performance.now.bind(performance)
    let clock: ReturnType<typeof vi.spyOn> | undefined
    try {
      expect((await fetch(new URL('/health', server.url))).status).toBe(200)
      if (scenario.old)
        clock = vi.spyOn(performance, 'now').mockImplementation(() => now() + 16_000)
      const started = now()
      const response = await fetch(new URL('/v1/messages', server.url), {
        method: 'POST',
        headers: { authorization: 'test' },
        body: JSON.stringify({ model: scenario.model }),
      })
      expect(response.status).toBe(400)
      expect(await response.text()).toContain(scenario.expected)
      expect(attempts).toBe(scenario.attempts)
      if (scenario.model === 'gpt-missing') expect(now() - started).toBeGreaterThanOrEqual(14_000)
    } finally {
      clock?.mockRestore()
      server.stop(true)
      upstream.stop(true)
    }
  },
  20_000,
)

test.each(['empty', 'Claude only', 'malformed', 'invalid JSON', 'unauthorized', 'hung body'])(
  'registry readiness gives up within its deadline for %s',
  async (state) => {
    const upstream = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch() {
        if (state === 'invalid JSON') return new Response('{')
        if (state === 'unauthorized') return new Response('denied', { status: 401 })
        if (state === 'hung body') {
          return new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new TextEncoder().encode('{'))
              },
            }),
          )
        }
        if (state === 'malformed') return Response.json({ data: [{ id: 1 }] })
        if (state === 'Claude only') return Response.json({ data: [{ id: 'claude-opus-5-5' }] })
        return Response.json({ data: [] })
      },
    })
    const start = performance.now()
    try {
      expect(
        await waitForProxy({ proxyUrl: upstream.url.toString(), apiKey: 'test' }, 50),
      ).toBeNull()
      expect(performance.now() - start).toBeLessThan(500)
    } finally {
      upstream.stop(true)
    }
  },
)

test('registry recovery gives up when the restart window expires without replaying', async () => {
  let warming = false
  let registryReads = 0
  let attempts = 0
  let offset = 0
  const now = performance.now.bind(performance)
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => now() + offset)
  const logs: Record<string, unknown>[] = []
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    logs.push(JSON.parse(String(chunk)))
    return true
  })
  const upstream = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request) {
      if (new URL(request.url).pathname === '/v1/models') {
        if (!warming) return Response.json(fullRegistry)
        registryReads++
        if (registryReads === 2) offset = 16_000
        return Response.json({ data: [] })
      }
      attempts++
      return Response.json(
        { error: { message: 'unknown provider for model gpt-6.1-sol' } },
        { status: 400 },
      )
    },
  })
  const gateway = createGateway({
    gatewayPort: 8318,
    anthropicUrl: 'http://127.0.0.1:1',
    proxyUrl: upstream.url.toString(),
    apiKey: 'test',
  })
  try {
    expect(
      (
        await gateway(
          new Request('http://localhost:8318/health', { headers: { host: 'localhost:8318' } }),
        )
      ).status,
    ).toBe(200)
    warming = true
    const response = await gateway(
      new Request('http://localhost:8318/v1/messages', {
        method: 'POST',
        headers: { host: 'localhost:8318', authorization: 'test' },
        body: '{"model":"gpt-6.1-sol"}',
      }),
    )
    expect(response.status).toBe(503)
    expect(await response.text()).toContain('startup wait')
    expect(attempts).toBe(1)
    expect(registryReads).toBe(2)
    expect(logs.at(-1)).toMatchObject({ level: 'warn', state: 'gave-up', timeoutMs: 15_000 })
  } finally {
    clock.mockRestore()
    stderr.mockRestore()
    upstream.stop(true)
  }
})

test('registry polling honors cancellation', async () => {
  let reads = 0
  const controller = new AbortController()
  const upstream = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch() {
      reads++
      controller.abort()
      return Response.json({ data: [] })
    },
  })
  try {
    expect(
      await waitForProxy(
        { proxyUrl: upstream.url.toString(), apiKey: 'test' },
        15_000,
        controller.signal,
      ),
    ).toBeNull()
    expect(reads).toBe(1)
  } finally {
    upstream.stop(true)
  }
})

test.each([
  { entry: 'source', state: 'ready' },
  { entry: 'bundle', state: 'ready' },
  { entry: 'source', state: 'empty' },
  { entry: 'source', state: 'unauthorized' },
  { entry: 'source', state: 'stubborn' },
  { entry: 'source', state: 'occupied' },
  { entry: 'source', state: 'exit' },
])(
  'runner review $entry $state serves Claude independently and cleans up its child',
  async (scenario) => {
    const dir = await mkdtemp(join(tmpdir(), 'gateway-cold-start-'))
    const proxyReservation = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: () => new Response('ok'),
    })
    const gatewayReservation = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: () => new Response('ok'),
    })
    const proxyPort = proxyReservation.port!
    const gatewayPort = gatewayReservation.port!
    proxyReservation.stop(true)
    if (scenario.state !== 'occupied') gatewayReservation.stop(true)
    const pidFile = join(dir, 'pid')
    const release = join(dir, 'release')
    const probed = join(dir, 'probed')
    const binary = join(dir, 'proxy')
    const config = join(dir, 'config.json')
    const proxyConfig = join(dir, 'fixture.json')
    await Bun.write(
      binary,
      `#!${process.execPath}
const config = await Bun.file(Bun.argv[3]).json()
if (config.state === 'exit') process.exit(7)
await Bun.write(config.pidFile, String(process.pid))
if (config.state === 'stubborn') process.on('SIGTERM', () => {})
Bun.serve({ hostname: '127.0.0.1', port: config.port, async fetch(request) {
  if (new URL(request.url).pathname.startsWith('/claude/')) return new Response('Claude fixture')
  await Bun.write(config.probed, 'probed')
  if (config.state === 'unauthorized') return new Response('denied', { status: 401 })
  const ready = ['stubborn', 'occupied'].includes(config.state) || await Bun.file(config.release).exists()
  return Response.json(ready ? { data: [{ id: 'gpt-6.1-sol' }] } : { data: [] })
} })
`,
    )
    await chmod(binary, 0o700)
    await Bun.write(
      proxyConfig,
      JSON.stringify({ port: proxyPort, release, probed, pidFile, state: scenario.state }),
    )
    await Bun.write(
      config,
      JSON.stringify({ binary, proxyConfig, proxyPort, gatewayPort, apiKey: 'test' }),
    )
    let entry = join(import.meta.dirname, 'run.ts')
    if (scenario.entry === 'bundle') {
      const build = await Bun.build({
        entrypoints: [entry],
        target: 'bun',
        outdir: dir,
        naming: 'gateway.js',
      })
      expect(build.success).toBe(true)
      entry = build.outputs[0]!.path
    }
    const preload = join(dir, 'provider-fixture.ts')
    await Bun.write(
      preload,
      `const original = globalThis.fetch
const proxy = 'http://127.0.0.1:${proxyPort}'
globalThis.fetch = (input, init) => {
  const url = new URL(String(input))
  if (url.hostname === 'api.anthropic.com') return original(proxy + '/claude' + url.pathname, init)
  return original(input, init)
}
`,
    )
    const child = Bun.spawn([process.execPath, '--preload', preload, entry, config], {
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const endpoint = `http://127.0.0.1:${gatewayPort}/health`
    try {
      if (scenario.state === 'exit') {
        expect(await child.exited).toBe(7)
        await expect(fetch(endpoint)).rejects.toBeDefined()
        return
      }
      if (scenario.state === 'occupied') {
        expect(await child.exited).toBe(1)
        await expect(fetch(`http://127.0.0.1:${proxyPort}/v1/models`)).rejects.toBeDefined()
        return
      }
      let status = 0
      const deadline = performance.now() + 2_000
      while (status === 0 && performance.now() < deadline) {
        status = await fetch(endpoint)
          .then((response) => response.status)
          .catch(() => 0)
        if (status === 0) await Bun.sleep(10)
      }
      expect(status).toBe(scenario.state === 'stubborn' ? 200 : 503)
      expect(await Bun.file(probed).exists()).toBe(true)
      const claude = await fetch(endpoint.replace('/health', '/v1/messages'), {
        method: 'POST',
        headers: { authorization: 'test' },
        body: '{"model":"claude-opus-5-5"}',
      })
      expect(await claude.text()).toBe('Claude fixture')
      expect(claude.status).toBe(200)
      if (scenario.state === 'stubborn') {
        child.kill('SIGTERM')
        const exited = await Promise.race([child.exited, Bun.sleep(3_000).then(() => 'hung')])
        expect(exited).not.toBe('hung')
        await expect(fetch(`http://127.0.0.1:${proxyPort}/v1/models`)).rejects.toBeDefined()
        return
      }
      if (scenario.state === 'empty') {
        const gpt = await fetch(endpoint.replace('/health', '/v1/messages'), {
          method: 'POST',
          headers: { authorization: 'test' },
          body: '{"model":"gpt-6.1-sol"}',
        })
        expect(gpt.status).toBe(503)
        expect(child.exitCode).toBeNull()
        const stillClaude = await fetch(endpoint.replace('/health', '/v1/messages'), {
          method: 'POST',
          headers: { authorization: 'test' },
          body: '{"model":"claude-opus-5-5"}',
        })
        expect(stillClaude.status).toBe(200)
        expect(await stillClaude.text()).toBe('Claude fixture')
        const stderr = new Response(child.stderr).text()
        child.kill('SIGTERM')
        await child.exited
        expect(await stderr).toContain('gave-up')
        return
      }
      if (scenario.state === 'unauthorized') {
        expect(child.exitCode).toBeNull()
        return
      }
      await Bun.write(release, 'ready')
      expect((await fetch(endpoint)).status).toBe(200)
      expect(child.exitCode).toBeNull()
    } finally {
      if (child.exitCode === null) child.kill('SIGKILL')
      await child.exited
      if (await Bun.file(pidFile).exists()) {
        try {
          process.kill(Number(await Bun.file(pidFile).text()), 'SIGKILL')
        } catch {}
      }
      gatewayReservation.stop(true)
      await rm(dir, { recursive: true, force: true })
    }
  },
  20_000,
)

test('Claude requests go direct with Claude OAuth, beta headers, request bytes and streaming tool events', async () => {
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
      if (new URL(request.url).pathname === '/v1/models') return Response.json(fullRegistry)
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
      fetch(request) {
        if (new URL(request.url).pathname === '/v1/models') return Response.json(fullRegistry)
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

test('registry readiness polls cold proxy startup and gives up with a clear GPT 503', async () => {
  const reservation = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('ok') })
  const port = reservation.port!
  reservation.stop(true)
  const options = { proxyUrl: `http://127.0.0.1:${port}`, apiKey: 'proxy-key' }
  const ready = waitForProxy(options, 1000)
  await Bun.sleep(150)
  const upstream = Bun.serve({
    hostname: '127.0.0.1',
    port,
    fetch: () => Response.json(fullRegistry),
  })
  try {
    expect(await ready).toEqual(['gpt-6.1-sol'])
  } finally {
    upstream.stop(true)
  }
  expect(await waitForProxy(options, 50)).toBeNull()
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
      signal: AbortSignal.timeout(50),
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
      if (new URL(request.url).pathname === '/v1/models') return Response.json(fullRegistry)
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
    const startup = waitForProxy({ proxyUrl: `http://127.0.0.1:${port}`, apiKey: 'test' }, 25)
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
        signal: AbortSignal.timeout(50),
      })
    let upstream: ReturnType<typeof Bun.serve> | undefined
    try {
      expect(await startup).toBeNull()
      expect((await gateway(gpt())).status).toBe(503)
      expect((await gateway(health())).status).toBe(503)
      upstream = Bun.serve({
        hostname: '127.0.0.1',
        port,
        fetch: (request) =>
          Response.json(
            new URL(request.url).pathname === '/v1/models' ? fullRegistry : { ok: true },
          ),
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
      expect((await gateway(health())).status).toBe(503)
      expect(logs).toHaveLength(3)
      expect(logs[2]!.state).toBe('unavailable')
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
  const upstream = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: () => Response.json(fullRegistry),
  })
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

test('review startup accepts a healthy 300 ms catalog within the overall budget', async () => {
  const upstream = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch() {
      await Bun.sleep(300)
      return Response.json(fullRegistry)
    },
  })
  try {
    expect(
      await waitForProxy({ proxyUrl: upstream.url.toString(), apiKey: 'test' }, 1_000),
    ).toEqual(['gpt-6.1-sol'])
  } finally {
    upstream.stop(true)
  }
})

test.each(['initial', 'recovery', 'long-running', 'slow-recovery'])(
  'review %s waits through a partially loaded GPT catalog',
  async (phase) => {
    let warming = phase === 'initial'
    let reads = 0
    const bodies: string[] = []
    const upstream = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(request) {
        if (new URL(request.url).pathname === '/v1/models') {
          if (!warming) return Response.json(fullRegistry)
          if (phase === 'slow-recovery') await Bun.sleep(300)
          reads++
          return Response.json(reads < 3 ? { data: [{ id: 'gpt-older' }] } : fullRegistry)
        }
        bodies.push(await request.text())
        if (reads < 3)
          return Response.json(
            { error: { message: 'unknown provider for model gpt-6.1-sol' } },
            { status: 400 },
          )
        return new Response('ready')
      },
    })
    const server = startGateway({
      gatewayPort: 0,
      anthropicUrl: 'http://127.0.0.1:1',
      proxyUrl: upstream.url.toString(),
      apiKey: 'test',
    })
    const body = '{ "model": "gpt-6.1-sol", "messages": [] }'
    const now = performance.now.bind(performance)
    let clock: ReturnType<typeof vi.spyOn> | undefined
    try {
      if (phase !== 'initial') {
        expect((await fetch(new URL('/health', server.url))).status).toBe(200)
        warming = true
      }
      if (phase === 'long-running')
        clock = vi.spyOn(performance, 'now').mockImplementation(() => now() + 60_000)
      const response = await fetch(new URL('/v1/messages', server.url), {
        method: 'POST',
        headers: { authorization: 'test' },
        body,
      })
      expect(response.status).toBe(200)
      expect(await response.text()).toBe('ready')
      expect(reads).toBe(3)
      expect(bodies).toEqual(phase === 'initial' ? [body] : [body, body])
    } finally {
      clock?.mockRestore()
      server.stop(true)
      upstream.stop(true)
    }
  },
)

test.each([
  { model: 'gpt-6.1-sol(high)', listed: 'gpt-6.1-sol' },
  { model: 'gpt-6.1-sol(8192)', listed: 'gpt-6.1-sol' },
  { model: 'gpt-6.1-sol (high)', listed: 'gpt-6.1-sol' },
  { model: 'gpt-custom(nested)(high)', listed: 'gpt-custom(nested)' },
  { model: 'gpt-custom(high)', listed: 'gpt-custom(high)' },
])(
  'review recovery canonicalizes $model while preserving original bytes',
  async ({ model, listed }) => {
    const bodies: string[] = []
    const upstream = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(request) {
        if (new URL(request.url).pathname === '/v1/models')
          return Response.json({ data: [{ id: listed }] })
        bodies.push(await request.text())
        if (bodies.length === 1)
          return Response.json(
            { error: { message: 'unknown provider for model ' + model } },
            { status: 400 },
          )
        return new Response('ready')
      },
    })
    const server = startGateway({
      gatewayPort: 0,
      anthropicUrl: 'http://127.0.0.1:1',
      proxyUrl: upstream.url.toString(),
      apiKey: 'test',
    })
    const body = `{ "model": ${JSON.stringify(model)}, "messages": [] }`
    try {
      const response = await fetch(new URL('/v1/messages', server.url), {
        method: 'POST',
        headers: { authorization: 'test' },
        body,
        signal: AbortSignal.timeout(2_000),
      })
      expect(response.status).toBe(200)
      expect(bodies).toEqual([body, body])
    } finally {
      server.stop(true)
      upstream.stop(true)
    }
  },
)

test.each(['open', 'oversized'])(
  'review bounds %s GPT error inspection and cancels without replay',
  async (state) => {
    let attempts = 0
    let canceled = false
    const upstream = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch(request) {
        if (new URL(request.url).pathname === '/v1/models') return Response.json(fullRegistry)
        attempts++
        return new Response(
          new ReadableStream({
            start(controller) {
              const prefix = '{"error":{"message":"unknown provider for model gpt-6.1-sol"}}'
              controller.enqueue(
                new TextEncoder().encode(
                  state === 'open' ? prefix : prefix + ' '.repeat(128 * 1024),
                ),
              )
            },
            cancel() {
              canceled = true
            },
          }),
          { status: 400 },
        )
      },
    })
    const server = startGateway({
      gatewayPort: 0,
      anthropicUrl: 'http://127.0.0.1:1',
      proxyUrl: upstream.url.toString(),
      apiKey: 'test',
    })
    try {
      const result = await Promise.race([
        fetch(new URL('/v1/messages', server.url), {
          method: 'POST',
          headers: { authorization: 'test' },
          body: '{"model":"gpt-6.1-sol"}',
          signal: AbortSignal.timeout(3_000),
        }),
        Bun.sleep(2_000).then(() => null),
      ])
      expect(result?.status).toBe(502)
      expect(await result?.text()).toContain('inspection limit')
      const deadline = performance.now() + 500
      while (!canceled && performance.now() < deadline) await Bun.sleep(10)
      expect(canceled).toBe(true)
      expect(attempts).toBe(1)
    } finally {
      server.stop(true)
      upstream.stop(true)
    }
  },
)

test('README guards every runner stop and names its owned Codex proxy restart', async () => {
  const readme = await Bun.file(join(import.meta.dirname, 'README.md')).text()
  const lines = readme.split('\n')
  const stopLines = lines.flatMap((line, index) =>
    line.includes('mesh serve stop /ai') ? [index] : [],
  )
  expect(stopLines.length).toBeGreaterThan(0)
  for (const index of stopLines)
    expect(lines.slice(Math.max(0, index - 1), index + 1).join('\n')).toContain(
      'wait until no agents are mid-request',
    )
  expect(readme).toContain('respawns its owned Codex proxy')
  expect(readme).toContain('"claudePoolEntrypoints": []')
})

test.each(['missing', 'unavailable'])(
  'catalog deadline distinguishes slow model absence from %s readiness',
  async (state) => {
    let reads = 0
    const upstream = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch() {
        reads++
        if (state === 'unavailable' && reads > 1) return new Response('denied', { status: 401 })
        await Bun.sleep(300)
        return Response.json(fullRegistry)
      },
    })
    const started = performance.now()
    try {
      const models = await waitForProxy(
        { proxyUrl: upstream.url.toString(), apiKey: 'test' },
        1_000,
        undefined,
        'gpt-missing',
      )
      expect(models).toEqual(state === 'missing' ? ['gpt-6.1-sol'] : null)
      expect(reads).toBeGreaterThan(1)
      expect(performance.now() - started).toBeGreaterThanOrEqual(900)
      expect(performance.now() - started).toBeLessThan(1_500)
    } finally {
      upstream.stop(true)
    }
  },
)
