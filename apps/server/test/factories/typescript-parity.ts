import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { LspClient, type LspTransport, type LspTransportHandler } from '@singapore-editor/lsp'
import { fileUriForPath } from '@workspace/contracts'
import {
  capabilityAdvertised,
  coreClientCapabilities,
  isRecord,
  type ParityDiagnostic,
  type ParitySession,
} from '../../../../editor/packages/typescript-lsp/test/parity/contract'
import {
  CORE_PROJECT,
  openAndEditCoreProject,
  positionOf,
} from '../../../../editor/packages/typescript-lsp/test/parity/cases/project'
import { diagnosticsFromReport } from '../../../../editor/packages/typescript-lsp/test/parity/validators'
import { createInternalError } from '../../src/observability/structured-errors'
import {
  LspSessionPool,
  type LspProxyClientSession,
  type LspProxySocket,
} from '../../src/lsp/proxy-session'
import { resolveLspServer, type LspServerMatch } from '../../src/lsp/registry'
import { resolveTypeScriptRuntime } from '../../src/lsp/typescript/runtime'
import { installedTypeScriptRuntimeFixture } from './typescript-runtime'

export const TYPESCRIPT_PARITY_RUNTIMES = [
  { id: 'typescript-classic', packageName: 'typescript-language-service', kind: 'legacy' },
  { id: 'typescript-native', packageName: 'typescript', kind: 'native' },
] as const

type ParityRuntime = (typeof TYPESCRIPT_PARITY_RUNTIMES)[number]
type ChildClose = {
  readonly pid: number | undefined
  readonly code: number | null
  readonly signal: NodeJS.Signals | null
}

type ParityMessage = {
  readonly direction: 'client' | 'server'
  readonly message: unknown
}

class PoolParityTransport implements LspTransport {
  readonly messages: ParityMessage[] = []
  readonly socket: LspProxySocket = {
    close: () => {
      this.closed = true
    },
    send: (message) => {
      this.messages.push({ direction: 'server', message: JSON.parse(message) })
      for (const handler of this.handlers) handler(message)
    },
  }
  private readonly handlers = new Set<LspTransportHandler>()
  private connection: LspProxyClientSession | null = null
  private closed = false
  private outgoing = Promise.resolve()
  private sendFailure: unknown

  attach(connection: LspProxyClientSession): void {
    this.connection = connection
  }

  isClosed(): boolean {
    return this.closed
  }

  send(message: string): void {
    const connection = this.connection
    if (!connection || this.closed) throw createInternalError('Parity transport is closed')
    this.messages.push({ direction: 'client', message: JSON.parse(message) })
    this.outgoing = this.outgoing.then(() => connection.handleClientMessage(message))
    void this.outgoing.catch((cause) => {
      this.sendFailure = cause
      this.closed = true
    })
  }

  subscribe(handler: LspTransportHandler): void {
    this.handlers.add(handler)
  }

  unsubscribe(handler: LspTransportHandler): void {
    this.handlers.delete(handler)
  }

  async dispose(): Promise<void> {
    this.closed = true
    this.connection?.dispose()
    this.handlers.clear()
    await this.outgoing.catch(() => {})
    if (this.sendFailure) throw this.sendFailure
  }
}

