import { createServer, request, type IncomingMessage, type ServerResponse } from 'node:http'
import { once } from 'node:events'
import { connect } from 'node:net'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { http, passthrough } from 'msw'
import { test, expect } from '../fixtures'
import { server as interceptor } from '../msw/server'
import { createRetentionReloadHttp } from './retention-acceptance-reload-http'
import {
  createRetentionReloadTransport,
  createRetentionReloadCases,
} from './retention-acceptance-reload-transport'

async function endpoint(handler: (request: IncomingMessage, response: ServerResponse) => void) {
  const server = createServer(handler)
  server.listen({ host: '127.0.0.1', port: 0, exclusive: true })
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw { code: 'ADDRESS_UNAVAILABLE' }
  const url = `http://127.0.0.1:${address.port}`
  interceptor.use(http.all(url + '/*', passthrough))
  return {
    server,
    url,
    close: async () => {
      if (!server.listening) return
      const stopped = new Promise<void>((resolve) => server.close(() => resolve()))
      server.closeAllConnections()
      await stopped
    },
  }
}

async function through(proxy: string, target: string, method = 'GET', body = Buffer.alloc(0)) {
  const reply = await new Promise<IncomingMessage>((resolve, reject) => {
    const pending = request(
      proxy,
      { path: target, method, headers: { 'content-length': body.length } },
      resolve,
    )
    pending.once('error', reject)
    pending.end(body)
  })
  const chunks: Buffer[] = []
  for await (const chunk of reply) chunks.push(chunk)
  return { status: reply.statusCode, headers: reply.headers, body: Buffer.concat(chunks) }
}

test.skipIf(Boolean(process.versions.bun))(
  'HTTP forwarding preserves redirect, encoded bytes, headers, status and entry-only ownership',
  async ({ onTestFinished }) => {
    const bodies: Buffer[] = [],
      connections: (string | undefined)[] = []
    const payload = Buffer.from([0, 255, 42, 13, 10])
    const encoded = gzipSync(payload)
    const entry = await endpoint((req, res) => {
      connections.push(req.headers.connection)
      if (req.url === '/redirect') {
        res.writeHead(302, { location: '/encoded' })
        res.end()
        return
      }
      if (req.url === '/encoded') {
        res.writeHead(207, {
          'content-encoding': 'gzip',
          'x-control': 'retained',
          'content-length': encoded.length,
        })
        res.end(encoded)
        return
      }
      const chunks: Buffer[] = []
      req.on('data', (chunk: Buffer) => chunks.push(chunk))
      req.on('end', () => {
        const body = Buffer.concat(chunks)
        bodies.push(body)
        res.writeHead(201, { 'x-control': 'echo' })
        res.end(body)
      })
    })
    const runner = await endpoint((_req, res) => {
      res.writeHead(500)
      res.end()
    })
    onTestFinished(async () => {
      await forwarding.close()
      await entry.close()
      await runner.close()
    })
    const transport = createRetentionReloadTransport()
    const forwarding = await createRetentionReloadHttp({
      runnerOrigin: runner.url,
      entryOrigin: entry.url,
      apiOrigin: entry.url,
      signal: new AbortController().signal,
    })
    interceptor.use(http.all(forwarding.proxy.server + '/*', passthrough))
    onTestFinished(() => forwarding.close())
    expect((await through(forwarding.proxy.server, runner.url + '/encoded')).status).toBe(503)
    forwarding.bind({ transport, beforeFetch: async () => {} })
    const response = await through(forwarding.proxy.server, runner.url + '/redirect')
    expect(response.status).toBe(207)
    expect(response.headers['content-encoding']).toBe('gzip')
    expect(response.headers['x-control']).toBe('retained')
    expect(response.body).toEqual(encoded)
    const echoed = await through(forwarding.proxy.server, runner.url + '/echo', 'POST', payload)
    expect(echoed.status).toBe(201)
    expect(echoed.body).toEqual(payload)
    expect(bodies).toEqual([payload])
    expect(connections.slice(0, 2)).toEqual(['close', 'close'])
    expect(transport.requests.map((row) => row.requestId)).toEqual([1, 2])
    expect(transport.requests.every((row) => row.terminal?.kind === 'succeeded')).toBe(true)
    expect((await through(forwarding.proxy.server, entry.url + '/encoded')).status).toBe(403)
    expect(transport.requests).toHaveLength(2)
    await forwarding.close()
    await forwarding.close()
  },
)

