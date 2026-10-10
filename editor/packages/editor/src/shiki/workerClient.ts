import { waitForDocumentWork } from '../editor/documentWork'
import type {
  DocumentRead,
  DocumentSourceConnection,
  DocumentSourceEndpoint,
} from '../editor/documentDelivery'
import {
  decodeDocumentWorkerReply,
  type DocumentWorkerReadReference,
} from '../document/workerReader'
import type { HighlighterOperationContext } from '../editor/operationDefinitions'

import { EditorTokenStore } from '../syntax/tokenStore'
import type { EditorHighlightResult, EditorHighlighterRuntime } from '../syntax/highlighter'
import { createEditorRuntimeSessionId } from '../syntax/session'
import type { EditorTheme } from '../theme'
import type {
  ShikiWorkerDocumentOptions,
  ShikiWorkerEditRequest,
  ShikiWorkerLanguageRegistration,
  ShikiWorkerRequest,
  ShikiWorkerRequestPayload,
  ShikiWorkerResponse,
  ShikiWorkerRetentionSnapshot,
  ShikiWorkerThemeRegistration,
  ShikiWorkerTransportResult,
} from './workerTypes'

export type ShikiResolvedRegistrations = {
  readonly languageRegistrations: readonly ShikiWorkerLanguageRegistration[]
  readonly themeRegistration: ShikiWorkerThemeRegistration
  readonly themeRegistrations: readonly ShikiWorkerThemeRegistration[]
}

export type ShikiPreloadRegistrations = {
  readonly languageRegistrations: readonly ShikiWorkerLanguageRegistration[]
  readonly themeRegistrations: readonly ShikiWorkerThemeRegistration[]
}

type ShikiPreloadRegistrationSource =
  | ShikiPreloadRegistrations
  | Promise<ShikiPreloadRegistrations>
  | (() => Promise<ShikiPreloadRegistrations> | ShikiPreloadRegistrations)

export type ShikiHighlighterSessionOptions = HighlighterOperationContext & {
  readonly lang: string
  readonly theme: string
  readonly registrations: Promise<ShikiResolvedRegistrations> | ShikiResolvedRegistrations
  readonly preloadRegistrations?: ShikiPreloadRegistrationSource
  readonly resolveTheme?: (currentTheme: string) => ShikiThemeOptions | null
  readonly onDidChangeTheme?: (listener: () => void) => (() => void) | void
}

export type ShikiThemeOptions = {
  readonly theme: string
  readonly registrations: Promise<ShikiResolvedRegistrations> | ShikiResolvedRegistrations
  readonly preloadRegistrations?: ShikiPreloadRegistrationSource
}

type PendingRequest = {
  readonly cleanup: () => void
  readonly resolve: (result: ShikiWorkerTransportResult | undefined) => void
  readonly reject: (error: Error) => void
}

const supportsWorkers = (): boolean => typeof Worker !== 'undefined'

export type ShikiWorkerLifecycleState = 'idle' | 'ready' | 'disposing' | 'disposed' | 'crashed'

export type ShikiWorkerCacheSnapshot = {
  readonly themeRequests: number
}

export type ShikiWorkerOwnerSnapshot = {
  readonly lifecycle: ShikiWorkerLifecycleState
  readonly pendingRequests: number
  readonly cache: ShikiWorkerCacheSnapshot
  readonly workerGeneration: number
  readonly lastError: string | null
  readonly maxTokenizationLineLength: number
  /** Plain lines across the live sessions' latest tokens. */
  readonly untokenizedLines: number
}

export type ShikiWorkerOwnerOptions = {
  readonly workerFactory?: () => Worker
  readonly onError?: (error: Error) => void
  /** Read on every open and snippet request, so a changed value reaches each document's next request. */
  readonly maxTokenizationLineLength?: () => number
}

/** VS Code's `editor.maxTokenizationLineLength` default. */
export const DEFAULT_SHIKI_MAX_TOKENIZATION_LINE_LENGTH = 20_000

export const canUseShikiWorker = (): boolean => supportsWorkers()

export function createShikiWorkerOwner(options: ShikiWorkerOwnerOptions = {}): ShikiWorkerOwner {
  return new ShikiWorkerOwner(options)
}

const shikiOperationBinding = Symbol('shiki.operation')
const shikiRequestBinding = Symbol('shiki.request')
const shikiSourceBinding = Symbol('shiki.source')
const shikiLifetimeBinding = Symbol('shiki.lifetime')

