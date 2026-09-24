import path from 'node:path'
import { rename, rm, writeFile } from 'node:fs/promises'
import {
  defaultClientCapabilities,
  mergeClientCapabilities,
  semanticTokensClientCapability,
} from '@singapore-editor/lsp'
import { isRecord } from '@workspace/utils/objects'
import { afterEach, describe, expect, it } from 'vitest'

import { installedTypeScriptRuntimeFixture } from '../../../test/factories/typescript-runtime'
import { createWorkspacePaths } from '../../fs/path'
import { treeWatchSource } from '../../fs/tree-watch'
import { FileChangeHub } from '../../fs/watch'
import { createInternalError } from '../../observability/structured-errors'
import { fileUriForPath } from '../language'
import { LspSessionPool, type LspProxyClientSession, type LspProxySocket } from '../proxy-session'
import { resolveLspServer } from '../registry'

const IMPORT = 'import { helper } from "./nested/my-helper";'
const SOURCE = `const count: number = "wrong";\ncount.toFixed();\n${IMPORT}\n`
const SETTINGS = { servers: {}, languageServers: {}, tyForPython: false } as const
const RUNTIMES = [
  { packageName: 'typescript', native: true },
  { packageName: 'typescript-language-service', native: false },
] as const
const fixtures: Awaited<ReturnType<typeof installedTypeScriptRuntimeFixture>>[] = []
const pools: LspSessionPool[] = []
const hubs: FileChangeHub[] = []

afterEach(async () => {
  for (const pool of pools.splice(0)) pool.disposeAll()
  await Promise.all(hubs.splice(0).map((hub) => hub.close()))
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.dispose()))
})

function watchedPool() {
  const paths = createWorkspacePaths('/')
  const hub = new FileChangeHub(paths, { enabled: true })
  hubs.push(hub)
  const pool = new LspSessionPool(() => 120_000, undefined, treeWatchSource(hub, paths))
  pools.push(pool)
  return pool
}

class RecordingSocket implements LspProxySocket {
  readonly sent: Record<string, unknown>[] = []

  close(): void {}

  send(message: string): void {
    const parsed: unknown = JSON.parse(message)
    if (!isRecord(parsed)) throw createInternalError('LSP test received a non-object message')
    this.sent.push(parsed)
  }

  answer(id: number) {
    return this.sent.find((message) => message.id === id)
  }

  notification(method: string) {
    return this.sent.findLast((message) => message.method === method)?.params
  }
}

describe('workspace TypeScript against real language servers', () => {
  it.each(RUNTIMES)(
    'refreshes diagnostics after external dependency edits with $packageName',
    async ({ packageName, native }) => {
      const source = 'import { value } from "./dependency";\nexport const count: number = value;\n'
      const fixture = await installedTypeScriptRuntimeFixture(packageName, {
        'package.json': '{"private":true,"type":"module"}\n',
        'tsconfig.json': '{"compilerOptions":{"strict":true},"files":["probe.ts"]}\n',
        'probe.ts': source,
        'dependency.ts': 'export const value = "wrong";\n',
      })
      fixtures.push(fixture)
      const { root } = fixture
      const filePath = path.join(root, 'probe.ts')
      const uri = fileUriForPath(filePath)
      const match = await resolveLspServer({
        filePath,
        serverId: 'typescript',
        settings: SETTINGS,
        workspaceRoot: root,
      })
      if (!match) throw createInternalError('TypeScript fixture did not match its language server')
      const pool = watchedPool()
      const socket = new RecordingSocket()
      const session = await pool.acquire(socket, match, root)
      if (!session)
        throw createInternalError('TypeScript fixture did not start its language server')
      await request(session, socket, 1, 'initialize', initializeParams(root))
      await notify(session, 'initialized', {})
      await notify(session, 'textDocument/didOpen', {
        textDocument: { languageId: 'typescript', text: source, uri, version: 1 },
      })
      await assertDiagnostics(session, socket, native, uri)

      const dependency = path.join(root, 'dependency.ts')
      const changes = [
        { apply: () => writeFile(dependency, 'export const value = 1;\n'), codes: [] },
        {
          apply: async () => {
            await writeFile(`${dependency}.tmp`, 'export const value = "wrong";\n')
            await rename(`${dependency}.tmp`, dependency)
          },
          codes: [2322],
        },
        { apply: () => rm(dependency), codes: [2307] },
        { apply: () => writeFile(dependency, 'export const value = 1;\n'), codes: [] },
      ]
      let id = 10
      for (const change of changes) {
        socket.sent.length = 0
        await change.apply()
        await assertExternalDiagnostics(session, socket, native, uri, id++, change.codes)
      }
    },
  )

  it.each(RUNTIMES)('serves editor features with $packageName', async ({ packageName, native }) => {
    const fixture = await installedTypeScriptRuntimeFixture(packageName, {
      'package.json': '{"private":true,"type":"module"}\n',
      'tsconfig.json': '{"compilerOptions":{"strict":true},"files":["probe.ts"]}\n',
      'probe.ts': SOURCE,
      'nested/my-helper.ts': 'export function helper() { return 1 }\n',
    })
    fixtures.push(fixture)
    const { root, version } = fixture
    const filePath = path.join(root, 'probe.ts')
    const uri = fileUriForPath(filePath)
    const match = await resolveLspServer({
      filePath,
      serverId: 'typescript',
      settings: SETTINGS,
      workspaceRoot: root,
    })
    if (!match) throw createInternalError('TypeScript fixture did not match its language server')

    const pool = watchedPool()
    const socket = new RecordingSocket()
    const session = await pool.acquire(socket, match, root)
    if (!session) throw createInternalError('TypeScript fixture did not start its language server')

    const initialized = await request(session, socket, 1, 'initialize', initializeParams(root))
    expect(initialized).toMatchObject({
      capabilities: {
        completionProvider: { resolveProvider: true },
        hoverProvider: true,
        definitionProvider: true,
        semanticTokensProvider: { full: true },
      },
    })
    await notify(session, 'initialized', {})
    await assertRuntime(initialized, socket, native, version)
    await notify(session, 'textDocument/didOpen', {
      textDocument: { languageId: 'typescript', text: SOURCE, uri, version: 1 },
    })
    await assertDiagnostics(session, socket, native, uri)

    const textDocument = { uri }
    const position = { line: 1, character: 2 }
    const hover = await request(session, socket, 3, 'textDocument/hover', {
      textDocument,
      position,
    })
    expect(hover).toMatchObject({
      contents: {
        kind: 'markdown',
        value: expect.stringContaining('```typescript\nconst count: number\n```'),
      },
    })
    const definition = await request(session, socket, 4, 'textDocument/definition', {
      textDocument,
      position,
    })
    expect(definition).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          targetUri: uri,
          targetSelectionRange: {
            start: { line: 0, character: 6 },
            end: { line: 0, character: 11 },
          },
        }),
      ]),
    )
    const completion = await request(session, socket, 5, 'textDocument/completion', {
      textDocument,
      position: { line: 1, character: 6 },
      context: { triggerKind: 1 },
    })
    expect(completion).toMatchObject({
      items: expect.arrayContaining([expect.objectContaining({ label: 'toFixed' })]),
    })
    const tokens = await request(session, socket, 6, 'textDocument/semanticTokens/full', {
      textDocument,
    })
    expect(tokens).toMatchObject({ data: expect.arrayContaining([expect.any(Number)]) })

    for (const character of ['/', '-']) {
      const imported = await request(
        session,
        socket,
        7 + IMPORT.indexOf(character),
        'textDocument/definition',
        {
          textDocument,
          position: { line: 2, character: IMPORT.indexOf(character) },
        },
      )
      expect(imported).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            targetUri: fileUriForPath(path.join(root, 'nested/my-helper.ts')),
            originSelectionRange: {
              start: { line: 2, character: IMPORT.indexOf('"') },
              end: { line: 2, character: IMPORT.lastIndexOf('"') + 1 },
            },
          }),
        ]),
      )
    }
  })
})

