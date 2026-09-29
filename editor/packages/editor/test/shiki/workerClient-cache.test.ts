import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDocumentTextSnapshot, createPieceTableSnapshot } from '../../src/public/document'

type WorkerClientModule = typeof import('../../src/shiki/workerClient')
type ShikiWorkerOwner = ReturnType<WorkerClientModule['createShikiWorkerOwner']>

type FakeWorkerRequest = {
  readonly id: number
  readonly payload: {
    readonly languageRegistrations?: readonly unknown[]
    readonly theme?: string
    readonly themeRegistrations?: readonly unknown[]
    readonly type: string
  }
}

const fakeWorkers: FakeWorker[] = []
let currentOwner: ShikiWorkerOwner | null = null

class FakeWorker {
  public static autoResolve = true

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

  public resolveRequest(
    message: FakeWorkerRequest,
    result: unknown = defaultResult(message),
  ): void {
    if (this.terminated) return

    this.onmessage?.({
      data: {
        id: message.id,
        ok: true,
        result,
      },
    } as MessageEvent)
  }
}

describe('Shiki worker client theme cache', () => {
  afterEach(async () => {
    FakeWorker.autoResolve = true
    await currentOwner?.dispose()
    currentOwner = null
    fakeWorkers.length = 0
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('shares in-flight and resolved theme requests', async () => {
    const owner = await loadWorkerOwner()
    const first = owner.loadTheme(themeOptions())
    const second = owner.loadTheme(themeOptions())

    await expect(Promise.all([first, second])).resolves.toEqual([
      { backgroundColor: 'github-dark' },
      { backgroundColor: 'github-dark' },
    ])
    await owner.loadTheme(themeOptions())

    expect(themeRequests()).toHaveLength(1)
  }, 20_000)

  it('clears theme cache when the worker is disposed', async () => {
    const owner = await loadWorkerOwner()

    await owner.loadTheme(themeOptions())
    await owner.dispose()
    currentOwner = null
    const nextOwner = await loadWorkerOwner()
    await nextOwner.loadTheme(themeOptions())

    expect(themeRequests()).toHaveLength(2)
  }, 20_000)

  it('does not retain a theme request whose registrations resolve after disposal', async () => {
    const owner = await loadWorkerOwner()
    const registrations = deferred<ReturnType<typeof resolvedRegistrations>>()
    const theme = owner.loadTheme({
      theme: 'github-dark',
      registrations: registrations.promise,
    })

    await owner.dispose()
    registrations.resolve(resolvedRegistrations())

    await expect(theme).resolves.toBeUndefined()
    expect(owner.inspect()).toMatchObject({
      lifecycle: 'disposed',
      cache: { themeRequests: 0 },
      workerGeneration: 0,
    })
  })

  it('exposes owner lifecycle and cache accounting', async () => {
    const owner = await loadWorkerOwner()

    expect(owner.inspect()).toMatchObject({
      lifecycle: 'idle',
      pendingRequests: 0,
      cache: { themeRequests: 0 },
      workerGeneration: 0,
    })

    await owner.loadTheme(themeOptions())

    expect(owner.inspect()).toMatchObject({
      lifecycle: 'ready',
      pendingRequests: 0,
      cache: { themeRequests: 1 },
      workerGeneration: 1,
      lastError: null,
    })

    await owner.dispose()

    expect(owner.inspect()).toMatchObject({
      lifecycle: 'disposed',
      pendingRequests: 0,
      cache: { themeRequests: 0 },
      workerGeneration: 1,
    })
  }, 20_000)

  it('creates a fresh worker after a worker error rejects in-flight requests', async () => {
    FakeWorker.autoResolve = false
    const owner = await loadWorkerOwner()
    const theme = owner.loadTheme(themeOptions())
    await flushMicrotasks()
    const firstWorker = fakeWorkerAt(0)

    firstWorker.onerror?.({ message: 'boom' } as ErrorEvent)

    await expect(theme).rejects.toThrow('boom')
    expect(firstWorker.isTerminated).toBe(true)

    FakeWorker.autoResolve = true
    await expect(owner.loadTheme(themeOptions())).resolves.toEqual({
      backgroundColor: 'github-dark',
    })

    expect(fakeWorkers).toHaveLength(2)
  }, 20_000)

  it('posts resolved preloads only after the first document result', async () => {
    FakeWorker.autoResolve = false
    const owner = await loadWorkerOwner()
    const preloadRegistrations = {
      languageRegistrations: [
        {
          name: 'javascript',
          patterns: [],
          repository: {},
          scopeName: 'source.js',
        },
      ],
      themeRegistrations: [{ name: 'github-light' }],
    }
    const resolvePreload = vi.fn(() => preloadRegistrations)
    const snapshot = createPieceTableSnapshot('const value = 1;')
    const session = owner.createSession({
      documentId: 'file.ts',
      languageId: 'typescript',
      lang: 'typescript',
      theme: 'github-dark',
      registrations: resolvedRegistrations(),
      preloadRegistrations: resolvePreload,
      snapshot,
      textSnapshot: createDocumentTextSnapshot(snapshot, 'const value = 1;'),
    })
    if (!session) throw new Error('missing Shiki highlighter session')

    const highlight = session.refresh(createDocumentTextSnapshot(snapshot, 'const value = 1;'))
    await untilRequested('open')

    const openRequest = requestOfType('open')
    expect(openRequest.payload.languageRegistrations).toEqual(
      resolvedRegistrations().languageRegistrations,
    )
    expect(resolvePreload).not.toHaveBeenCalled()
    expect(fakeWorkerAt(0).messages).toHaveLength(1)

    fakeWorkerAt(0).resolveRequest(openRequest, { tokens: [] })
    await highlight
    await flushMicrotasks()

    expect(resolvePreload).toHaveBeenCalledOnce()
    expect(requestOfType('preload').payload).toMatchObject(preloadRegistrations)
  }, 20_000)

  it('unpacks worker token buffers into indexed EditorToken arrays', async () => {
    FakeWorker.autoResolve = false
    const owner = await loadWorkerOwner()
    const snapshot = createPieceTableSnapshot('const value = 1;')
    const session = owner.createSession({
      documentId: 'file.ts',
      languageId: 'typescript',
      lang: 'typescript',
      theme: 'github-dark',
      registrations: resolvedRegistrations(),
      snapshot,
      textSnapshot: createDocumentTextSnapshot(snapshot, 'const value = 1;'),
    })
    if (!session) throw new Error('missing Shiki highlighter session')

    const highlight = session.refresh(createDocumentTextSnapshot(snapshot, 'const value = 1;'))
    await untilRequested('open')

    fakeWorkerAt(0).resolveRequest(requestOfType('open'), {
      documentId: 'file.ts',
      tokensPacked: {
        starts: Uint32Array.of(0, 6),
        ends: Uint32Array.of(5, 11),
        styleIds: Uint32Array.of(0, 0),
        styles: [{ color: '#ff0000' }],
        monotonicEnd: true,
        nonOverlapping: true,
        sortedByStart: true,
      },
    })

    const result = await highlight
    expect(result.tokens.toTokens()).toEqual([
      { start: 0, end: 5, style: { color: '#ff0000' } },
      { start: 6, end: 11, style: { color: '#ff0000' } },
    ])
    expect(result.tokens.styleAt(0)).toBe(result.tokens.styleAt(1))
    expect(result.tokens).toMatchObject({ monotonicEnd: true, nonOverlapping: true })
  }, 20_000)

  it('ignores tokenizer results that arrive after highlighter session disposal', async () => {
    FakeWorker.autoResolve = false
    const owner = await loadWorkerOwner()
    const snapshot = createPieceTableSnapshot('const value = 1;')
    const session = owner.createSession({
      documentId: 'file.ts',
      languageId: 'typescript',
      lang: 'typescript',
      theme: 'github-dark',
      registrations: resolvedRegistrations(),
      snapshot,
      textSnapshot: createDocumentTextSnapshot(snapshot, 'const value = 1;'),
    })
    if (!session) throw new Error('missing Shiki highlighter session')

    const highlight = session.refresh(createDocumentTextSnapshot(snapshot, 'const value = 1;'))
    await untilRequested('open')

    const worker = fakeWorkerAt(0)
    const openRequest = requestOfType('open')

    session.dispose()
    expect(requestsOfType('disposeDocument')).toHaveLength(0)

    worker.resolveRequest(openRequest, {
      tokensPacked: {
        starts: Uint32Array.of(0),
        ends: Uint32Array.of(5),
        styleIds: Uint32Array.of(0),
        styles: [{ color: '#ff0000' }],
        monotonicEnd: true,
        nonOverlapping: true,
        sortedByStart: true,
      },
    })

    const dropped = await highlight
    expect(dropped.tokens.toTokens()).toEqual([])
    expect(dropped.theme).toBeUndefined()
    await flushMicrotasks()
    expect(requestOfType('disposeDocument').payload).toMatchObject({
      runtimeSessionId: expect.any(String),
      type: 'disposeDocument',
    })
    expect(owner.inspect()).toMatchObject({
      lifecycle: 'ready',
      pendingRequests: 1,
    })

    worker.resolveRequest(requestOfType('disposeDocument'))
    await flushMicrotasks()

    expect(owner.inspect()).toMatchObject({
      lifecycle: 'ready',
      pendingRequests: 0,
    })
  }, 20_000)

  it('keeps the idle fence behind a theme request waiting on registrations', async () => {
    const owner = await loadWorkerOwner()
    const registrations = deferred<ReturnType<typeof resolvedRegistrations>>()
    const theme = owner.loadTheme({
      theme: 'github-dark',
      registrations: registrations.promise,
    })
    let idle = false
    const fence = owner.awaitIdleFence().then(() => {
      idle = true
    })

    await flushMicrotasks()

    expect(idle).toBe(false)
    expect(fakeWorkers).toHaveLength(0)

    registrations.resolve(resolvedRegistrations())
    await expect(theme).resolves.toEqual({ backgroundColor: 'github-dark' })
    await fence

    expect(themeRequests()).toHaveLength(1)
    expect(requestsOfType('idleFence')).toHaveLength(1)
  })

  it('keeps the idle fence behind a disposed refresh waiting on registrations', async () => {
    const owner = await loadWorkerOwner()
    const registrations = deferred<ReturnType<typeof resolvedRegistrations>>()
    const snapshot = createPieceTableSnapshot('const value = 1;')
    const session = owner.createSession({
      documentId: 'delayed.ts',
      languageId: 'typescript',
      lang: 'typescript',
      theme: 'github-dark',
      registrations: registrations.promise,
      snapshot,
      textSnapshot: createDocumentTextSnapshot(snapshot, 'const value = 1;'),
    })
    if (!session) throw new Error('missing Shiki highlighter session')

    const highlight = session.refresh(createDocumentTextSnapshot(snapshot, 'const value = 1;'))
    session.dispose()
    let idle = false
    const fence = owner.awaitIdleFence().then(() => {
      idle = true
    })
    await flushMicrotasks()

    expect(idle).toBe(false)
    expect(fakeWorkers).toHaveLength(0)

    registrations.resolve(resolvedRegistrations())
    const dropped = await highlight
    expect(dropped.tokens.toTokens()).toEqual([])
    expect(dropped.theme).toBeUndefined()
    await fence

    expect(fakeWorkers).toHaveLength(0)
    expect(owner.inspect()).toMatchObject({ lifecycle: 'idle', pendingRequests: 0 })
  })
})

async function loadWorkerOwner(): Promise<ShikiWorkerOwner> {
  vi.resetModules()
  vi.stubGlobal('Worker', FakeWorker)
  const client = await import('../../src/shiki/workerClient')
  currentOwner = client.createShikiWorkerOwner()
  return currentOwner
}

function themeOptions() {
  return { theme: 'github-dark', registrations: resolvedRegistrations() }
}

function resolvedRegistrations() {
  return {
    languageRegistrations: [
      {
        name: 'typescript',
        patterns: [],
        repository: {},
        scopeName: 'source.ts',
      },
    ],
    themeRegistration: { name: 'github-dark' },
    themeRegistrations: [],
  }
}

function themeRequests(): FakeWorkerRequest[] {
  return fakeWorkers.flatMap((worker) =>
    worker.messages.filter((message) => message.payload.type === 'theme'),
  )
}

function fakeWorkerAt(index: number): FakeWorker {
  const worker = fakeWorkers[index]
  if (!worker) throw new Error(`Expected fake worker at index ${index}`)
  return worker
}

function requestOfType(type: string): FakeWorkerRequest {
  const request = requestsOfType(type)[0]
  if (!request) throw new Error(`Expected ${type} request`)
  return request
}

function requestsOfType(type: string): FakeWorkerRequest[] {
  return fakeWorkers
    .flatMap((worker) => worker.messages)
    .filter((message) => message.payload.type === type)
}

function defaultResult(message: FakeWorkerRequest): unknown {
  return { theme: { backgroundColor: message.payload.theme } }
}

/** A refresh reaches the worker after however many turns its text reads take; count on the post. */
async function untilRequested(type: string): Promise<void> {
  for (let turn = 0; turn < 100; turn += 1) {
    if (requestsOfType(type).length > 0) return
    await Promise.resolve()
  }
  throw new Error(`No ${type} request reached the worker`)
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}