export class ShikiWorkerOwner {
  private worker: Worker | null = null
  private disposeTask: Promise<void> | null = null
  private nextRequestId = 1
  private workerGeneration = 0
  private lifecycle: ShikiWorkerLifecycleState = 'idle'
  private lastError: Error | null = null
  private readonly pendingRequests = new Map<number, PendingRequest>()
  private readonly clientTasks = new Set<Promise<unknown>>()
  private readonly runtimeTasks = new Map<string, Set<Promise<unknown>>>()
  private readonly themeRequests = new Map<string, Promise<EditorTheme | null | undefined>>()
  private readonly sessions = new Set<ShikiHighlighterSession>()
  private readonly lifetime = new AbortController()
  public readonly [shikiLifetimeBinding] = this.lifetime.signal
  private connection: DocumentSourceConnection | null = null
  private nextRegistration = 0
  public readonly [shikiSourceBinding]: DocumentSourceEndpoint = {
    connect: () => this.connectSource(),
  }

  public constructor(private readonly options: ShikiWorkerOwnerOptions = {}) {}

  public maxTokenizationLineLength(): number {
    const value = this.options.maxTokenizationLineLength?.()
    if (value === undefined || !Number.isInteger(value) || value < 1)
      return DEFAULT_SHIKI_MAX_TOKENIZATION_LINE_LENGTH
    return value
  }

  public canUseWorker(): boolean {
    if (this.lifecycle === 'disposing' || this.lifecycle === 'disposed') return false
    return Boolean(this.options.workerFactory) || supportsWorkers()
  }

  public inspect(): ShikiWorkerOwnerSnapshot {
    return {
      lifecycle: this.lifecycle,
      pendingRequests: this.pendingRequests.size,
      cache: { themeRequests: this.themeRequests.size },
      workerGeneration: this.workerGeneration,
      lastError: this.lastError?.message ?? null,
      maxTokenizationLineLength: this.maxTokenizationLineLength(),
      untokenizedLines: Array.from(this.sessions).reduce(
        (sum, session) => sum + session.untokenizedLines,
        0,
      ),
    }
  }

  public [shikiOperationBinding](
    options: ShikiHighlighterSessionOptions,
  ): EditorHighlighterRuntime | null {
    if (!this.canUseWorker()) return null
    const session = new ShikiHighlighterSession(
      options,
      this,
      (runtimeSessionId, task) => this.trackRuntimeTask(runtimeSessionId, task),
      () => this.sessions.delete(session),
    )
    this.sessions.add(session)
    return session
  }

  private async connectSource(): Promise<DocumentSourceConnection | null> {
    const worker = this.getWorker(true)
    if (!worker) return null
    if (this.connection) return this.connection
    this.connection = {
      generation: this.workerGeneration,
      nextRegistration: () => ++this.nextRegistration,
      send: async (command, signal) => {
        if (this.worker !== worker)
          return { kind: 'rejected', identity: command.identity, reason: 'generation' }
        const result = await this.trackClientTask(
          this.postRequest({ type: 'source', command }, false, signal),
        )
        return decodeDocumentWorkerReply(command, result?.source)
      },
      release: (identity) => {
        if (this.worker !== worker) return
        worker.postMessage({
          id: this.nextRequestId++,
          payload: { type: 'source', command: { kind: 'release', identity } },
        })
      },
    }
    return this.connection
  }

  public loadTheme(options: ShikiThemeOptions): Promise<EditorTheme | null | undefined> {
    if (!this.canUseWorker()) return Promise.resolve(undefined)

    return this.trackClientTask(this.finishLoadTheme(options))
  }

  private async finishLoadTheme(
    options: ShikiThemeOptions,
  ): Promise<EditorTheme | null | undefined> {
    let registrations: ShikiResolvedRegistrations
    try {
      registrations = await waitForDocumentWork(
        Promise.resolve(options.registrations),
        this.lifetime.signal,
      )
    } catch (error) {
      if (this.lifetime.signal.aborted) return undefined
      throw error
    }
    if (!this.canUseWorker()) return undefined

    const key = shikiThemeRequestKey(options.theme, registrations)
    const existing = this.themeRequests.get(key)
    if (existing) return existing

    const request = requestShikiTheme(this, options.theme, registrations).catch((error) => {
      this.themeRequests.delete(key)
      throw error
    })
    this.themeRequests.set(key, request)
    const theme = await request
    const preload = scheduleRegistrationPreload(this, options.preloadRegistrations)
    if (preload) this.trackClientTask(preload)
    return theme
  }

