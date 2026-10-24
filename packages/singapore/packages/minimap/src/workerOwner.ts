import { createError } from '@singapore-editor/core/logging/evlog'
import type { MinimapWorkerRequest, MinimapWorkerResponse } from './types'

export type MinimapWorkerLifecycleState = 'ready' | 'disposed' | 'crashed'

export type MinimapWorkerOwnerSnapshot = {
  readonly lifecycle: MinimapWorkerLifecycleState
  readonly postedRequests: number
  readonly lastError: string | null
}

export type MinimapWorkerOwnerOptions = {
  readonly onMessage: (response: MinimapWorkerResponse) => void
  readonly onError?: (error: Error) => void
  readonly workerFactory?: () => Worker
}

export class MinimapWorkerOwner {
  private worker: Worker | null = null
  private lifecycle: MinimapWorkerLifecycleState = 'ready'
  private postedRequests = 0
  private lastError: Error | null = null
  private disposalPromise: Promise<void> | null = null
  private terminationError: Error | null = null

  public constructor(private readonly options: MinimapWorkerOwnerOptions) {
    this.worker = this.createWorker()
  }

  public inspect(): MinimapWorkerOwnerSnapshot {
    return {
      lifecycle: this.lifecycle,
      postedRequests: this.postedRequests,
      lastError: this.lastError?.message ?? null,
    }
  }

  public post(request: MinimapWorkerRequest, transfer?: Transferable[]): boolean {
    const handle = this.worker
    if (!this.canPost(handle)) return false

    this.postedRequests += 1
    try {
      this.postToWorker(handle, request, transfer)
      return true
    } catch (error) {
      this.fail(workerRequestError(error))
      return false
    }
  }

  public dispose(): Promise<void> {
    if (this.disposalPromise) return this.disposalPromise

    this.terminateWorker()
    this.lifecycle = this.terminationError ? 'crashed' : 'disposed'
    this.disposalPromise = this.terminationError
      ? Promise.reject(this.terminationError)
      : Promise.resolve()
    return this.disposalPromise
  }

  private createWorker(): Worker {
    const handle =
      this.options.workerFactory?.() ??
      new Worker(new URL('./minimap.worker.ts', import.meta.url), { type: 'module' })
    handle.onmessage = this.handleWorkerMessage
    handle.onerror = this.handleWorkerError
    return handle
  }

  private canPost(handle: Worker | null): handle is Worker {
    if (!handle) return false
    if (this.lifecycle === 'disposed') return false
    return this.lifecycle !== 'crashed'
  }

  private postToWorker(
    handle: Worker,
    request: MinimapWorkerRequest,
    transfer?: Transferable[],
  ): void {
    if (transfer) {
      handle.postMessage(request, transfer)
      return
    }

    handle.postMessage(request)
  }

  private readonly handleWorkerMessage = (event: MessageEvent<MinimapWorkerResponse>): void => {
    if (!this.worker) return
    const response = event.data

    if (response.type === 'error') {
      this.recordError(createWorkerResponseError(response))
      return
    }

    this.options.onMessage(response)
  }

  private readonly handleWorkerError = (event: ErrorEvent): void => {
    if (!this.worker) return
    this.fail(createNativeWorkerError(event))
  }

  private recordError(error: Error): void {
    this.lastError = error
    this.options.onError?.(error)
  }

  private fail(error: Error): void {
    this.lastError = error
    this.lifecycle = 'crashed'
    this.terminateWorker()
    this.options.onError?.(error)
  }

  private terminateWorker(): void {
    const handle = this.worker
    this.worker = null
    if (!handle) return

    try {
      handle.onmessage = null
      handle.onerror = null
      // A busy worker cannot acknowledge disposal; termination releases its owned resources.
      handle.terminate()
    } catch (error) {
      this.terminationError = workerRequestError(error)
      this.lastError = this.terminationError
      this.lifecycle = 'crashed'
    }
  }
}

function workerRequestError(error: unknown): Error {
  if (error instanceof Error) return error
  return new Error(String(error))
}

function createWorkerResponseError(
  response: Extract<MinimapWorkerResponse, { readonly type: 'error' }>,
): Error {
  const workerMessage = nonEmptyString(response.message)
  return createError({
    code: 'minimap.WORKER_REQUEST_FAILED',
    message: messageWithDetail('Minimap worker request failed', workerMessage),
    why: workerMessage ?? 'The minimap worker reported an error without details.',
    fix: 'The editor keeps running; inspect the minimap worker request and renderer state if the minimap stops updating.',
    internal: {
      responseType: response.type,
      sequence: response.sequence ?? null,
      workerMessage: response.message,
    },
  })
}

function createNativeWorkerError(event: ErrorEvent): Error {
  const browserMessage = nonEmptyString(event.message)
  return createError({
    code: 'minimap.WORKER_CRASHED',
    message: messageWithDetail('Minimap worker crashed', browserMessage),
    why: nativeWorkerFailureReason(browserMessage),
    fix: 'The editor keeps running without the minimap for this worker generation. Check the worker script request, CSP, MIME type, and browser worker support.',
    cause: event.error instanceof Error ? event.error : undefined,
    internal: workerErrorEventInternal(event),
  })
}

function nativeWorkerFailureReason(browserMessage: string | null): string {
  if (browserMessage) return `The browser reported: ${browserMessage}`
  return 'The browser reported a native worker failure without an error message. This usually means the worker script failed to load or crashed before its own error handler ran.'
}

function workerErrorEventInternal(event: ErrorEvent): Record<string, unknown> {
  const error = event.error
  return {
    browserMessage: nonEmptyString(event.message),
    filename: nonEmptyString(event.filename),
    lineNumber: positiveNumberOrNull(event.lineno),
    columnNumber: positiveNumberOrNull(event.colno),
    errorName: error instanceof Error ? error.name : null,
    errorMessage: errorMessage(error),
    errorStack: error instanceof Error ? error.stack : null,
    rawErrorType: rawErrorType(error),
  }
}

function errorMessage(error: unknown): string | null {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return null
}

function rawErrorType(error: unknown): string | null {
  if (error === null || error === undefined) return null
  if (error instanceof Error) return error.name
  return Object.prototype.toString.call(error)
}

function messageWithDetail(summary: string, detail: string | null): string {
  if (!detail) return summary
  return `${summary}: ${detail}`
}

function nonEmptyString(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? ''
  if (trimmed.length === 0) return null
  return trimmed
}

function positiveNumberOrNull(value: number): number | null {
  if (value > 0) return value
  return null
}
