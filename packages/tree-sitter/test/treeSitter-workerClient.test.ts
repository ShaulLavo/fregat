import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPieceTableSnapshot } from '@singapore-editor/core/document'
import type { TreeSitterLanguageDescriptor } from '../src'
import type {
  TreeSitterParseRequest,
  TreeSitterParseAckResult,
  TreeSitterParseResult,
  TreeSitterRangeRequest,
  TreeSitterRangeResult,
  TreeSitterWorkerRequest,
  TreeSitterWorkerRequestPayload,
  TreeSitterWorkerResult,
} from '../src/treeSitter/types'
import type { TreeSitterParsePayload } from '../src/treeSitter/workerClient.ts'

type WorkerClientModule = typeof import('../src/treeSitter/workerClient.ts')
type WorkerClient = InstanceType<WorkerClientModule['TreeSitterWorkerClient']>

type FakeWorkerRequest = TreeSitterWorkerRequest

const fakeWorkers: FakeWorker[] = []
let currentClient: WorkerClient | null = null

class FakeWorker {
  static autoResolve = true

  public onmessage: ((event: MessageEvent) => void) | null = null
  public onerror: ((event: ErrorEvent) => void) | null = null
  public readonly messages: FakeWorkerRequest[] = []
  private terminated = false

  public constructor() {
    fakeWorkers.push(this)
  }

  public postMessage(message: FakeWorkerRequest): void {
    this.messages.push(message)
    if (FakeWorker.autoResolve) queueMicrotask(() => this.resolveRequest(message))
  }

  public terminate(): void {
    this.terminated = true
  }

  public get isTerminated(): boolean {
    return this.terminated
  }

  public resolveRequest(message: FakeWorkerRequest, result?: TreeSitterWorkerResult): void {
    if (this.terminated) return

    this.onmessage?.({
      data: { id: message.id, ok: true, result },
    } as MessageEvent)
  }

  public rejectRequest(message: FakeWorkerRequest, error: string): void {
    if (this.terminated) return

    this.onmessage?.({
      data: { id: message.id, ok: false, error },
    } as MessageEvent)
  }
}