  public [shikiRequestBinding](
    payload: ShikiWorkerRequestPayload,
  ): Promise<ShikiWorkerTransportResult | undefined> {
    const request = this.postRequest(payload, true)
    if ('runtimeSessionId' in payload) {
      return this.trackRuntimeTask(payload.runtimeSessionId, request)
    }
    return this.trackClientTask(request)
  }

  public preload(registrations: ShikiPreloadRegistrations): Promise<void> {
    return this.trackClientTask(
      this.postRequest(
        {
          type: 'preload',
          languageRegistrations: registrations.languageRegistrations,
          themeRegistrations: registrations.themeRegistrations,
        },
        false,
      ).then(() => undefined),
    )
  }

  public disposeDocument(runtimeSessionId: string): Promise<void> {
    if (!this.worker) return Promise.resolve()

    return this.trackRuntimeTask(
      runtimeSessionId,
      this.postRequest({ type: 'disposeDocument', runtimeSessionId }, false).then(() => undefined),
    )
  }

  public async awaitRuntimeSessionIdle(runtimeSessionId: string): Promise<void> {
    await this.awaitRuntimeTasks(runtimeSessionId)
    if (!this.worker) return

    await this.postRequest({ type: 'runtimeBarrier', runtimeSessionId }, false)
  }

  public async awaitIdleFence(): Promise<void> {
    await this.awaitClientTasks()
    if (!this.worker) return

    await this.postRequest({ type: 'idleFence' }, false)
  }

  /** Settles existing work and reads the live worker; null means no worker is retained. */
  public async inspectRetention(): Promise<ShikiWorkerRetentionSnapshot | null> {
    await this.awaitClientTasks()
    const result = await this.postRequest({ type: 'idleFence', includeRetention: true }, false)
    return result?.retention ?? null
  }

  public dispose(): Promise<void> {
    if (this.disposeTask) return this.disposeTask

    this.lifecycle = 'disposing'
    this.lifetime.abort()
    this.disposeTask = this.finishDispose()
    return this.disposeTask
  }

  private async finishDispose(): Promise<void> {
    const handle = this.worker
    this.worker = null
    try {
      for (const session of this.sessions) session.dispose()
      if (handle) {
        handle.onmessage = null
        handle.onerror = null
        // A busy worker cannot acknowledge disposal; termination releases its message loop.
        handle.terminate()
      }
    } finally {
      this.clearRetainedState('disposed')
      this.rejectPendingRequests(new Error('Shiki worker disposed'))
    }
    await this.awaitClientTasks()
  }

  private getWorker(createIfMissing: boolean): Worker | null {
    if (createIfMissing && (this.lifecycle === 'disposing' || this.lifecycle === 'disposed')) {
      return null
    }
    if (this.worker) return this.worker
    if (!createIfMissing) return null
    if (!this.canUseWorker()) return null

    const handle = this.createWorker()
    this.worker = handle
    this.workerGeneration += 1
    this.lifecycle = 'ready'
    this.lastError = null
    return handle
  }

  private createWorker(): Worker {
    const handle =
      this.options.workerFactory?.() ??
      new Worker(new URL('./shiki.worker.ts', import.meta.url), { type: 'module' })
    handle.onmessage = this.handleWorkerMessage
    handle.onerror = (event) => this.handleWorkerError(handle, event)
    return handle
  }

  private postRequest(
    payload: ShikiWorkerRequestPayload,
    createIfMissing: boolean,
    signal?: AbortSignal,
  ): Promise<ShikiWorkerTransportResult | undefined> {
    const handle = this.getWorker(createIfMissing)
    if (!handle) return Promise.resolve(undefined)

    if (signal?.aborted)
      return Promise.reject(new DOMException('Document source was released', 'AbortError'))
    const id = this.nextRequestId
    this.nextRequestId += 1
    const request: ShikiWorkerRequest = { id, payload }
    markEditorWorkerRequest('shiki', payload.type, runtimeSessionIdForPayload(payload))

    return new Promise((resolve, reject) => {
      const abort = () => {
        this.pendingRequests.delete(id)
        reject(new DOMException('Document source was released', 'AbortError'))
      }
      this.pendingRequests.set(id, {
        resolve,
        reject,
        cleanup: () => signal?.removeEventListener('abort', abort),
      })
      signal?.addEventListener('abort', abort, { once: true })
      try {
        handle.postMessage(request)
      } catch (error) {
        signal?.removeEventListener('abort', abort)
        this.pendingRequests.delete(id)
        reject(workerRequestError(error))
      }
    })
  }

