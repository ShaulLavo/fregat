import { filesystemPath } from '@/lib/documents/utils/identity'
import { createTextDiff } from '@singapore-editor/diff'
import type { LspTransportHandler } from '@singapore-editor/lsp/types'
import type {
  LspManagedTransport,
  LspWebSocketConstructor,
  LspWebSocketLike,
} from '@singapore-editor/lsp'
import type { LanguageServerLaneOptions } from '@singapore-editor/lsp-plugin/websocket'
import type { LspConnectionCallbacks, LspConnectionOptions } from '@singapore-editor/lsp-plugin'
import {
  acquireLanguageServerLane,
  type AcquiredLanguageServerLane,
} from '@singapore-editor/lsp-plugin/websocket'
import type { ParsedWorkspaceEdit } from '@singapore-editor/lsp-plugin/workspace-edit'
import { QueryClient } from '@tanstack/react-query'
import { afterEach, vi } from 'vitest'

import { diffLanguageServerMatches } from '@/features/editor/hooks/use-diff-language'
import { createEditorDocumentStore } from '@/features/editor/state/document-state'
import { FileSyncService } from '@/features/editor/state/file-sync-service'
import {
  diffLanguageServerConnectionProvider,
  languageServerConnectionProvider,
  resetLanguageServerConnectionPool,
} from '@/features/editor/state/language-server-connection-pool'
import { WorkspaceEditService } from '@/features/editor/state/workspace-edit-service'
import { diffLanguageDocuments } from '@/features/editor/utils/diff-documents'
import {
  languageServerLaneOptions,
  type LanguageServerMatch,
} from '@/features/editor/utils/language-server-plugin'
import { expect, test } from '../../../../../test/fixtures'

afterEach(resetLanguageServerConnectionPool)

const ROOT_PATH = filesystemPath('/repo')
const SERVER_ID = 'typescript'
const ACQUISITION_ORDERS = [
  ['normal', 'diff'],
  ['diff', 'normal'],
] as const

type ClientOwner = (typeof ACQUISITION_ORDERS)[number][number]
type JsonMessage = Readonly<Record<string, unknown>>

test('keeps hover and navigation candidates independent', () => {
  const matches = [
    match('hover-only', { hover: 0 }),
    match('fallback', { hover: 5, navigation: 5 }),
    match('preferred', { hover: 1, navigation: 3 }),
  ]

  expect(diffLanguageServerMatches(matches).map((item) => item.serverId)).toEqual([
    'hover-only',
    'fallback',
    'preferred',
  ])
})

test('drops matches that cannot answer either diff feature', () => {
  const matches = [match('diagnostics', { diagnostics: 0 }), match('navigation', { navigation: 1 })]

  expect(diffLanguageServerMatches(matches).map((item) => item.serverId)).toEqual(['navigation'])
  expect(diffLanguageServerMatches(null)).toEqual([])
})

test('gives every diff a browser owner while retaining one backend route', () => {
  resetLanguageServerConnectionPool()
  const createdRoutes: string[] = []
  const route = 'ws://localhost/lsp?root=/repo&path=src/file.ts&server=typescript'
  const options: LspConnectionOptions = {
    createTransport: () => {
      createdRoutes.push(route)
      return new InertTransport()
    },
    initializationOptions: undefined,
    rootUri: 'file:///repo',
    timeoutMs: 15_000,
  }
  const callbacks: LspConnectionCallbacks = {
    onConnected: () => undefined,
    onPublishDiagnostics: () => undefined,
    onUnavailable: () => undefined,
  }
  const key = { origin: 'http://localhost:3001', rootPath: '/repo', serverId: 'typescript' }
  const leases = [
    languageServerConnectionProvider(key).acquire(options, callbacks),
    languageServerConnectionProvider(key).acquire(options, callbacks),
    diffLanguageServerConnectionProvider({ ...key, sessionId: 'first' }).acquire(
      options,
      callbacks,
    ),
    diffLanguageServerConnectionProvider({ ...key, sessionId: 'second' }).acquire(
      options,
      callbacks,
    ),
  ]

  expect(createdRoutes).toEqual([route, route, route])

  for (const lease of leases) lease.release()
})

test('normal-first and diff-first clients share one exact initialize contract and host policy', async () => {
  for (const order of ACQUISITION_ORDERS) await assertInitializeContractAndHostPolicy(order)
})