test.skipIf(Boolean(process.versions.bun))(
  'HTTP forwarding cancellation drains a real pending request and preserves the peer case',
  async ({ onTestFinished }) => {
    let started = () => {}
    const admitted = new Promise<void>((resolve) => {
      started = resolve
    })
    const entry = await endpoint((req, res) => {
      if (req.url === '/pending') {
        started()
        return
      }
      res.end('peer')
    })
    const runner = await endpoint((_req, res) => res.end())
    onTestFinished(async () => {
      await forwarding.close()
      await entry.close()
      await runner.close()
    })
    const signal = new AbortController()
    const transport = createRetentionReloadTransport(),
      peerTransport = createRetentionReloadTransport()
    const forwarding = await createRetentionReloadHttp({
      runnerOrigin: runner.url,
      entryOrigin: entry.url,
      apiOrigin: entry.url,
      signal: signal.signal,
    })
    const peer = await createRetentionReloadHttp({
      runnerOrigin: runner.url,
      entryOrigin: entry.url,
      apiOrigin: entry.url,
      signal: new AbortController().signal,
    })
    interceptor.use(
      http.all(forwarding.proxy.server + '/*', passthrough),
      http.all(peer.proxy.server + '/*', passthrough),
    )
    onTestFinished(async () => {
      await forwarding.close()
      await peer.close()
    })
    forwarding.bind({ transport, beforeFetch: async () => {} })
    peer.bind({ transport: peerTransport, beforeFetch: async () => {} })
    const address = new URL(forwarding.proxy.server)
    const pending = connect({ host: address.hostname, port: Number(address.port) })
    const received: Buffer[] = []
    pending.on('data', (chunk) => received.push(chunk))
    const ended = once(pending, 'close')
    await once(pending, 'connect')
    pending.write(`GET ${runner.url}/pending HTTP/1.1\r\nHost: ${new URL(runner.url).host}\r\n\r\n`)
    await admitted
    transport.stopAdmission()
    await transport.cancelPending()
    await ended
    expect(Buffer.concat(received).length).toBe(0)
    await forwarding.disposeRequests()
    await transport.drain()
    expect(transport.hasFailure).toBe(false)
    expect(transport.requests[0]?.terminal?.kind).toBe('cancelled')
    await forwarding.close()
    const stillLive = await through(peer.proxy.server, runner.url + '/peer')
    expect(stillLive.body.toString()).toBe('peer')
    expect(peerTransport.requests).toHaveLength(1)
  },
)

test.skipIf(Boolean(process.versions.bun))(
  'HTTP forwarding holds the original slow-font intervention and retains a falsy primary',
  async ({ onTestFinished }) => {
    const entry = await endpoint((_req, res) => res.end('font'))
    const runner = await endpoint((_req, res) => res.end())
    onTestFinished(async () => {
      await forwarding.close()
      await entry.close()
      await runner.close()
    })
    const transport = createRetentionReloadTransport()
    const forwarding = await createRetentionReloadHttp({
      runnerOrigin: runner.url,
      entryOrigin: entry.url,
      apiOrigin: entry.url,
      signal: new AbortController().signal,
    })
    interceptor.use(http.all(forwarding.proxy.server + '/*', passthrough))
    onTestFinished(() => forwarding.close())
    const held: { url: string; heldAt: number; releasedAt: number }[] = []
    forwarding.bind({
      transport,
      beforeFetch: async (url) => {
        if (url.pathname === '/fail') throw false
        const heldAt = Date.now()
        await new Promise((resolve) => setTimeout(resolve, 1000))
        held.push({ url: url.href, heldAt, releasedAt: Date.now() })
      },
    })
    expect(
      (
        await through(forwarding.proxy.server, runner.url + '/jetbrains-mono.woff2')
      ).body.toString(),
    ).toBe('font')
    expect(held[0]?.releasedAt - (held[0]?.heldAt ?? 0)).toBeGreaterThanOrEqual(1000)
    const primary = transport.race(new Promise<never>(() => {})).then(
      () => 'unexpected',
      (error: unknown) => error,
    )
    await through(forwarding.proxy.server, runner.url + '/fail').catch(() => {})
    expect(await primary).toBe(false)
    await transport.drain()
    expect(transport.firstError).toBe(false)
  },
)

