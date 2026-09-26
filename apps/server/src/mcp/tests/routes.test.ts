import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { Elysia } from 'elysia'
import { afterEach, describe, expect, it } from 'vitest'

import { Database } from 'bun:sqlite'
import { sessionIdSchema } from '@workspace/contracts'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import * as v from 'valibot'

import { initializePlatformDatabase } from '../../db/initialize'
import * as schema from '../../db/schema'
import { MockProviderAdapter } from '../../provider/adapters/mock'
import { ProviderAdapterRegistry } from '../../provider/provider-adapter-registry'
import { ProviderService } from '../../provider/provider-service'
import { ProviderSessionDirectory } from '../../provider/provider-session-directory'
import { McpGrantRegistry } from '../grants'
import { mcpRoutes } from '../routes'

const ENDPOINT = 'http://127.0.0.1:39087/mcp'
const ORIGIN = 'http://localhost:5173'
const cleanups: (() => Promise<unknown> | unknown)[] = []

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

function endpoint() {
  const grants = new McpGrantRegistry()
  const app = new Elysia().use(mcpRoutes({ allowedOrigins: [ORIGIN], endpoint: ENDPOINT, grants }))
  return { app, grants }
}

type Handler = { handle(request: Request): Promise<Response> }

async function callWorkspaceInfo(app: Handler, token: string) {
  const client = new Client(
    { name: 'platform-test', version: '0' },
    { versionNegotiation: { mode: { pin: '2026-07-28' } } },
  )
  const fetch = (url: string | URL | Request, init?: RequestInit) =>
    app.handle(
      new Request(url, {
        ...init,
        headers: {
          ...Object.fromEntries(new Headers(init?.headers)),
          authorization: `Bearer ${token}`,
        },
      }),
    )
  await client.connect(new StreamableHTTPClientTransport(new URL(ENDPOINT), { fetch }))
  const result = await client.callTool({ name: 'workspace_info', arguments: {} })
  await client.close()
  return result.structuredContent
}

function post(app: Handler, headers: Record<string, string>, body: unknown = {}) {
  return app.handle(
    new Request(ENDPOINT, {
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json', ...headers },
      method: 'POST',
    }),
  )
}

describe("Platform's MCP endpoint", () => {
  it('answers a pinned 2026-07-28 client with the grant its token carries, per request', async () => {
    const { app, grants } = endpoint()
    const first = grants.issue({ cwd: '/work/a', runtimeEpoch: 'e1', sessionId: 'session-a' })
    const second = grants.issue({ cwd: '/work/b', runtimeEpoch: 'e1', sessionId: 'session-b' })

    expect(await callWorkspaceInfo(app, first)).toEqual({ cwd: '/work/a', sessionId: 'session-a' })
    expect(await callWorkspaceInfo(app, second)).toEqual({ cwd: '/work/b', sessionId: 'session-b' })
    expect(await callWorkspaceInfo(app, first)).toEqual({ cwd: '/work/a', sessionId: 'session-a' })
  })

  it('refuses a missing token, a foreign origin, a tailnet host and the 2025 handshake', async () => {
    const { app, grants } = endpoint()
    const token = grants.issue({ cwd: '/work/a', runtimeEpoch: 'e1', sessionId: 'session-a' })
    const bearer = { authorization: `Bearer ${token}` }

    const missing = await post(app, {})
    expect(missing.status).toBe(401)
    expect(missing.headers.get('www-authenticate')).toContain('Bearer')
    expect((await post(app, { ...bearer, origin: 'https://evil.example' })).status).toBe(403)
    const tailnet = await app.handle(
      new Request('http://omarchy.mesh.example/mcp', { headers: bearer, method: 'POST' }),
    )
    expect(tailnet.status).toBe(421)
    const legacy = await post(
      app,
      { ...bearer, accept: 'application/json, text/event-stream' },
      {
        id: 1,
        jsonrpc: '2.0',
        method: 'initialize',
        params: {
          capabilities: {},
          clientInfo: { name: 'old', version: '0' },
          protocolVersion: '2025-06-18',
        },
      },
    )
    expect(legacy.status).toBe(400)
    expect(await legacy.text()).toContain('2026-07-28')
    expect(
      (await app.handle(new Request(ENDPOINT, { headers: bearer, method: 'GET' }))).status,
    ).toBe(405)
  })

  it('gives each runtime a token for its own checkout, and drops it when the runtime stops', async () => {
    const sqlite = new Database(':memory:', { create: true })
    const database = drizzle({ client: sqlite, schema })
    initializePlatformDatabase(database)
    cleanups.push(() => sqlite.close())
    const grants = new McpGrantRegistry()
    const adapter = new MockProviderAdapter()
    const service = new ProviderService({
      adapterRegistry: new ProviderAdapterRegistry([adapter]),
      mcp: { endpoint: ENDPOINT, grants },
      sessionDirectory: new ProviderSessionDirectory(database),
    })
    cleanups.push(() => service.shutdown())
    const sessionId = v.parse(sessionIdSchema, '5d0c3a4e-8f1b-4c2d-9e7a-6b5c4d3e2f10')
    await service.ensureRuntime({
      providerInstanceId: adapter.adapterKey,
      runtimeEpoch: 'epoch-1',
      runtimeMode: 'full-access',
      runtimePayload: {
        cwd: '/work/project',
        interactionMode: 'default',
        modelSelection: { model: 'gpt-5.5', providerInstanceId: adapter.adapterKey },
      },
      sessionId,
    })
    const binding = adapter.startedSessions.at(-1)?.platformMcp
    expect(binding?.url).toBe(ENDPOINT)
    const app = new Elysia().use(mcpRoutes({ allowedOrigins: [], endpoint: ENDPOINT, grants }))
    expect(await callWorkspaceInfo(app, binding?.token ?? '')).toEqual({
      cwd: '/work/project',
      sessionId,
    })

    await service.stopRuntime({ sessionId })
    expect(grants.resolve(binding?.token ?? '')).toBeNull()
  })
})
