import { documentSessionChangeTextSnapshot, type DocumentSessionChange } from '../documentSession'
import type { DocumentTextSnapshot } from '../documentTextSnapshot'
import {
  applyBatchToPieceTable,
  diffPieceTableSnapshots,
  type PieceTableSnapshot,
  pieceTableSnapshotsHaveSameText,
} from '@singapore-editor/textbuffer'
import type { TextEdit } from '../tokens'

import { EditorTokenStore } from '../syntax/tokenStore'
import type {
  EditorHighlightResult,
  EditorHighlighterSession,
  EditorHighlighterSessionOptions,
} from '../plugins'
import { createEditorRuntimeSessionId } from '../syntax/session'
import type { EditorTheme } from '../theme'
import type {
  ShikiWorkerDocumentOptions,
  ShikiWorkerEditRequest,
  ShikiWorkerLanguageRegistration,
  ShikiWorkerRequest,
  ShikiWorkerRequestPayload,
  ShikiWorkerResponse,
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

export type ShikiHighlighterSessionOptions = EditorHighlighterSessionOptions & {
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
}

export type ShikiWorkerOwnerOptions = {
  readonly workerFactory?: () => Worker
  readonly onError?: (error: Error) => void
}

export const canUseShikiWorker = (): boolean => supportsWorkers()

export function createShikiWorkerOwner(options: ShikiWorkerOwnerOptions = {}): ShikiWorkerOwner {
  return new ShikiWorkerOwner(options)
}

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

  public constructor(private readonly options: ShikiWorkerOwnerOptions = {}) {}

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
    }
  }

  public createSession(options: ShikiHighlighterSessionOptions): EditorHighlighterSession | null {
    if (!this.canUseWorker()) return null
    return new ShikiHighlighterSession(options, this, (runtimeSessionId, task) =>
      this.trackRuntimeTask(runtimeSessionId, task),
    )
  }

  public loadTheme(options: ShikiThemeOptions): Promise<EditorTheme | null | undefined> {
    if (!this.canUseWorker()) return Promise.resolve(undefined)

    return this.trackClientTask(this.finishLoadTheme(options))
  }

  private async finishLoadTheme(
    options: ShikiThemeOptions,
  ): Promise<EditorTheme | null | undefined> {
    const registrations = await options.registrations
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

  public request(
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

  public dispose(): Promise<void> {
    if (this.disposeTask) return this.disposeTask

    this.lifecycle = 'disposing'
    this.disposeTask = this.finishDispose()
    return this.disposeTask
  }

  private async finishDispose(): Promise<void> {
    const handle = this.worker
    if (!handle) {
      this.clearRetainedState('disposed')
      return
    }

    try {
      await this.postRequest({ type: 'dispose' }, false)
    } finally {
      handle.terminate()
      if (this.worker === handle) this.worker = null
      this.clearRetainedState('disposed')
      this.rejectPendingRequests(new Error('Shiki worker disposed'))
    }
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
  ): Promise<ShikiWorkerTransportResult | undefined> {
    const handle = this.getWorker(createIfMissing)
    if (!handle) return Promise.resolve(undefined)

    const id = this.nextRequestId
    this.nextRequestId += 1
    const request: ShikiWorkerRequest = { id, payload }
    markEditorWorkerRequest('shiki', payload.type, runtimeSessionIdForPayload(payload))

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject })
      try {
        handle.postMessage(request)
      } catch (error) {
        this.pendingRequests.delete(id)
        reject(workerRequestError(error))
      }
    })
  }

  private readonly handleWorkerMessage = (event: MessageEvent<ShikiWorkerResponse>): void => {
    const response = event.data
    const pending = this.pendingRequests.get(response.id)
    if (!pending) return

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
    this.rejectPendingRequests(error)
    failedWorker.terminate()
    this.worker = null
    this.options.onError?.(error)
  }

  private rejectPendingRequests(error: Error): void {
    for (const request of this.pendingRequests.values()) request.reject(error)
    this.pendingRequests.clear()
  }

  private clearRetainedState(lifecycle: ShikiWorkerLifecycleState): void {
    this.lifecycle = lifecycle
    this.themeRequests.clear()
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

class ShikiHighlighterSession implements EditorHighlighterSession {
  private readonly documentId: string
  private readonly runtimeSessionId: string
  private readonly lang: string
  private theme: string
  private registrations: Promise<ShikiResolvedRegistrations>
  public readonly onDidChangeTheme: ShikiHighlighterSessionOptions['onDidChangeTheme']
  private readonly preloadRegistrations: ShikiPreloadRegistrationSource | null
  private snapshot: PieceTableSnapshot
  // The whole document's tokens, kept packed so an edit answer only has to splice its lines in.
  private store: EditorTokenStore | null = null
  private currentTheme: EditorTheme | null | undefined
  private preloadScheduled = false
  private opened = false
  private workerGeneration = 0
  private disposed = false
  private task: Promise<void> = Promise.resolve()

  public constructor(
    private readonly options: ShikiHighlighterSessionOptions,
    private readonly owner: ShikiWorkerOwner,
    private readonly trackTask: <T>(runtimeSessionId: string, task: Promise<T>) => Promise<T>,
  ) {
    this.documentId = options.documentId
    this.runtimeSessionId = options.runtimeSessionId ?? createEditorRuntimeSessionId()
    this.lang = options.lang
    this.theme = options.theme
    this.onDidChangeTheme = options.onDidChangeTheme
    this.registrations = Promise.resolve(options.registrations)
    this.preloadRegistrations = options.preloadRegistrations ?? null
    this.snapshot = options.snapshot
  }

  public async refresh(textSnapshot: DocumentTextSnapshot): Promise<EditorHighlightResult> {
    if (this.disposed) return emptyHighlightResult()

    return this.enqueueRequest(async () => {
      if (this.disposed) return emptyHighlightResult()

      await this.synchronizeTheme()
      const snapshot = textSnapshot.snapshot
      if (this.opened && pieceTableSnapshotsHaveSameText(this.snapshot, snapshot)) {
        return { tokens: this.currentTokens(), theme: this.currentTheme }
      }

      const documentText = openPayloadText(textSnapshot)
      const documentOptions = await this.documentOptions()
      if (this.disposed) return emptyHighlightResult()

      const result = await this.owner.request({
        type: 'open',
        ...documentOptions,
        text: documentText,
      })
      if (this.disposed) return emptyHighlightResult()

      this.schedulePreload()
      this.snapshot = snapshot
      this.opened = true
      this.workerGeneration = this.owner.inspect().workerGeneration
      this.disposed = false
      this.store = result?.tokensPacked ? EditorTokenStore.fromPacked(result.tokensPacked) : null
      this.currentTheme = result?.theme
      return { tokens: this.currentTokens(), theme: result?.theme }
    })
  }

  public async applyChange(change: DocumentSessionChange): Promise<EditorHighlightResult> {
    if (this.disposed) return emptyHighlightResult()

    return this.enqueueRequest(async () => {
      if (this.disposed) return emptyHighlightResult()

      await this.synchronizeTheme()

      const nextTextSnapshot = documentSessionChangeTextSnapshot(change)
      const payload = await this.editPayloadForChange(change, nextTextSnapshot)
      if (this.disposed) return emptyHighlightResult()

      const result = await this.owner.request(payload)
      if (this.disposed) return emptyHighlightResult()

      this.schedulePreload()
      this.snapshot = change.snapshot
      this.opened = true
      this.workerGeneration = this.owner.inspect().workerGeneration
      this.disposed = false
      this.adoptEditResult(result)
      return { tokens: this.currentTokens(), theme: result?.theme }
    })
  }

  public dispose(): void {
    if (this.disposed) return

    this.disposed = true
    this.opened = false
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
    const result = this.task.then(run, run)
    this.task = result.then(
      () => undefined,
      () => undefined,
    )
    this.trackTask(this.runtimeSessionId, this.task)
    return result
  }

  private async synchronizeTheme(): Promise<void> {
    const worker = this.owner.inspect()
    if (worker.lifecycle !== 'ready' || worker.workerGeneration !== this.workerGeneration) {
      this.opened = false
    }
    const next = this.options.resolveTheme?.(this.theme)
    if (!next || next.theme === this.theme) return

    const registrations = await next.registrations
    if (this.disposed) return

    if (!this.opened) {
      this.theme = next.theme
      this.registrations = Promise.resolve(registrations)
      return
    }

    const result = await this.owner.request({
      type: 'recolor',
      runtimeSessionId: this.runtimeSessionId,
      theme: next.theme,
      themeRegistration: registrations.themeRegistration,
    })
    if (this.disposed) return

    this.theme = next.theme
    this.registrations = Promise.resolve(registrations)
    this.adoptEditResult(result)
  }

  private adoptEditResult(result: ShikiWorkerTransportResult | undefined): void {
    if (result?.theme !== undefined) this.currentTheme = result.theme
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

  private async editPayloadForChange(
    change: DocumentSessionChange,
    nextTextSnapshot: DocumentTextSnapshot,
  ): Promise<ShikiWorkerRequestPayload> {
    const edits = incrementalEditsForChange(this.snapshot, change)
    if (edits && this.opened && !this.disposed) return this.editRequest(edits)

    if (!this.opened) {
      return {
        type: 'open',
        ...(await this.documentOptions()),
        text: openPayloadText(nextTextSnapshot),
      }
    }

    const fallbackEdit = diffPieceTableSnapshots(this.snapshot, change.snapshot)
    return this.editRequest(fallbackEdit ? [fallbackEdit] : [])
  }

  private editRequest(edits: readonly TextEdit[]): ShikiWorkerEditRequest {
    return {
      type: 'edit',
      documentId: this.documentId,
      runtimeSessionId: this.runtimeSessionId,
      lang: this.lang,
      theme: this.theme,
      edits,
    }
  }

  private async documentOptions(): Promise<ShikiWorkerDocumentOptions> {
    const registrations = await this.registrations
    return {
      documentId: this.documentId,
      runtimeSessionId: this.runtimeSessionId,
      lang: this.lang,
      theme: this.theme,
      languageRegistrations: registrations.languageRegistrations,
      themeRegistration: registrations.themeRegistration,
      themeRegistrations: registrations.themeRegistrations,
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

// The worker's open message is a whole-document protocol payload; edits after it are incremental.
function openPayloadText(textSnapshot: DocumentTextSnapshot): string {
  return textSnapshot.materializeFullText()
}

function emptyHighlightResult(): EditorHighlightResult {
  return { tokens: EditorTokenStore.empty() }
}

const incrementalEditsForChange = (
  snapshot: PieceTableSnapshot,
  change: DocumentSessionChange,
): readonly TextEdit[] | null => {
  if (change.edits.length === 0) return null

  try {
    if (
      !pieceTableSnapshotsHaveSameText(
        applyBatchToPieceTable(snapshot, change.edits),
        change.snapshot,
      )
    ) {
      return null
    }
  } catch {
    return null
  }

  return change.edits
}

async function requestShikiTheme(
  owner: ShikiWorkerOwner,
  theme: string,
  registrations: ShikiResolvedRegistrations,
): Promise<EditorTheme | null | undefined> {
  const result = await owner.request({
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
    themeRegistrations: registrations.themeRegistrations.map(themeRegistrationKey).toSorted(),
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
  return Promise.resolve(resolved)
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