describe('tree-sitter worker client language registration cache', () => {
  afterEach(async () => {
    FakeWorker.autoResolve = true
    await currentClient?.dispose()
    currentClient = null
    fakeWorkers.length = 0
    vi.unstubAllGlobals()
  })

  it('does not post duplicate language descriptors', async () => {
    const client = await loadWorkerClient()
    const descriptor = languageDescriptor('typescript')

    await client.registerLanguages([descriptor])
    await client.registerLanguages([descriptor])

    expect(registerLanguageRequests()).toHaveLength(1)
  })

  it('posts changed descriptors for the same language id', async () => {
    const client = await loadWorkerClient()

    await client.registerLanguages([languageDescriptor('typescript')])
    await client.registerLanguages([
      languageDescriptor('typescript', '(identifier) @variable.builtin'),
    ])

    expect(registerLanguageRequests()).toHaveLength(2)
  })

  it('clears registered descriptor cache when the worker is disposed', async () => {
    const client = await loadWorkerClient()
    const descriptor = languageDescriptor('typescript')

    await client.registerLanguages([descriptor])
    await client.dispose()
    const workerClientModule = await import('../src/treeSitter/workerClient.ts')
    const nextClient = new workerClientModule.TreeSitterWorkerClient()
    currentClient = nextClient
    await nextClient.registerLanguages([descriptor])

    expect(registerLanguageRequests()).toHaveLength(2)
  })

  it('creates a fresh worker after a worker error rejects an in-flight request', async () => {
    const client = await loadWorkerClient()
    const descriptor = languageDescriptor('typescript')
    const registration = client.registerLanguages([descriptor])
    const firstWorker = fakeWorkerAt(0)

    firstWorker.onerror?.({ message: 'boom' } as ErrorEvent)

    await expect(registration).rejects.toThrow('boom')
    expect(client.inspect()).toMatchObject({
      cache: {
        registeredLanguages: 0,
        sourceChunks: { documents: 0, sentChunks: 0, sourceEpochs: 0 },
      },
      lastError: 'boom',
      lifecycle: 'crashed',
      pendingRequests: 0,
    })
    await client.registerLanguages([descriptor])
    const nextWorker = fakeWorkerAt(1)

    expect(firstWorker.isTerminated).toBe(true)
    expect(fakeWorkers).toHaveLength(2)
    expect(nextWorker.messages.some((message) => message.payload.type === 'init')).toBe(true)
    expect(
      nextWorker.messages.some((message) => message.payload.type === 'registerLanguages'),
    ).toBe(true)
  })

  it('exposes worker lifecycle and source chunk cache accounting', async () => {
    FakeWorker.autoResolve = false
    const client = await loadWorkerClient()
    const owner = client

    expect(owner.inspect()).toMatchObject({
      cache: {
        registeredLanguages: 0,
        sourceChunks: { documents: 0, sentChunks: 0, sourceEpochs: 0 },
      },
      lifecycle: 'idle',
      pendingRequests: 0,
      workerGeneration: 0,
    })

    const snapshot = createPieceTableSnapshot('const answer = 1;')
    const parse = owner.parse(parsePayload(snapshot, 1))
    const worker = fakeWorkerAt(0)

    expect(owner.inspect()).toMatchObject({
      lifecycle: 'initializing',
      pendingRequests: 1,
      workerGeneration: 1,
    })

    worker.resolveRequest(requestOfType(worker, 'init'))
    await flushMicrotasks()
    const request = parseRequests(worker)[0]!

    expect(owner.inspect()).toMatchObject({
      cache: { sourceChunks: { documents: 1, sentChunks: 0, sourceEpochs: 0 } },
      lifecycle: 'ready',
      pendingRequests: 1,
    })

    worker.resolveRequest(request, parseResult(1))
    await expect(parse).resolves.toMatchObject({ snapshotVersion: 1 })

    expect(owner.inspect()).toMatchObject({
      cache: { sourceChunks: { documents: 1, sentChunks: 1, sourceEpochs: 0 } },
      lifecycle: 'ready',
      pendingRequests: 0,
    })

    FakeWorker.autoResolve = true
    await owner.dispose()

    expect(owner.inspect()).toMatchObject({
      cache: {
        registeredLanguages: 0,
        sourceChunks: { documents: 0, sentChunks: 0, sourceEpochs: 0 },
      },
      lifecycle: 'disposed',
      pendingRequests: 0,
    })
  })

  it('does not mark document source chunks as sent when a request fails', async () => {
    FakeWorker.autoResolve = false
    const client = await loadWorkerClient()
    const snapshot = createPieceTableSnapshot('const answer = 1;')
    const firstParse = client.parse(parsePayload(snapshot, 1))
    const worker = fakeWorkerAt(0)

    worker.resolveRequest(requestOfType(worker, 'init'))
    await flushMicrotasks()
    const failedRequest = parseRequests(worker)[0]!
    expect(failedRequest.payload.source.chunks.length).toBeGreaterThan(0)

    worker.rejectRequest(failedRequest, 'parse failed')
    await expect(firstParse).rejects.toThrow('parse failed')

    const retryParse = client.parse(parsePayload(snapshot, 2))
    await flushMicrotasks()
    const retryRequest = parseRequests(worker)[1]!

    expect(retryRequest.payload.source.chunks.length).toBeGreaterThan(0)
    worker.resolveRequest(retryRequest, parseResult(2))
    await expect(retryParse).resolves.toMatchObject({ snapshotVersion: 2 })
  })

  it('does not mark source chunks as sent from responses after document disposal', async () => {
    FakeWorker.autoResolve = false
    const client = await loadWorkerClient()
    const snapshot = createPieceTableSnapshot('const answer = 1;')
    const parse = client.parse(parsePayload(snapshot, 1))
    const worker = fakeWorkerAt(0)

    worker.resolveRequest(requestOfType(worker, 'init'))
    await flushMicrotasks()
    const staleRequest = parseRequests(worker)[0]!
    expect(staleRequest.payload.source.chunks.length).toBeGreaterThan(0)

    client.disposeDocument('runtime-doc.ts')
    worker.resolveRequest(staleRequest, parseResult(1))
    await expect(parse).resolves.toMatchObject({ snapshotVersion: 1 })

    const retryParse = client.parse(parsePayload(snapshot, 2))
    await flushMicrotasks()
    const retryRequest = parseRequests(worker)[1]!

    expect(retryRequest.payload.source.chunks.length).toBeGreaterThan(0)
    worker.resolveRequest(retryRequest, parseResult(2))
    await expect(retryParse).resolves.toMatchObject({ snapshotVersion: 2 })
  })

  it('resends source chunks after source cache errors', async () => {
    FakeWorker.autoResolve = false
    const client = await loadWorkerClient()
    const snapshot = createPieceTableSnapshot('const answer = 1;')
    const firstParse = client.parse(parsePayload(snapshot, 1))
    const worker = fakeWorkerAt(0)

    worker.resolveRequest(requestOfType(worker, 'init'))
    await flushMicrotasks()
    const firstRequest = parseRequests(worker)[0]!
    expect(firstRequest.payload.source.chunks.length).toBeGreaterThan(0)
    worker.resolveRequest(firstRequest, parseResult(1))
    await expect(firstParse).resolves.toMatchObject({ snapshotVersion: 1 })
    expect(client.inspect().cache.sourceChunks).toMatchObject({
      documents: 1,
      sentChunks: 1,
      sourceEpochs: 0,
    })

    const failedParse = client.parse(parsePayload(snapshot, 2))
    await flushMicrotasks()
    const failedRequest = parseRequests(worker)[1]!
    expect(failedRequest.payload.source.chunks).toHaveLength(0)
    worker.rejectRequest(failedRequest, 'Tree-sitter source chunk "2:0" is missing')
    await expect(failedParse).rejects.toThrow('Tree-sitter source chunk')
    expect(client.inspect().cache.sourceChunks).toMatchObject({
      documents: 1,
      sentChunks: 0,
      sourceEpochs: 1,
    })

    const retryParse = client.parse(parsePayload(snapshot, 3))
    await flushMicrotasks()
    const retryRequest = parseRequests(worker)[2]!

    expect(retryRequest.payload.source.chunks.length).toBeGreaterThan(0)
    worker.resolveRequest(retryRequest, parseResult(3))
    await expect(retryParse).resolves.toMatchObject({ snapshotVersion: 3 })
  })

  it('requests captures by default and allows compact parse requests', async () => {
    FakeWorker.autoResolve = false
    const client = await loadWorkerClient()
    const snapshot = createPieceTableSnapshot('const answer = 1;')
    const parse = client.parse({
      ...parsePayload(snapshot, 1),
      includeCaptures: false,
    })
    const worker = fakeWorkerAt(0)

    worker.resolveRequest(requestOfType(worker, 'init'))
    await flushMicrotasks()
    const request = parseRequests(worker)[0]!

    expect(request.payload.includeCaptures).toBe(false)
    worker.resolveRequest(request, parseResult(1))
    await expect(parse).resolves.toMatchObject({ snapshotVersion: 1 })

    const defaultParse = client.parse(parsePayload(snapshot, 2))
    await flushMicrotasks()
    const defaultRequest = parseRequests(worker)[1]!

    expect(defaultRequest.payload.includeCaptures).toBeUndefined()
    worker.resolveRequest(defaultRequest, parseResult(2))
    await expect(defaultParse).resolves.toMatchObject({ snapshotVersion: 2 })
  })

  it('returns parse acknowledgements for parse-only requests', async () => {
    FakeWorker.autoResolve = false
    const client = await loadWorkerClient()
    const snapshot = createPieceTableSnapshot('const answer = 1;')
    const parse = client.parse({
      ...parsePayload(snapshot, 1),
      resultMode: 'parseOnly',
    })
    const worker = fakeWorkerAt(0)

    worker.resolveRequest(requestOfType(worker, 'init'))
    await flushMicrotasks()
    const request = parseRequests(worker)[0]!

    expect(request.payload.resultMode).toBe('parseOnly')
    worker.resolveRequest(request, parseAckResult(1))
    await expect(parse).resolves.toMatchObject({
      changedRanges: [{ startIndex: 0, endIndex: 17 }],
      snapshotVersion: 1,
      status: 'parsed',
    })
  })

  it('cancels only older range queries while leaving parse work active', async () => {
    FakeWorker.autoResolve = false
    const client = await loadWorkerClient()
    const snapshot = createPieceTableSnapshot('const answer = 1;')
    const parse = client.parse(parsePayload(snapshot, 1))
    const worker = fakeWorkerAt(0)

    worker.resolveRequest(requestOfType(worker, 'init'))
    await flushMicrotasks()
    const parseRequest = parseRequests(worker)[0]!
    const firstRange = client.queryRange(rangePayload(1, 0, 5))
    await flushMicrotasks()
    const firstRangeRequest = rangeRequests(worker)[0]!
    const secondRange = client.queryRange(rangePayload(1, 5, 12))
    await flushMicrotasks()
    const secondRangeRequest = rangeRequests(worker)[1]!

    expect(cancellationValue(parseRequest)).toBe(0)
    expect(cancellationValue(firstRangeRequest)).toBe(1)
    expect(cancellationValue(secondRangeRequest)).toBe(0)

    worker.resolveRequest(parseRequest, parseResult(1))
    worker.resolveRequest(firstRangeRequest, rangeResult(1, 0, 5))
    worker.resolveRequest(secondRangeRequest, rangeResult(1, 5, 12))

    await expect(parse).resolves.toMatchObject({ snapshotVersion: 1 })
    await expect(firstRange).resolves.toMatchObject({ range: { startIndex: 0, endIndex: 5 } })
    await expect(secondRange).resolves.toMatchObject({ range: { startIndex: 5, endIndex: 12 } })
  })

  it('keeps runtime disposal and its barrier behind a parse waiting on initialization', async () => {
    FakeWorker.autoResolve = false
    const client = await loadWorkerClient()
    const snapshot = createPieceTableSnapshot('const answer = 1;')
    const parse = client.parse(parsePayload(snapshot, 1))
    const worker = fakeWorkerAt(0)

    client.disposeDocument('runtime-doc.ts')
    let idle = false
    const barrier = client.awaitRuntimeSessionIdle('runtime-doc.ts').then(() => {
      idle = true
    })
    await flushMicrotasks()

    expect(worker.messages.map((message) => message.payload.type)).toEqual(['init'])
    expect(idle).toBe(false)

    worker.resolveRequest(requestOfType(worker, 'init'))
    await flushMicrotasks()
    expect(worker.messages.map((message) => message.payload.type)).toEqual(['init', 'parse'])

    worker.resolveRequest(requestOfType(worker, 'parse'), parseResult(1))
    await expect(parse).resolves.toMatchObject({ snapshotVersion: 1 })
    await flushMicrotasks()
    expect(worker.messages.map((message) => message.payload.type)).toEqual([
      'init',
      'parse',
      'disposeDocument',
    ])
    expect(idle).toBe(false)

    worker.resolveRequest(requestOfType(worker, 'disposeDocument'))
    await flushMicrotasks()
    await flushMicrotasks()
    expect(worker.messages.map((message) => message.payload.type)).toEqual([
      'init',
      'parse',
      'disposeDocument',
      'runtimeBarrier',
    ])
    expect(idle).toBe(false)

    worker.resolveRequest(requestOfType(worker, 'runtimeBarrier'))
    await barrier
    expect(idle).toBe(true)
  })
})