export async function createTypeScriptParityFixture(runtime: ParityRuntime) {
  const project = await installedTypeScriptRuntimeFixture(runtime.packageName, {
    'package.json': JSON.stringify({ private: true, type: 'module' }),
    'tsconfig.json': JSON.stringify({
      compilerOptions: {
        strict: true,
        target: 'ESNext',
        module: 'ESNext',
        moduleResolution: 'Bundler',
      },
      include: ['src/**/*.ts'],
    }),
    ...Object.fromEntries(CORE_PROJECT.files.map((file) => [file.path, file.text])),
  })
  const pool = new LspSessionPool(() => 120_000)
  const transport = new PoolParityTransport()
  const children: Promise<ChildClose>[] = []
  const published = new Map<string, readonly ParityDiagnostic[]>()
  const rootUri = fileUriForPath(project.root)
  const client = new LspClient({
    rootUri,
    workspaceFolders: [{ uri: rootUri, name: CORE_PROJECT.id }],
    timeoutMs: 20_000,
    capabilities: coreClientCapabilities(),
    notificationHandlers: {
      'textDocument/publishDiagnostics': (_client, params) => {
        if (!isRecord(params) || typeof params.uri !== 'string') return false
        published.set(
          params.uri,
          diagnosticsFromReport({ kind: 'full', items: params.diagnostics }),
        )
        return true
      },
    },
  })
  const session: ParitySession = {
    client,
    get capabilities() {
      return client.serverCapabilities
    },
    uri: (relativePath) => fileUriForPath(path.join(project.root, relativePath)),
    diagnostics: async () => {
      const uri = session.uri(CORE_PROJECT.mainPath)
      if (capabilityAdvertised(session.capabilities, 'diagnosticProvider')) {
        return diagnosticsFromReport(
          await client.request('textDocument/diagnostic', { textDocument: { uri } }),
        )
      }
      return waitForCorePublishedDiagnostics(published, uri)
    },
  }
  let cleanup: Promise<{
    readonly children: readonly ChildClose[]
    readonly poolSize: number
  }> | null = null
  const dispose = () => {
    cleanup ??= disposeParityFixture({ client, transport, pool, children, project })
    return cleanup
  }
  try {
    const resolved = await resolveTypeScriptRuntime(project.root)
    if (resolved.kind !== runtime.kind) {
      throw createInternalError('Parity fixture selected the wrong TypeScript runtime')
    }
    const adapterVersion = resolved.kind === 'legacy' ? await installedAdapterVersion() : null
    const metadata = {
      backend: runtime.id,
      compilerVersion: resolved.version,
      adapterVersion,
      runtimeKind: resolved.kind,
      runtimeEntrypoint: resolved.entrypoint,
      transport: 'pool-stdio',
      projectId: CORE_PROJECT.id,
    }
    return {
      session,
      client,
      metadata,
      messages: transport.messages,
      root: project.root,
      dispose,
      async initialize(): Promise<void> {
        const match = await resolveLspServer({
          filePath: path.join(project.root, CORE_PROJECT.mainPath),
          serverId: 'typescript',
          settings: { servers: {}, languageServers: {}, tyForPython: false },
          workspaceRoot: project.root,
        })
        if (!match) throw createInternalError('Parity fixture has no TypeScript server match')
        const connection = await pool.acquire(
          transport.socket,
          collectChildren(match, children),
          project.root,
        )
        if (!connection) throw createInternalError('Parity fixture could not acquire its server')
        transport.attach(connection)
        await client.connect(transport)
        await openAndEditCoreProject(session)
      },
    }
  } catch (cause) {
    await dispose()
    throw cause
  }
}

function collectChildren(match: LspServerMatch, children: Promise<ChildClose>[]): LspServerMatch {
  return {
    ...match,
    server: {
      ...match.server,
      spawn: async (root) => {
        const handle = await match.server.spawn(root)
        if (handle) children.push(childClosed(handle.process))
        return handle
      },
    },
  }
}

function childClosed(child: ChildProcessWithoutNullStreams): Promise<ChildClose> {
  return new Promise((resolve) => {
    child.once('close', (code, signal) => resolve({ pid: child.pid, code, signal }))
  })
}

async function disposeParityFixture({
  client,
  transport,
  pool,
  children,
  project,
}: {
  readonly client: LspClient
  readonly transport: PoolParityTransport
  readonly pool: LspSessionPool
  readonly children: readonly Promise<ChildClose>[]
  readonly project: Awaited<ReturnType<typeof installedTypeScriptRuntimeFixture>>
}) {
  client.disconnect()
  const transportCleanup = Promise.allSettled([transport.dispose()])
  pool.disposeAll()
  const closed = await Promise.all(children)
  await project.dispose()
  const [transportResult] = await transportCleanup
  if (transportResult?.status === 'rejected') throw transportResult.reason
  return { children: closed, poolSize: pool.size }
}

async function installedAdapterVersion(): Promise<string> {
  const metadata: unknown = JSON.parse(
    await readFile(
      fileURLToPath(import.meta.resolve('typescript-language-server/package.json')),
      'utf8',
    ),
  )
  if (!isRecord(metadata) || typeof metadata.version !== 'string') {
    throw createInternalError('Parity fixture adapter package has no version')
  }
  return metadata.version
}

export async function waitForCorePublishedDiagnostics(
  published: ReadonlyMap<string, readonly ParityDiagnostic[]>,
  uri: string,
): Promise<readonly ParityDiagnostic[]> {
  const start = positionOf(CORE_PROJECT.editedMainText, CORE_PROJECT.unsavedDiagnosticMarker)
  const endCharacter = start.character + CORE_PROJECT.unsavedDiagnosticMarker.length
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    const diagnostics = published.get(uri)
    if (
      diagnostics?.some(
        (diagnostic) =>
          diagnostic.code === 2304 &&
          diagnostic.range.start.line === start.line &&
          diagnostic.range.start.character === start.character &&
          diagnostic.range.end.line === start.line &&
          diagnostic.range.end.character === endCharacter,
      )
    )
      return diagnostics
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw createInternalError('Parity fixture received no post-edit diagnostic publication')
}
