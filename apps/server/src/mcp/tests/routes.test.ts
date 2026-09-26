import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { Elysia } from 'elysia'
import { afterEach, describe, expect, it, vi } from 'vitest'

import * as fs from 'node:fs/promises'
import { mkdir, mkdtemp, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
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

// Wrap only OS I/O; the MCP route, grant resolver and actual filesystem stay real.
vi.mock('node:fs/promises', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs/promises')>()
  return { ...fs, readFile: vi.fn(fs.readFile), open: vi.fn(fs.open) }
})

const ENDPOINT = 'http://127.0.0.1:39087/mcp'
const ORIGIN = 'http://localhost:5173'
const cleanups: (() => Promise<unknown> | unknown)[] = []

afterEach(async () => {
  vi.resetAllMocks()
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

function endpoint() {
  const grants = new McpGrantRegistry()
  const app = new Elysia().use(mcpRoutes({ allowedOrigins: [ORIGIN], endpoint: ENDPOINT, grants }))
  return { app, grants }
}

type Handler = { handle(request: Request): Promise<Response> }

async function callTool(
  app: Handler,
  token: string,
  name: string,
  args: Record<string, unknown> = {},
) {
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
  const result = await client.callTool({ name, arguments: args })
  await client.close()
  return result
}

async function callWorkspaceInfo(app: Handler, token: string) {
  return (await callTool(app, token, 'workspace_info')).structuredContent
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

describe('the checkout boundary', () => {
  it.each(['file', 'ancestor'])(
    'rejects an outward %s replacement at the filesystem open boundary',
    async (kind) => {
      const root = await mkdtemp(path.join(tmpdir(), 'platform-mcp-swap-'))
      cleanups.push(() => rm(root, { force: true, recursive: true }))
      const inside = path.join(root, 'checkout/src')
      const outside = path.join(root, 'sibling/src')
      await mkdir(inside, { recursive: true })
      await mkdir(outside, { recursive: true })
      await writeFile(path.join(inside, 'target.txt'), 'allowed')
      await writeFile(path.join(outside, 'target.txt'), 'outside-secret')
      const { app, grants } = endpoint()
      const token = grants.issue({
        cwd: path.join(root, 'checkout'),
        runtimeEpoch: 'e1',
        sessionId: 'a',
      })
      expect((await callTool(app, token, 'read_file', { path: 'src/target.txt' })).content).toEqual(
        [{ type: 'text', text: 'allowed' }],
      )
      let swapped = false
      const swap = async (file: unknown) => {
        if (swapped || typeof file !== 'string' || !file.endsWith('/src/target.txt')) return
        swapped = true
        const from = kind === 'ancestor' ? inside : path.join(inside, 'target.txt')
        const to = kind === 'ancestor' ? outside : path.join(outside, 'target.txt')
        await rename(from, `${from}.held`)
        await symlink(to, from)
      }
      const { readFile: read, open } =
        await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
      vi.mocked(fs.readFile).mockImplementation(async (...args) => {
        await swap(args[0])
        return read(...args)
      })
      vi.mocked(fs.open).mockImplementation(async (...args) => {
        await swap(args[0])
        return open(...args)
      })
      const result = await callTool(app, token, 'read_file', { path: 'src/target.txt' })
      expect(swapped).toBe(true)
      expect(result.isError).toBe(true)
      expect(JSON.stringify(result)).not.toContain('outside-secret')
    },
  )

  it.each([{ startLine: 1, endLine: 1 }, { startLine: 1 }, { endLine: 1 }, {}])(
    'enforces the file byte limit for range %j',
    async (range) => {
      const root = await mkdtemp(path.join(tmpdir(), 'platform-mcp-size-'))
      cleanups.push(() => rm(root, { force: true, recursive: true }))
      await writeFile(path.join(root, 'huge.txt'), 'x'.repeat(512 * 1024 + 1))
      const { app, grants } = endpoint()
      const token = grants.issue({ cwd: root, runtimeEpoch: 'e1', sessionId: 'a' })
      const result = await callTool(app, token, 'read_file', { path: 'huge.txt', ...range })
      expect(result.isError).toBe(true)
      expect(JSON.stringify(result)).not.toContain('x'.repeat(1024))
    },
  )

  it('streams a requested line range without reading the rest of the file', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'platform-mcp-range-'))
    cleanups.push(() => rm(root, { force: true, recursive: true }))
    await writeFile(path.join(root, 'range.txt'), 'first\nsecond\n' + 'z'.repeat(400_000))
    const { app, grants } = endpoint()
    const token = grants.issue({ cwd: root, runtimeEpoch: 'e1', sessionId: 'a' })
    const read = vi.mocked(fs.readFile)
    const calls: unknown[][][] = []
    const { open } = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
    vi.mocked(fs.open).mockImplementation(async (...args) => {
      const handle = await open(...args)
      if (String(args[0]).endsWith('/range.txt')) calls.push(vi.spyOn(handle, 'read').mock.calls)
      return handle
    })
    const result = await callTool(app, token, 'read_file', {
      path: 'range.txt',
      startLine: 2,
      endLine: 2,
    })
    expect(result.content).toEqual([{ type: 'text', text: 'second' }])
    expect(read.mock.calls.filter(([file]) => file === path.join(root, 'range.txt'))).toEqual([])
    expect(calls.flat()).toHaveLength(1)
  })

  it('caps a file that grows after fstat and bounds decoded text bytes', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'platform-mcp-growth-'))
    cleanups.push(() => rm(root, { force: true, recursive: true }))
    const target = path.join(root, 'growing.txt')
    await writeFile(target, 'initial')
    await writeFile(path.join(root, 'invalid-utf8.txt'), Buffer.alloc(200_000, 0xff))
    const { app, grants } = endpoint()
    const token = grants.issue({ cwd: root, runtimeEpoch: 'e1', sessionId: 'a' })
    const { open } = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
    vi.mocked(fs.open).mockImplementation(async (...args) => {
      const handle = await open(...args)
      if (!String(args[0]).endsWith('/growing.txt')) return handle
      const stat = handle.stat.bind(handle)
      vi.spyOn(handle, 'stat').mockImplementation(async () => {
        const info = await stat()
        await writeFile(target, 'g'.repeat(512 * 1024 + 1))
        return info
      })
      return handle
    })
    for (const file of ['growing.txt', 'invalid-utf8.txt']) {
      const result = await callTool(app, token, 'read_file', { path: file, startLine: 1 })
      expect(result.isError).toBe(true)
      expect(JSON.stringify(result).length).toBeLessThan(1024)
    }
  })

  it('keeps UTF-8 and line boundaries intact across read chunks', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'platform-mcp-chunks-'))
    cleanups.push(() => rm(root, { force: true, recursive: true }))
    const line = 'a'.repeat(16_381) + '🙂'
    const content = line + '\nsecond\nthird\n'
    await writeFile(path.join(root, 'utf8.txt'), content)
    const { app, grants } = endpoint()
    const token = grants.issue({ cwd: root, runtimeEpoch: 'e1', sessionId: 'a' })
    expect(
      (await callTool(app, token, 'read_file', { path: 'utf8.txt', startLine: 1, endLine: 1 }))
        .content,
    ).toEqual([{ type: 'text', text: line }])
    expect(
      (await callTool(app, token, 'read_file', { path: 'utf8.txt', startLine: 2, endLine: 3 }))
        .content,
    ).toEqual([{ type: 'text', text: 'second\nthird' }])
    expect((await callTool(app, token, 'read_file', { path: 'utf8.txt' })).content).toEqual([
      { type: 'text', text: content },
    ])
  })

  it.each([
    ['a', 'b'],
    ['b', 'a'],
  ])('confines checkout %s against sibling %s with matching paths', async (owner, sibling) => {
    const root = await mkdtemp(path.join(tmpdir(), 'platform-mcp-boundary-'))
    cleanups.push(() => rm(root, { force: true, recursive: true }))
    for (const name of ['a', 'b']) {
      await mkdir(path.join(root, name, 'src'), { recursive: true })
      await writeFile(path.join(root, name, 'src/secret.ts'), `export const owner = '${name}'\n`)
    }
    await symlink(path.join(root, sibling, 'src'), path.join(root, owner, 'linked'))
    const { app, grants } = endpoint()
    const token = grants.issue({
      cwd: path.join(root, owner),
      runtimeEpoch: 'e1',
      sessionId: owner,
    })
    const read = async (file: string) => {
      const result = await callTool(app, token, 'read_file', { path: file })
      const [content] = result.content as { text: string }[]
      return { error: Boolean(result.isError), text: content?.text ?? '' }
    }

    expect(await read('src/secret.ts')).toEqual({
      error: false,
      text: `export const owner = '${owner}'\n`,
    })
    expect(await read(path.join(root, owner, 'src/secret.ts'))).toMatchObject({ error: false })
    for (const escape of [
      path.join(root, sibling, 'src/secret.ts'),
      `../${sibling}/src/secret.ts`,
      'linked/secret.ts',
    ])
      expect(await read(escape)).toMatchObject({ error: true })
  })
})

describe("Platform's MCP endpoint", () => {
  it('revokes only the ended epoch, keeping a replacement runtime authorized', async () => {
    const { app, grants } = endpoint()
    const first = grants.bind({ cwd: '/work/a', runtimeEpoch: 'old', sessionId: 'session-a' })
    const second = grants.bind({ cwd: '/work/a', runtimeEpoch: 'new', sessionId: 'session-a' })
    grants.revoke('session-a', 'old')
    expect((await post(app, { authorization: `Bearer ${first}` })).status).toBe(401)
    expect(await callWorkspaceInfo(app, second)).toEqual({ cwd: '/work/a', sessionId: 'session-a' })
    grants.revoke('session-a', 'new')
    expect((await post(app, { authorization: `Bearer ${second}` })).status).toBe(401)
  })

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