async function assertExternalDiagnostics(
  session: LspProxyClientSession,
  socket: RecordingSocket,
  native: boolean,
  uri: string,
  id: number,
  codes: readonly number[],
) {
  const expected = codes.map((code) => expect.objectContaining({ code }))
  if (!native) {
    await expect
      .poll(() => socket.notification('textDocument/publishDiagnostics'), { timeout: 20_000 })
      .toMatchObject({ uri, diagnostics: expected })
    return
  }
  await expect
    .poll(() => socket.sent.some((message) => message.method === 'workspace/diagnostic/refresh'), {
      timeout: 20_000,
    })
    .toBe(true)
  const result = await request(session, socket, id, 'textDocument/diagnostic', {
    identifier: 'typescript',
    textDocument: { uri },
  })
  expect(result).toMatchObject({ kind: 'full', items: expected })
}

function initializeParams(root: string) {
  const capabilities = mergeClientCapabilities(
    defaultClientCapabilities(),
    semanticTokensClientCapability({
      augmentsSyntaxTokens: true,
      formats: ['relative'],
      requests: { full: { delta: false }, range: true },
    }),
  )
  return {
    capabilities,
    clientInfo: { name: '@singapore-editor/lsp' },
    processId: process.pid,
    rootUri: fileUriForPath(root),
    workspaceFolders: [{ name: path.basename(root), uri: fileUriForPath(root) }],
  }
}

async function assertRuntime(
  initialized: unknown,
  socket: RecordingSocket,
  native: boolean,
  version: string,
) {
  if (native) {
    expect(initialized).toMatchObject({ serverInfo: { name: 'typescript-go', version } })
    return
  }

  await expect.poll(() => socket.notification('$/typescriptVersion')).toMatchObject({ version })
}

async function assertDiagnostics(
  session: LspProxyClientSession,
  socket: RecordingSocket,
  native: boolean,
  uri: string,
) {
  const expected = expect.arrayContaining([
    expect.objectContaining({
      code: 2322,
      message: "Type 'string' is not assignable to type 'number'.",
    }),
  ])
  if (native) {
    const result = await request(session, socket, 2, 'textDocument/diagnostic', {
      identifier: 'typescript',
      textDocument: { uri },
    })
    expect(result).toMatchObject({ kind: 'full', items: expected })
    return
  }

  await expect
    .poll(() => socket.notification('textDocument/publishDiagnostics'), { timeout: 20_000 })
    .toMatchObject({ uri, diagnostics: expected })
}

async function request(
  session: LspProxyClientSession,
  socket: RecordingSocket,
  id: number,
  method: string,
  params: unknown,
) {
  await session.handleClientMessage(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
  await expect.poll(() => socket.answer(id), { timeout: 20_000 }).toBeDefined()
  const answer = socket.answer(id)
  expect(answer).not.toHaveProperty('error')
  return answer?.result
}

function notify(session: LspProxyClientSession, method: string, params: unknown) {
  return session.handleClientMessage(JSON.stringify({ jsonrpc: '2.0', method, params }))
}
