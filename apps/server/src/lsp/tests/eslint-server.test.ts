import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { spawnCommand } from '../installers'
import { fileUriForPath } from '@workspace/contracts'
import { LspSessionPool, type LspProxySocket } from '../proxy-session'
import { lspServersFor, type LspServerMatch } from '../registry'

const roots: string[] = []
const pools: LspSessionPool[] = []

afterEach(async () => {
  for (const pool of pools.splice(0)) pool.disposeAll()
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

class RecordingSocket implements LspProxySocket {
  readonly sent: Record<string, unknown>[] = []

  close(): void {}

  send(message: string): void {
    this.sent.push(JSON.parse(message) as Record<string, unknown>)
  }

  answer(id: number): Record<string, unknown> | undefined {
    return this.sent.find((message) => message.id === id)
  }
}

describe('ESLint against a real server', () => {
  it('pulls diagnostics and returns code actions with the registry configuration', async () => {
    const root = await eslintFixtureRoot()
    assertEslintResolvable(root)
    const match = eslintMatch(root)
    expect(match).not.toBeNull()
    if (!match) return

    const pool = new LspSessionPool(() => 120_000)
    pools.push(pool)
    const socket = new RecordingSocket()
    const session = await pool.acquire(socket, match, root)
    expect(session).not.toBeNull()
    if (!session) return

    await session.handleClientMessage(JSON.stringify(initializeRequest(1, root)))
    const initialized = await waitForAnswer(socket, 1)
    expect(initialized).toMatchObject({
      result: { capabilities: { diagnosticProvider: { identifier: 'eslint' } } },
    })

    await session.handleClientMessage(
      JSON.stringify({ jsonrpc: '2.0', method: 'initialized', params: {} }),
    )
    const uri = fileUriForPath(path.join(root, 'probe.js'))
    await session.handleClientMessage(
      JSON.stringify({
        jsonrpc: '2.0',
        method: 'textDocument/didOpen',
        params: {
          textDocument: {
            languageId: 'javascript',
            text: 'const value = 1\n',
            uri,
            version: 1,
          },
        },
      }),
    )

    await session.handleClientMessage(JSON.stringify(diagnosticRequest(2, uri)))
    const diagnosticAnswer = await waitForAnswer(socket, 2)
    expect(diagnosticAnswer).not.toHaveProperty('error')
    const diagnostics = diagnosticItems(diagnosticAnswer)
    expect(diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'semi', source: 'eslint' })]),
    )

    await session.handleClientMessage(JSON.stringify(codeActionRequest(3, uri, diagnostics)))
    const codeActionAnswer = await waitForAnswer(socket, 3)
    expect(codeActionAnswer).not.toHaveProperty('error')
    expect(codeActionAnswer?.result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'quickfix', title: expect.stringContaining('semi') }),
      ]),
    )
  }, 60_000)
})

async function eslintFixtureRoot(): Promise<string> {
  const serverRoot = path.resolve(import.meta.dirname, '../../..')
  const root = await mkdtemp(path.join(serverRoot, '.eslint-lsp-test-'))
  roots.push(root)
  await writeFile(path.join(root, 'package.json'), '{"private":true,"type":"module"}\n')
  await writeFile(
    path.join(root, 'eslint.config.mjs'),
    "export default [{ rules: { semi: ['error', 'always'] } }]\n",
  )
  await writeFile(path.join(root, 'probe.js'), 'const value = 1\n')
  return root
}

// The fixture lives inside `apps/server` so the language server resolves
// `eslint` from its node_modules — a fixture library, not this repo's linter.
// Asserted, because without it the server returns [] with no error.
function assertEslintResolvable(root: string) {
  createRequire(path.join(root, 'probe.js')).resolve('eslint')
}

function eslintMatch(root: string): LspServerMatch | null {
  const definition = lspServersFor({ servers: {}, languageServers: {}, tyForPython: false }).find(
    (server) => server.id === 'eslint',
  )
  if (!definition) return null

  return {
    root,
    server: {
      ...definition,
      spawn: () => spawnCommand([eslintServerBinary(), '--stdio'], { cwd: root }),
    },
  }
}

function eslintServerBinary(): string {
  return path.resolve(
    import.meta.dirname,
    '../../../node_modules/.bin/vscode-eslint-language-server',
  )
}

function initializeRequest(id: number, root: string) {
  return {
    id,
    jsonrpc: '2.0',
    method: 'initialize',
    params: {
      capabilities: {
        textDocument: {
          codeAction: {
            codeActionLiteralSupport: {
              codeActionKind: { valueSet: ['quickfix', 'source.fixAll.eslint'] },
            },
          },
          diagnostic: { dynamicRegistration: false, relatedDocumentSupport: false },
          publishDiagnostics: { relatedInformation: true },
        },
        workspace: { configuration: true, workspaceFolders: true },
      },
      clientInfo: { name: 'Visual Studio Code', version: '1.0.0' },
      processId: process.pid,
      rootUri: fileUriForPath(root),
      workspaceFolders: [{ name: path.basename(root), uri: fileUriForPath(root) }],
    },
  }
}

function diagnosticRequest(id: number, uri: string) {
  return {
    id,
    jsonrpc: '2.0',
    method: 'textDocument/diagnostic',
    params: { identifier: 'eslint', textDocument: { uri } },
  }
}

function diagnosticItems(answer: Record<string, unknown> | undefined): readonly unknown[] {
  const result = answer?.result
  if (!result || typeof result !== 'object') return []
  if (!('items' in result) || !Array.isArray(result.items)) return []
  return result.items
}

function codeActionRequest(id: number, uri: string, diagnostics: readonly unknown[]) {
  return {
    id,
    jsonrpc: '2.0',
    method: 'textDocument/codeAction',
    params: {
      context: { diagnostics, only: ['quickfix'], triggerKind: 1 },
      range: {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 15 },
      },
      textDocument: { uri },
    },
  }
}

async function waitForAnswer(
  socket: RecordingSocket,
  id: number,
): Promise<Record<string, unknown> | undefined> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const answer = socket.answer(id)
    if (answer) return answer
    await new Promise((resolve) => setTimeout(resolve, 25))
  }

  return undefined
}
