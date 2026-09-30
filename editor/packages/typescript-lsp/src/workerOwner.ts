import {
  LSP_SERVER_EXITED,
  type LspServerExitedParams,
  type LspWorkerLike,
} from '@singapore-editor/lsp'

export type TypeScriptLspWorkerLifecycleState = 'ready' | 'disposed' | 'crashed'

export type TypeScriptLspWorkerOwnerSnapshot = {
  readonly lifecycle: TypeScriptLspWorkerLifecycleState
  readonly postedMessages: number
  readonly messageListeners: number
  readonly errorListeners: number
  readonly lastError: string | null
}

export type TypeScriptLspWorkerOwnerOptions = {
  readonly workerFactory?: () => LspWorkerLike
  readonly onError?: (error: Error) => void
}

export class TypeScriptLspWorkerOwner implements LspWorkerLike {
  private readonly listeners = {
    message: new Set<EventListener>(),
    error: new Set<EventListener>(),
  }
  private worker: LspWorkerLike | null = null
  private lifecycle: TypeScriptLspWorkerLifecycleState = 'ready'
  private postedMessages = 0
  private lastError: Error | null = null

  public constructor(private readonly options: TypeScriptLspWorkerOwnerOptions = {}) {
    this.worker = this.createWorker()
  }

  public inspect(): TypeScriptLspWorkerOwnerSnapshot {
    return {
      lifecycle: this.lifecycle,
      postedMessages: this.postedMessages,
      messageListeners: this.listeners.message.size,
      errorListeners: this.listeners.error.size,
      lastError: this.lastError?.message ?? null,
    }
  }

  public postMessage(message: unknown): void {
    const handle = this.worker
    if (!this.canPost(handle)) throw new Error('TypeScript LSP worker is not available')

    this.postedMessages += 1
    try {
      handle.postMessage(message)
    } catch (error) {
      const normalized = workerError(error)
      this.fail(normalized, errorEvent(normalized))
      throw normalized
    }
  }

  public addEventListener(type: 'message' | 'error', handler: EventListener): void {
    this.listeners[type].add(handler)
  }

  public removeEventListener(type: 'message' | 'error', handler: EventListener): void {
    this.listeners[type].delete(handler)
  }

  public terminate(): void {
    if (this.lifecycle === 'disposed') return

    this.lifecycle = 'disposed'
    this.detachWorker()
    this.terminateWorker()
    this.clearListeners()
  }

  public dispose(): void {
    this.terminate()
  }

  private createWorker(): LspWorkerLike {
    const handle = (this.options.workerFactory ?? defaultWorkerFactory)()
    handle.addEventListener('message', this.handleMessage)
    handle.addEventListener('error', this.handleError)
    return handle
  }

  private canPost(handle: LspWorkerLike | null): handle is LspWorkerLike {
    if (!handle) return false
    return this.lifecycle === 'ready'
  }

  private readonly handleMessage = (event: Event): void => {
    if (this.lifecycle !== 'ready') return
    for (const listener of this.listeners.message) listener(event)
  }

  private readonly handleError = (event: Event): void => {
    this.fail(workerEventError(event), event)
  }

  private fail(error: Error, event: Event): void {
    if (this.lifecycle === 'disposed') return

    this.lifecycle = 'crashed'
    this.lastError = error
    this.detachWorker()
    this.terminateWorker()
    this.announceExit(error)
    for (const listener of this.listeners.error) listener(event)
    this.options.onError?.(error)
    this.clearListeners()
  }

  /**
   * Says why before the error closes the transport, as a server process's host does, so a crashed
   * worker reaches the client as an exit with a reason rather than as a connection that went quiet.
   */
  private announceExit(error: Error): void {
    const event = new MessageEvent('message', {
      data: { jsonrpc: '2.0', method: LSP_SERVER_EXITED, params: crashedParams(error) },
    })
    for (const listener of this.listeners.message) listener(event)
  }

  private detachWorker(): void {
    this.worker?.removeEventListener('message', this.handleMessage)
    this.worker?.removeEventListener('error', this.handleError)
  }

  private terminateWorker(): void {
    this.worker?.terminate?.()
    this.worker = null
  }

  private clearListeners(): void {
    this.listeners.message.clear()
    this.listeners.error.clear()
  }
}

export function createTypeScriptLspWorkerOwner(
  options: TypeScriptLspWorkerOwnerOptions = {},
): TypeScriptLspWorkerOwner {
  return new TypeScriptLspWorkerOwner(options)
}

function defaultWorkerFactory(): Worker {
  return new Worker(new URL('./typescriptLsp.worker.ts', import.meta.url), {
    type: 'module',
  })
}

function crashedParams(error: Error): LspServerExitedParams {
  return {
    outcome: 'crashed',
    serverId: 'typescript',
    exitCode: null,
    exitSignal: null,
    error: {
      code: 'LSP_SERVER_EXITED',
      message: error.message,
      why: 'The TypeScript language worker threw and stopped.',
      fix: 'Reload the editor to start the TypeScript language worker again.',
    },
  }
}

export function workerEventError(event: Event): Error {
  const message = (event as ErrorEvent).message
  if (message) return new Error(message)
  return new Error('TypeScript LSP worker failed')
}

function workerError(error: unknown): Error {
  if (error instanceof Error) return error
  return new Error(String(error))
}

function errorEvent(error: Error): Event {
  if (typeof ErrorEvent !== 'undefined') return new ErrorEvent('error', { message: error.message })
  return { message: error.message } as ErrorEvent
}