  private readonly handleWorkerMessage = (event: MessageEvent<ShikiWorkerResponse>): void => {
    const response = event.data
    const pending = this.pendingRequests.get(response.id)
    if (!pending) return

    pending.cleanup()
    this.pendingRequests.delete(response.id)
    if (response.ok) {
      pending.resolve(response.result)
      return
    }

    pending.reject(new Error(response.error))
  }

  private handleWorkerError(failedWorker: Worker, event: ErrorEvent): void {
    if (failedWorker !== this.worker) return

    const error = new Error(event.message || 'Shiki worker failed')
    this.lastError = error
    this.lifecycle = 'crashed'
    this.themeRequests.clear()
    this.connection = null
    this.nextRegistration = 0
    this.rejectPendingRequests(error)
    failedWorker.terminate()
    this.worker = null
    this.options.onError?.(error)
  }

  private rejectPendingRequests(error: Error): void {
    for (const request of this.pendingRequests.values()) {
      request.cleanup()
      request.reject(error)
    }
    this.pendingRequests.clear()
  }

  private clearRetainedState(lifecycle: ShikiWorkerLifecycleState): void {
    this.lifecycle = lifecycle
    this.themeRequests.clear()
    this.connection = null
    this.nextRegistration = 0
  }

  private trackClientTask<T>(task: Promise<T>): Promise<T> {
    this.clientTasks.add(task)
    void task.finally(() => this.clientTasks.delete(task)).catch(() => undefined)
    return task
  }

  private trackRuntimeTask<T>(runtimeSessionId: string, task: Promise<T>): Promise<T> {
    const tasks = this.runtimeTasks.get(runtimeSessionId) ?? new Set<Promise<unknown>>()
    tasks.add(task)
    this.runtimeTasks.set(runtimeSessionId, tasks)
    this.trackClientTask(task)
    void task
      .finally(() => {
        tasks.delete(task)
        if (tasks.size === 0) this.runtimeTasks.delete(runtimeSessionId)
      })
      .catch(() => undefined)
    return task
  }

  private async awaitClientTasks(): Promise<void> {
    while (this.clientTasks.size > 0) {
      await Promise.allSettled(this.clientTasks)
    }
  }

  private async awaitRuntimeTasks(runtimeSessionId: string): Promise<void> {
    while (this.runtimeTasks.has(runtimeSessionId)) {
      const tasks = this.runtimeTasks.get(runtimeSessionId)
      if (!tasks) return

      await Promise.allSettled(tasks)
    }
  }
}

class ShikiHighlighterSession implements EditorHighlighterRuntime {
  private readonly documentId: string
  private readonly runtimeSessionId: string
  private readonly lang: string
  private theme: string
  private registrations: Promise<ShikiResolvedRegistrations>
  public readonly onDidChangeTheme: ShikiHighlighterSessionOptions['onDidChangeTheme']
  private readonly preloadRegistrations: ShikiPreloadRegistrationSource | null
  private analysedRead: DocumentRead | null = null
  // The whole document's tokens, kept packed so an edit answer only has to splice its lines in.
  private store: EditorTokenStore | null = null
  private currentTheme: EditorTheme | null | undefined
  private preloadScheduled = false
  private opened = false
  private workerGeneration = 0
  private disposed = false
  private readonly lifetime = new AbortController()
  private task: Promise<void> = Promise.resolve()
  // The limit the worker document was opened with; a different current limit reopens it.
  private openedLineLimit = 0
  public untokenizedLines = 0

  public constructor(
    private readonly options: ShikiHighlighterSessionOptions,
    private readonly owner: ShikiWorkerOwner,
    private readonly trackTask: <T>(runtimeSessionId: string, task: Promise<T>) => Promise<T>,
    private readonly onDisposed: () => void,
  ) {
    this.documentId = options.documentId
    this.runtimeSessionId = options.runtimeSessionId ?? createEditorRuntimeSessionId()
    this.lang = options.lang
    this.theme = options.theme
    this.onDidChangeTheme = options.onDidChangeTheme
    this.registrations = Promise.resolve(options.registrations)
    void this.registrations.catch(() => undefined)
    this.preloadRegistrations = options.preloadRegistrations ?? null
  }