test.skipIf(Boolean(process.versions.bun))(
  'runner WebSocket upgrades retain their original endpoint without HTTP forward records',
  async ({ onTestFinished }) => {
    const runner = await endpoint((_req, res) => res.end())
    const entry = await endpoint((_req, res) => {
      res.writeHead(500)
      res.end()
    })
    runner.server.on('upgrade', (_req, socket) => {
      socket.write(
        'HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n',
      )
      socket.on('data', (chunk) => socket.write(chunk))
      socket.once('end', () => socket.destroy())
    })
    onTestFinished(async () => {
      await forwarding.close()
      await runner.close()
      await entry.close()
    })
    const transport = createRetentionReloadTransport()
    const forwarding = await createRetentionReloadHttp({
      runnerOrigin: runner.url,
      entryOrigin: entry.url,
      apiOrigin: entry.url,
      signal: new AbortController().signal,
    })
    onTestFinished(() => forwarding.close())
    forwarding.bind({ transport, beforeFetch: async () => {} })
    const address = new URL(forwarding.proxy.server)
    const socket = connect({ host: address.hostname, port: Number(address.port) })
    await once(socket, 'connect')
    const header = once(socket, 'data')
    socket.write(
      `GET ${runner.url.replace('http:', 'ws:')}/hmr HTTP/1.1\r\nHost: ${new URL(runner.url).host}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`,
    )
    expect((await header)[0].toString()).toContain('101 Switching Protocols')
    const echoed = once(socket, 'data')
    socket.write('unchanged-runner')
    expect((await echoed)[0].toString()).toBe('unchanged-runner')
    expect(transport.requests).toEqual([])
    await forwarding.close()
    await once(socket, 'close')
    expect(socket.destroyed).toBe(true)
  },
)

test('the original registry refuses foreign finish and duplicate admission before starting a listener', async () => {
  const cases = createRetentionReloadCases()
  const owner = { sessionId: 'owner', testPath: '/owned' },
    foreign = { sessionId: 'peer', testPath: '/peer' }
  const id = crypto.randomUUID()
  let release = () => {},
    closed = 0,
    duplicateStarted = false
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  const result = cases.run(owner, id, () => ({
    result: pending,
    close: async () => {
      closed++
      release()
    },
  }))
  expect(() => cases.finish(foreign, id)).toThrow()
  expect(() =>
    cases.run(foreign, id, () => {
      duplicateStarted = true
      return { result: Promise.resolve(), close: async () => {} }
    }),
  ).toThrow()
  expect(duplicateStarted).toBe(false)
  await cases.finish(owner, id)
  await result
  await cases.finish(owner, id)
  expect(closed).toBe(1)
  expect(cases.activeCount).toBe(0)
})

// The browser command runs in Node; Bun's HTTP parser rejects absolute proxy request targets.
test.skipIf(!process.versions.bun)(
  'native Node executes the HTTP controller contract controls',
  async () => {
    const cli = fileURLToPath(
      new URL('../../../../node_modules/vitest/vitest.mjs', import.meta.url),
    )
    const filename = fileURLToPath(import.meta.url)
    const child = spawn('node', [cli, 'run', '--project', 'node', filename], {
      cwd: fileURLToPath(new URL('../..', import.meta.url)),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const output: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => output.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => output.push(chunk))
    const [code] = await once(child, 'close')
    expect(code, Buffer.concat(output).toString()).toBe(0)
  },
)
