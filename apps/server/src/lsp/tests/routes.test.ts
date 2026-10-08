import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createAuthConfig } from '../../auth'
import { lspErrors } from '../../observability'
import { createWorkspacePaths } from '../../fs/path'
import { lspRouteMatch, lspRouteSemanticTokens, lspRoutes, type LspRouteDeps } from '../routes'
import type { LspProxyClientSession } from '../proxy-session'

const TRUSTED_ORIGIN = 'http://localhost:5173'
const roots: string[] = []

class FakeLspProxySession {
  disposed = false
  readonly clientMessages: unknown[] = []

  async handleClientMessage(message: string | ArrayBuffer | Uint8Array) {
    this.clientMessages.push(JSON.parse(message.toString()) as unknown)
  }

  dispose() {
    this.disposed = true
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('LSP websocket routes', () => {
  it('rejects an untrusted origin before resolving or acquiring a backend', async () => {
    const root = await fixtureRoot()
    const resolveServer = vi.fn()
    const acquire = vi.fn()
    const routes = lspRoutes({ paths: createWorkspacePaths(root) }, auth(), {
      resolveServer,
      settings: () => ({ servers: {}, languageServers: {}, tyForPython: false }),
      pool: { acquire },
    })
    const ws = fakeSocket({ path: 'src/file.fake', root: '', server: 'unknown' })
    ws.data.headers.origin = 'http://localhost:9999'

    await routes.open(ws)

    expect(ws.closeDetails).toEqual({ code: 1008, reason: 'unauthorized' })
    expect(resolveServer).not.toHaveBeenCalled()
    expect(acquire).not.toHaveBeenCalled()
  })

  it('rejects a root outside the workspace before acquiring a backend', async () => {
    const root = await fixtureRoot()
    const resolveServer = vi.fn()
    const acquire = vi.fn()
    const routes = lspRoutes({ paths: createWorkspacePaths(root) }, auth(), {
      resolveServer,
      settings: () => ({ servers: {}, languageServers: {}, tyForPython: false }),
      pool: { acquire },
    })
    const ws = fakeSocket({ path: 'src/file.fake', root: '../outside', server: 'unknown' })

    await routes.open(ws)

    expect(ws.closeDetails).toEqual({ code: 1008, reason: 'invalid-root' })
    expect(resolveServer).not.toHaveBeenCalled()
    expect(acquire).not.toHaveBeenCalled()
  })

  it('buffers client messages while the server session is opening', async () => {
    const root = await fixtureRoot()
    const createdSessions: FakeLspProxySession[] = []
    const routes = lspRoutes(
      { paths: createWorkspacePaths(root) },
      auth(),
      bufferedLspDeps(root, createdSessions),
    )
    const ws = fakeSocket({
      path: 'src/file.fake',
      root: '',
      server: 'buffered-lsp',
    })
    const opening = routes.open(ws)

    routes.message(ws, JSON.stringify(initializeRequest(1)))
    await opening

    expect(createdSessions[0]?.clientMessages).toEqual([initializeRequest(1)])
  })

  it('settles a rejected installer and reports the failed backend to the socket', async () => {
    const root = await fixtureRoot()
    const deps = bufferedLspDeps(root, [])
    const failure = lspErrors.PACKAGE_INSTALL_FAILED({
      internal: { exitCode: 1 },
      packageName: 'vscode-langservers-extracted',
    })
    const acquire = vi.fn().mockRejectedValue(failure)
    const routes = lspRoutes({ paths: createWorkspacePaths(root) }, auth(), {
      ...deps,
      pool: { acquire },
    })
    const ws = fakeSocket({ path: 'settings.json', root: '', server: 'buffered-lsp' })
    const send = vi.spyOn(ws, 'send')

    await expect(routes.open(ws)).resolves.toBeUndefined()

    expect(acquire).toHaveBeenCalledTimes(1)
    expect(ws.closed).toBe(true)
    expect(send).toHaveBeenCalledWith(
      JSON.stringify({
        jsonrpc: '2.0',
        method: '$/serverExited',
        params: {
          exitCode: null,
          exitSignal: null,
          outcome: 'spawn_failed',
          serverId: 'buffered-lsp',
        },
      }),
    )
    routes.message(ws, JSON.stringify(initializeRequest(1)))
    routes.close(ws)
  })

  it('settles an installer rejection after the client has disconnected', async () => {
    const root = await fixtureRoot()
    const starting = Promise.withResolvers<LspProxyClientSession | null>()
    const acquired = Promise.withResolvers<void>()
    const deps = bufferedLspDeps(root, [])
    const routes = lspRoutes({ paths: createWorkspacePaths(root) }, auth(), {
      ...deps,
      pool: {
        acquire: () => {
          acquired.resolve()
          return starting.promise
        },
      },
    })
    const ws = fakeSocket({ path: 'settings.json', root: '', server: 'buffered-lsp' })
    const send = vi.spyOn(ws, 'send')
    const opening = routes.open(ws)
    const settled = expect(opening).resolves.toBeUndefined()
    await acquired.promise
    routes.close(ws)
    starting.reject(
      lspErrors.PACKAGE_INSTALL_FAILED({
        internal: { exitCode: 1 },
        packageName: 'vscode-langservers-extracted',
      }),
    )

    await settled
    expect(send).not.toHaveBeenCalled()
  })

  it('rejects an unknown explicit server without acquiring a backend', async () => {
    const root = await fixtureRoot()
    const acquire = vi.fn()
    const routes = lspRoutes({ paths: createWorkspacePaths(root) }, auth(), {
      resolveServer: async () => null,
      settings: () => ({ servers: {}, languageServers: {}, tyForPython: false }),
      pool: { acquire },
    })
    const ws = fakeSocket({ path: 'src/file.fake', root: '', server: 'unknown' })

    await routes.open(ws)

    expect(ws.closed).toBe(true)
    expect(acquire).not.toHaveBeenCalled()
  })
})

describe('LSP match route', () => {
  it('returns every descriptor with its independently resolved root', async () => {
    const root = await fixtureRoot()
    await Bun.write(path.join(root, 'package.json'), '{}')
    // The linters answer for a project that adopted them, so the fixture adopts
    // all three: this test is about root resolution, not about the gate.
    await Bun.write(path.join(root, 'biome.json'), '{}')
    await Bun.write(path.join(root, 'eslint.config.js'), 'export default []\n')
    await Bun.write(path.join(root, '.oxlintrc.json'), '{}')
    await mkdir(path.join(root, 'nested'))
    await Bun.write(path.join(root, 'nested', 'deno.json'), '{}')
    await Bun.write(path.join(root, 'nested', 'file.ts'), 'export const value = 1\n')

    const result = await lspRouteMatch(
      createWorkspacePaths(root),
      { path: 'nested/file.ts', root: '' },
      { servers: {}, languageServers: {}, tyForPython: false },
    )

    expect(result.map((match) => match.serverId)).toEqual(['deno', 'eslint', 'oxlint', 'biome'])
    expect(result[0]?.root).toBe(path.join(root, 'nested'))
    expect(result.slice(1).every((match) => match.root === root)).toBe(true)
    expect(result[0]?.features.completion).toBe(0)
    expect(result[1]?.features.diagnostics).toBe(0)
  })
})

// Inject fakes through lspRoutes' deps instead of mocking modules — Bun module
// mocks are global and would leak the fake registry into other test files.
function bufferedLspDeps(root: string, createdSessions: FakeLspProxySession[]): LspRouteDeps {
  return {
    resolveServer: (async () => {
      await Bun.sleep(25)
      return { root, server: { id: 'buffered-lsp' } }
    }) as unknown as LspRouteDeps['resolveServer'],
    settings: () => ({ servers: {}, languageServers: {}, tyForPython: false }),
    pool: {
      acquire: async () => {
        await Bun.sleep(25)
        const session = new FakeLspProxySession()
        createdSessions.push(session)
        return session
      },
    },
  }
}

async function fixtureRoot() {
  const root = await mkdtemp(path.join(tmpdir(), 'platform-lsp-route-'))
  roots.push(root)
  return root
}

function auth() {
  return createAuthConfig({ allowedOrigins: [TRUSTED_ORIGIN] })
}

function fakeSocket(query: { path: string; root: string; server: string }) {
  const raw = {}
  const closeDetails: { code: number | undefined; reason: string | undefined } = {
    code: undefined,
    reason: undefined,
  }
  return {
    closed: false,
    closeDetails,
    data: {
      headers: { origin: TRUSTED_ORIGIN },
      query,
    },
    raw,
    close(code?: number, reason?: string) {
      this.closed = true
      this.closeDetails = { code, reason }
    },
    send: () => undefined,
  }
}

function initializeRequest(id: number) {
  return {
    id,
    jsonrpc: '2.0',
    method: 'initialize',
    params: {},
  }
}

/**
 * What a developer reads to find out why a language is uncoloured.
 *
 * Every per-server fact this app relies on came out of one version of one
 * binary, and the negotiated result is the only thing that reports the truth
 * after a server upgrade. It deliberately reports `null` rather than spawning:
 * this endpoint is asked before the websocket opens, and starting a language
 * server to answer a question about language servers would be worse than saying
 * "not yet".
 */
describe('negotiated semantic tokens', () => {
  it('reports what a live backend agreed to', async () => {
    const root = await fixtureRoot()
    await Bun.write(path.join(root, 'main.go'), 'package main\n')
    await Bun.write(path.join(root, 'go.mod'), 'module probe\n')
    const negotiated = {
      delta: false,
      full: true,
      legend: { tokenModifiers: ['readonly'], tokenTypes: ['variable', 'type'] },
      range: true,
    }

    const result = await lspRouteSemanticTokens(
      createWorkspacePaths(root),
      { path: 'main.go', root: '' },
      { servers: {}, languageServers: {}, tyForPython: false },
      { negotiatedSemanticTokens: () => negotiated },
    )

    expect(result).toMatchObject({ negotiated, serverId: 'gopls' })
  })

  it('says so rather than spawning when no backend has initialized', async () => {
    const root = await fixtureRoot()
    await Bun.write(path.join(root, 'main.go'), 'package main\n')
    await Bun.write(path.join(root, 'go.mod'), 'module probe\n')
    let asked = 0

    const result = await lspRouteSemanticTokens(
      createWorkspacePaths(root),
      { path: 'main.go', root: '' },
      { servers: {}, languageServers: {}, tyForPython: false },
      {
        negotiatedSemanticTokens: () => {
          asked += 1
          return null
        },
      },
    )

    expect(result).toMatchObject({ negotiated: null, serverId: 'gopls' })
    expect(asked).toBe(1)
  })

  it('answers null for a path no server claims', async () => {
    const root = await fixtureRoot()
    await Bun.write(path.join(root, 'notes.txt'), 'hello\n')

    const result = await lspRouteSemanticTokens(
      createWorkspacePaths(root),
      { path: 'notes.txt', root: '' },
      { servers: {}, languageServers: {}, tyForPython: false },
      { negotiatedSemanticTokens: () => null },
    )

    expect(result).toBeNull()
  })
})