  public configurationKey(): number | null {
    return this.disposed ? null : this.owner.maxTokenizationLineLength()
  }

  public async analyze(read: DocumentRead, signal?: AbortSignal): Promise<EditorHighlightResult> {
    const work = signal ? AbortSignal.any([this.lifetime.signal, signal]) : this.lifetime.signal
    work.throwIfAborted()
    if (this.options.source.read(read.revision) !== read)
      throw new DOMException('Document revision belongs to another source', 'InvalidStateError')
    return this.enqueueRequest(async () => {
      work.throwIfAborted()
      await this.synchronizeTheme(work)
      const documentOptions = await this.documentOptions(work)
      work.throwIfAborted()
      const prepared = await this.options.source.prepareReader(
        this.owner[shikiSourceBinding],
        read,
        work,
      )
      if (!prepared || this.disposed) {
        await prepared?.dispose()
        throw new DOMException('Document source was released', 'AbortError')
      }
      try {
        work.throwIfAborted()
        const changes = this.analysedRead
          ? this.options.source.changesBetween(this.analysedRead.revision, read.revision)
          : null
        const payload =
          this.opened && changes?.edits && this.analysedRead
            ? this.editRequest(changes.edits, prepared.reference, this.analysedRead)
            : ({
                type: 'open',
                ...documentOptions,
                source: prepared.reference,
              } satisfies ShikiWorkerRequestPayload)
        const result = await this.owner[shikiRequestBinding](payload)
        this.lifetime.signal.throwIfAborted()
        this.schedulePreload()
        this.analysedRead = read
        this.opened = true
        this.workerGeneration = this.owner.inspect().workerGeneration
        this.adoptEditResult(result)
        work.throwIfAborted()
        return { tokens: this.currentTokens(), theme: this.currentTheme }
      } finally {
        await prepared.dispose()
      }
    })
  }

  public dispose(): void {
    if (this.disposed) return

    this.disposed = true
    this.lifetime.abort()
    this.opened = false
    this.untokenizedLines = 0
    this.onDisposed()
    const dispose = this.task.then(
      () => this.owner.disposeDocument(this.runtimeSessionId),
      () => this.owner.disposeDocument(this.runtimeSessionId),
    )
    this.task = dispose.then(
      () => undefined,
      () => undefined,
    )
    this.trackTask(this.runtimeSessionId, this.task)
  }

  private enqueueRequest(
    run: () => Promise<EditorHighlightResult>,
  ): Promise<EditorHighlightResult> {
    const result = this.task.then(run)
    this.task = result.then(
      () => undefined,
      () => undefined,
    )
    this.trackTask(this.runtimeSessionId, this.task)
    return result
  }

  private async synchronizeTheme(signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted()
    const worker = this.owner.inspect()
    if (worker.lifecycle !== 'ready' || worker.workerGeneration !== this.workerGeneration) {
      this.opened = false
    }
    if (this.openedLineLimit !== worker.maxTokenizationLineLength) this.opened = false
    const next = this.options.resolveTheme?.(this.theme)
    if (!next || next.theme === this.theme) return

    const registrations = await waitForDocumentWork(Promise.resolve(next.registrations), signal)
    if (this.disposed) return
    // A theme answer carries only theme registrations; the session keeps the grammar it opened
    // with, or the next reopen (worker restart, changed line limit) would load no language.
    const current = await waitForDocumentWork(this.registrations, signal)
    const themed: ShikiResolvedRegistrations = {
      languageRegistrations: current.languageRegistrations,
      themeRegistration: registrations.themeRegistration,
      themeRegistrations: registrations.themeRegistrations,
    }

    if (!this.opened) {
      this.theme = next.theme
      this.registrations = Promise.resolve(themed)
      return
    }

    const result = await this.owner[shikiRequestBinding]({
      type: 'recolor',
      runtimeSessionId: this.runtimeSessionId,
      theme: next.theme,
      themeRegistration: registrations.themeRegistration,
    })
    if (this.disposed) return

    this.theme = next.theme
    this.registrations = Promise.resolve(themed)
    this.adoptEditResult(result)
    signal?.throwIfAborted()
  }