async function assertInitializeContractAndHostPolicy(
  order: readonly [ClientOwner, ClientOwner],
): Promise<void> {
  resetLanguageServerConnectionPool()
  WorkspaceEditSocket.reset()
  const harness = createHostPolicyHarness()
  const targetUri = createSyntheticDiffTarget()
  const host = harness.service.onApplyWorkspaceEdit
  const normal = testLaneOptions(
    languageServerLaneOptions({
      origin: 'http://localhost:3001',
      connectionProvider: languageServerConnectionProvider({
        origin: 'http://localhost:3001',
        rootPath: ROOT_PATH,
        serverId: SERVER_ID,
      }),
      match: match(SERVER_ID, { hover: 0 }),
      onApplyWorkspaceEdit: host,
      rootPath: ROOT_PATH,
      target: { matchPath: 'src/index.ts' },
    }),
  )
  const diff = testLaneOptions(
    languageServerLaneOptions({
      origin: 'http://localhost:3001',
      connectionProvider: diffLanguageServerConnectionProvider({
        origin: 'http://localhost:3001',
        rootPath: ROOT_PATH,
        serverId: SERVER_ID,
        sessionId: 'host-policy',
      }),
      match: match(SERVER_ID, { hover: 0 }),
      onApplyWorkspaceEdit: host,
      rootPath: ROOT_PATH,
      target: { matchPath: 'src/index.ts' },
    }),
  )
  const options = { diff, normal }
  const acquired: Partial<Record<ClientOwner, AcquiredLanguageServerLane>> = {}

  try {
    expect(normal.onApplyWorkspaceEdit).toBe(host)
    expect(diff.onApplyWorkspaceEdit).toBe(host)
    for (const owner of order) acquired[owner] = acquireLanguageServerLane(options[owner])

    await vi.waitFor(() => expect(WorkspaceEditSocket.instances).toHaveLength(2))
    await vi.waitFor(() =>
      expect(WorkspaceEditSocket.instances.every((socket) => socket.hasInitialize())).toBe(true),
    )
    const contracts = WorkspaceEditSocket.instances.map((socket) =>
      immutableInitializeContract(socket.initializeMessage()),
    )
    expect(contracts[1]).toEqual(contracts[0])
    expect(contracts[0]?.capabilities).toMatchObject({
      workspace: {
        workspaceEdit: {
          changeAnnotationSupport: { groupsOnLabel: true },
          documentChanges: true,
          failureHandling: 'undo',
          normalizesLineEndings: true,
          resourceOperations: ['create', 'rename', 'delete'],
        },
      },
    })

    for (const socket of WorkspaceEditSocket.instances) socket.answerInitialize()
    const normalLane = requiredLane(acquired.normal, 'normal')
    const diffLane = requiredLane(acquired.diff, 'diff')
    await Promise.all([normalLane.ready, diffLane.ready])

    const result = await dispatchDiffWorkspaceEdit(diff, diffLane, targetUri)
    expect(result).toMatchObject({ code: 'missing-target', status: 'failed' })
    expect(harness.service.getSnapshot()).toMatchObject({ phase: 'failed', preview: null })
    expect(harness.readFileContent).not.toHaveBeenCalled()
  } finally {
    for (const lane of Object.values(acquired)) lane?.release()
    resetLanguageServerConnectionPool()
    WorkspaceEditSocket.reset()
    harness.dispose()
  }
}

async function dispatchDiffWorkspaceEdit(
  options: LanguageServerLaneOptions,
  lane: AcquiredLanguageServerLane,
  targetUri: string,
) {
  const plan = {
    annotations: new Map(),
    operations: [
      {
        edits: [
          {
            newText: 'fixed',
            range: {
              end: { character: 3, line: 0 },
              start: { character: 0, line: 0 },
            },
          },
        ],
        kind: 'text-document',
        uri: targetUri,
        version: 0,
      },
    ],
  } satisfies ParsedWorkspaceEdit
  const apply = options.onApplyWorkspaceEdit
  if (!apply) throw new RangeError('Diff lane lost its WorkspaceEdit host')

  return apply({
    guard: { documents: [], isCurrent: (uri) => uri === targetUri },
    label: 'Apply diff code action',
    logicalRevisionScope: lane.logicalRevisionScope,
    originUri: targetUri,
    originVersion: 0,
    plan,
    serverId: SERVER_ID,
    signal: new AbortController().signal,
    source: 'code-action',
  })
}