async function loadWorkerClient(): Promise<WorkerClient> {
  fakeWorkers.length = 0
  vi.stubGlobal('Worker', FakeWorker)
  const workerClientModule = await import('../src/treeSitter/workerClient.ts')
  currentClient = new workerClientModule.TreeSitterWorkerClient()
  return currentClient
}

function registerLanguageRequests(): FakeWorkerRequest[] {
  return fakeWorkers.flatMap((worker) =>
    worker.messages.filter((message) => message.payload.type === 'registerLanguages'),
  )
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

function fakeWorkerAt(index: number): FakeWorker {
  const fakeWorker = fakeWorkers[index]
  if (!fakeWorker) throw new Error(`Expected fake worker at index ${index}`)
  return fakeWorker
}

function requestOfType<TType extends TreeSitterWorkerRequestPayload['type']>(
  worker: FakeWorker,
  type: TType,
): Extract<FakeWorkerRequest, { readonly payload: { readonly type: TType } }> {
  const request = worker.messages.find((message) => message.payload.type === type)
  if (!request) throw new Error(`Expected ${type} request`)
  return request as Extract<FakeWorkerRequest, { readonly payload: { readonly type: TType } }>
}

function parseRequests(worker: FakeWorker): TreeSitterParseWorkerRequest[] {
  return worker.messages.filter((message): message is TreeSitterParseWorkerRequest =>
    isParseRequest(message.payload),
  )
}

type TreeSitterParseWorkerRequest = FakeWorkerRequest & {
  readonly payload: TreeSitterParseRequest
}

function rangeRequests(worker: FakeWorker): TreeSitterRangeWorkerRequest[] {
  return worker.messages.filter((message): message is TreeSitterRangeWorkerRequest =>
    isRangeRequest(message.payload),
  )
}

type TreeSitterRangeWorkerRequest = FakeWorkerRequest & {
  readonly payload: TreeSitterRangeRequest
}

function isParseRequest(
  payload: TreeSitterWorkerRequestPayload,
): payload is TreeSitterParseRequest {
  return payload.type === 'parse'
}

function isRangeRequest(
  payload: TreeSitterWorkerRequestPayload,
): payload is TreeSitterRangeRequest {
  return payload.type === 'queryRange'
}

function cancellationValue(
  request: TreeSitterParseWorkerRequest | TreeSitterRangeWorkerRequest,
): number | null {
  const buffer = request.payload.cancellationBuffer
  if (!buffer) return null
  return Atomics.load(new Int32Array(buffer), 0)
}

function languageDescriptor(
  id: string,
  highlightQuerySource = '(identifier) @variable',
): TreeSitterLanguageDescriptor {
  return {
    aliases: [id],
    extensions: [`.${id}`],
    highlightQuerySource,
    id,
    wasmUrl: `/${id}.wasm`,
  }
}

function parsePayload(
  snapshot: ReturnType<typeof createPieceTableSnapshot>,
  snapshotVersion: number,
): TreeSitterParsePayload {
  return {
    documentId: 'doc.ts',
    runtimeSessionId: 'runtime-doc.ts',
    includeHighlights: true,
    languageId: 'typescript',
    snapshot,
    snapshotVersion,
  }
}

function parseResult(snapshotVersion: number): TreeSitterParseResult {
  return {
    brackets: [],
    captures: [],
    documentId: 'doc.ts',
    errors: [],
    folds: [],
    injections: [],
    languageId: 'typescript',
    snapshotVersion,
    timings: [],
  }
}

function parseAckResult(snapshotVersion: number): TreeSitterParseAckResult {
  return {
    changedRanges: [{ startIndex: 0, endIndex: 17 }],
    documentId: 'doc.ts',
    languageId: 'typescript',
    snapshotVersion,
    status: 'parsed',
    timings: [],
  }
}

function rangePayload(
  snapshotVersion: number,
  startIndex: number,
  endIndex: number,
): Parameters<WorkerClient['queryRange']>[0] {
  return {
    documentId: 'doc.ts',
    runtimeSessionId: 'runtime-doc.ts',
    includeHighlights: true,
    languageId: 'typescript',
    range: { startIndex, endIndex },
    snapshotVersion,
  }
}

function rangeResult(
  snapshotVersion: number,
  startIndex: number,
  endIndex: number,
): TreeSitterRangeResult {
  return {
    brackets: [],
    captures: [],
    documentId: 'doc.ts',
    errors: [],
    folds: [],
    injections: [],
    languageId: 'typescript',
    range: { startIndex, endIndex },
    snapshotVersion,
    timings: [],
    tokens: [],
  }
}