  private adoptEditResult(result: ShikiWorkerTransportResult | undefined): void {
    if (result?.theme !== undefined) this.currentTheme = result.theme
    if (result?.untokenizedLines !== undefined) this.untokenizedLines = result.untokenizedLines
    if (result?.tokensPacked) {
      this.store = EditorTokenStore.fromPacked(result.tokensPacked)
      return
    }
    if (!result?.patchesPacked) return
    if (!this.store) throw new Error('Shiki token patches arrived before any full tokens')

    for (const patch of result.patchesPacked) this.store = this.store.applyPatch(patch)
  }

  private currentTokens(): EditorTokenStore {
    return this.store ?? EditorTokenStore.empty()
  }

  private editRequest(
    edits: ShikiWorkerEditRequest['edits'],
    source: DocumentWorkerReadReference,
    previous: DocumentRead,
  ): ShikiWorkerEditRequest {
    return {
      type: 'edit',
      documentId: this.documentId,
      runtimeSessionId: this.runtimeSessionId,
      lang: this.lang,
      theme: this.theme,
      source,
      previousPoint: {
        ...source.point,
        revision: previous.revision.point.revision,
        textVersion: previous.revision.point.textVersion,
      },
      edits,
    }
  }

  private async documentOptions(signal?: AbortSignal): Promise<ShikiWorkerDocumentOptions> {
    const registrations = await waitForDocumentWork(this.registrations, signal)
    this.openedLineLimit = this.owner.maxTokenizationLineLength()
    return {
      documentId: this.documentId,
      runtimeSessionId: this.runtimeSessionId,
      lang: this.lang,
      theme: this.theme,
      languageRegistrations: registrations.languageRegistrations,
      themeRegistration: registrations.themeRegistration,
      themeRegistrations: registrations.themeRegistrations,
      maxLineLength: this.openedLineLimit,
    }
  }

  private schedulePreload(): void {
    if (this.disposed) return
    if (this.preloadScheduled) return

    this.preloadScheduled = true
    const preload = scheduleRegistrationPreload(this.owner, this.preloadRegistrations)
    if (preload) this.trackTask(this.runtimeSessionId, preload)
  }
}

async function requestShikiTheme(
  owner: ShikiWorkerOwner,
  theme: string,
  registrations: ShikiResolvedRegistrations,
): Promise<EditorTheme | null | undefined> {
  const result = await owner[shikiRequestBinding]({
    type: 'theme',
    theme,
    themeRegistration: registrations.themeRegistration,
    themeRegistrations: registrations.themeRegistrations,
  })
  return result?.theme
}

function shikiThemeRequestKey(theme: string, registrations: ShikiResolvedRegistrations): string {
  return JSON.stringify({
    theme,
    themeRegistration: themeRegistrationKey(registrations.themeRegistration),
    themeRegistrations: registrations.themeRegistrations.map(themeRegistrationKey).sort(),
  })
}

function themeRegistrationKey(registration: ShikiWorkerThemeRegistration): string {
  if (!registration.name) {
    throw new Error('Shiki theme registrations require a non-empty name')
  }
  return JSON.stringify(registration)
}

function scheduleRegistrationPreload(
  owner: ShikiWorkerOwner,
  registrations: ShikiPreloadRegistrationSource | null | undefined,
): Promise<void> | null {
  if (!registrations) return null

  const resolved = typeof registrations === 'function' ? registrations() : registrations
  return waitForDocumentWork(Promise.resolve(resolved), owner[shikiLifetimeBinding])
    .then((resolved) => owner.preload(resolved))
    .catch(() => undefined)
}

function workerRequestError(error: unknown): Error {
  if (error instanceof Error) return error
  return new Error(String(error))
}

function runtimeSessionIdForPayload(payload: ShikiWorkerRequestPayload): string | null {
  if ('runtimeSessionId' in payload) return payload.runtimeSessionId
  return null
}

function markEditorWorkerRequest(
  family: string,
  type: string,
  runtimeSessionId: string | null,
): void {
  const traceGlobal = globalThis as typeof globalThis & { readonly __editorPerfTrace?: unknown }
  if (!traceGlobal.__editorPerfTrace) return

  globalThis.performance?.mark('editor.worker.request', {
    detail: { family, runtimeSessionId, type },
  })
}

export function createShikiDocumentOperation(
  owner: ShikiWorkerOwner,
  context: ShikiHighlighterSessionOptions,
): EditorHighlighterRuntime | null {
  return owner[shikiOperationBinding](context)
}