function createHostPolicyHarness() {
  const store = createEditorDocumentStore()
  const queryClient = new QueryClient()
  const readFileContent = vi.fn(rejectUnexpectedFileAccess)
  const fileSync = new FileSyncService(store, queryClient, {
    readFileContent,
    writeFileContent: rejectUnexpectedFileAccess,
  })
  const service = new WorkspaceEditService({
    owner: { environmentId: null, machine: null },
    documentStore: store,
    fileSync,
    getRoot: () => ({ generation: 1, path: ROOT_PATH }),
    inspectPath: async (path) => ({ exists: false, path }),
  })

  return {
    dispose: () => {
      service.dispose()
      queryClient.clear()
    },
    readFileContent,
    service,
    store,
  }
}

function createSyntheticDiffTarget(): string {
  const file = createTextDiff({
    newFile: { path: 'src/index.ts', text: 'const next = 2\n' },
    oldFile: { path: 'src/index.ts', text: 'const prior = 1\n' },
  })
  const target = diffLanguageDocuments({
    documentPath: `${ROOT_PATH}/src/index.ts`,
    file,
    newSideIsWorkingTree: true,
    ownedText: null,
  }).find((document) => document.side === 'old')
  if (!target) throw new RangeError('Diff did not create its synthetic old-side document')

  return target.uri
}

function testLaneOptions(options: LanguageServerLaneOptions): LanguageServerLaneOptions {
  return {
    ...options,
    webSocketTransportOptions: {
      ...options.webSocketTransportOptions,
      WebSocketCtor: WorkspaceEditSocket as unknown as LspWebSocketConstructor,
    },
  }
}

function immutableInitializeContract(message: JsonMessage) {
  const params = record(message.params, 'initialize params')
  return {
    capabilities: params.capabilities,
    clientInfo: params.clientInfo,
    initializationOptions: params.initializationOptions,
    rootUri: params.rootUri,
  }
}

function requiredLane(
  lane: AcquiredLanguageServerLane | undefined,
  owner: ClientOwner,
): AcquiredLanguageServerLane {
  if (lane) return lane
  throw new RangeError(`Missing acquired ${owner} lane`)
}

async function rejectUnexpectedFileAccess(): Promise<never> {
  throw new RangeError('Synthetic diff policy reached file persistence')
}

function record(value: unknown, label: string): JsonMessage {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as JsonMessage
  }
  throw new RangeError(`Missing ${label}`)
}

function match(serverId: string, features: LanguageServerMatch['features']): LanguageServerMatch {
  return { features, root: '/repo', serverId }
}

class InertTransport implements LspManagedTransport {
  readonly #handlers = new Set<LspTransportHandler>()

  send(): void {}

  subscribe(handler: LspTransportHandler): void {
    this.#handlers.add(handler)
  }

  unsubscribe(handler: LspTransportHandler): void {
    this.#handlers.delete(handler)
  }

  onDidClose(): () => void {
    return () => undefined
  }

  close(): void {
    this.#handlers.clear()
  }
}

type SocketEventType = 'close' | 'error' | 'message' | 'open'

class WorkspaceEditSocket implements LspWebSocketLike {
  static readonly instances: WorkspaceEditSocket[] = []
  readonly readyState = 1
  readonly #handlers = new Map<SocketEventType, Set<EventListener>>()
  readonly #sent: string[] = []

  constructor(_url: string | URL, _protocols?: string | readonly string[]) {
    WorkspaceEditSocket.instances.push(this)
  }

  static reset(): void {
    WorkspaceEditSocket.instances.length = 0
  }

  send(message: string): void {
    this.#sent.push(message)
  }

  close(): void {
    this.#handlers.clear()
  }

  addEventListener(type: SocketEventType, handler: EventListener): void {
    const handlers = this.#handlers.get(type) ?? new Set<EventListener>()
    handlers.add(handler)
    this.#handlers.set(type, handlers)
  }

  removeEventListener(type: SocketEventType, handler: EventListener): void {
    this.#handlers.get(type)?.delete(handler)
  }

  hasInitialize(): boolean {
    return this.messages().some((message) => message.method === 'initialize')
  }

  initializeMessage(): JsonMessage {
    const initialize = this.messages().find((message) => message.method === 'initialize')
    if (initialize) return initialize
    throw new RangeError('Missing initialize request')
  }

  answerInitialize(): void {
    const initialize = this.initializeMessage()
    this.receive({
      id: initialize.id,
      jsonrpc: '2.0',
      result: {
        capabilities: { textDocumentSync: { change: 2, openClose: true } },
      },
    })
  }

  private messages(): readonly JsonMessage[] {
    return this.#sent.map((message) => record(JSON.parse(message), 'LSP message'))
  }

  private receive(message: JsonMessage): void {
    const event = { data: JSON.stringify(message) } as unknown as Event
    for (const handler of this.#handlers.get('message') ?? []) handler(event)
  }
}
