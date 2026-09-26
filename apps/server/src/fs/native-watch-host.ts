import path from 'node:path'
import type {
  NativeWatchError,
  NativeWatchRequest,
  NativeWatchResponse,
} from './native-watch-protocol'

export type { NativeWatchError } from './native-watch-protocol'

/** The error code every watch reports when the worker holding it dies. */
export const WATCH_WORKER_FAILED = 'WATCH_WORKER_FAILED'

export type NativeWatchCallbacks = {
  readonly event: (event: string, filename: string) => void
  readonly error: (error: NativeWatchError) => void
}

type NativeWatchAttach =
  | {
      readonly status: 'attached'
      readonly attachMs: number
      readonly errors: readonly NativeWatchError[]
      readonly close: () => void
    }
  | { readonly status: 'failed'; readonly error: NativeWatchError }

type NativeWatch = {
  readonly callbacks: NativeWatchCallbacks
  readonly attached: ReturnType<typeof Promise.withResolvers<NativeWatchAttach>>
}

// Dev runs the source and the bundle keeps the built copy beside `index.js`, so one relative path serves both.
const defaultWorkerPath = path.join(import.meta.dirname, 'watch-worker.ts')

/** Owns the worker that runs every native `fs.watch` for one file change hub. */
export class NativeWatchHost {
  private worker: Worker | null = null
  private nextId = 1
  private readonly watches = new Map<number, NativeWatch>()

  private readonly workerPath: string

  /** `workerPath` is a test seam for a worker that fails. */
  constructor(workerPath = defaultWorkerPath) {
    this.workerPath = workerPath
  }

  watch(absolutePath: string, recursive: boolean, callbacks: NativeWatchCallbacks) {
    const id = this.nextId++
    const attached = Promise.withResolvers<NativeWatchAttach>()
    this.watches.set(id, { attached, callbacks })
    this.send({ type: 'watch', id, path: absolutePath, recursive })
    return attached.promise
  }

  close() {
    this.worker?.terminate()
    this.worker = null
    this.watches.clear()
  }

  private closeWatch(id: number) {
    if (!this.watches.delete(id)) return
    this.send({ type: 'close', id })
  }

  private send(request: NativeWatchRequest) {
    this.ensureWorker().postMessage(request)
  }

  private ensureWorker() {
    if (this.worker) return this.worker
    // Bun reads `ref`; the DOM typing that wins in this project does not declare it.
    const options: WorkerOptions & { ref: boolean } = { ref: false }
    const worker = new Worker(this.workerPath, options)
    worker.onmessage = (message: MessageEvent<NativeWatchResponse>) => this.receive(message.data)
    worker.onerror = (event) => this.failAll(worker, event.message)
    this.worker = worker
    return worker
  }

  private receive(response: NativeWatchResponse) {
    if (response.type === 'events') {
      for (const [id, event, filename] of response.events) {
        this.watches.get(id)?.callbacks.event(event, filename)
      }
      return
    }
    const watch = this.watches.get(response.id)
    if (!watch) return
    if (response.type === 'error') {
      watch.callbacks.error(response.error)
      return
    }
    if (response.type === 'failed') {
      this.watches.delete(response.id)
      watch.attached.resolve({ status: 'failed', error: response.error })
      return
    }
    watch.attached.resolve({
      status: 'attached',
      attachMs: response.attachMs,
      errors: response.errors,
      close: () => this.closeWatch(response.id),
    })
  }

  private failAll(worker: Worker, message: string) {
    if (this.worker !== worker) return
    this.worker = null
    worker.terminate()
    const error = { code: WATCH_WORKER_FAILED, message: `native watch worker failed: ${message}` }
    // Taken first: a holder that closes its watch while hearing of the failure finds nothing to send.
    const failed = [...this.watches.values()]
    this.watches.clear()
    for (const watch of failed) {
      watch.attached.resolve({ status: 'failed', error })
      watch.callbacks.error(error)
    }
  }
}
