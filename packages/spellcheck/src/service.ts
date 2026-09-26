import type { SpellcheckWorkerRequest, SpellcheckWorkerResponse } from './protocol'

export type SpellcheckServiceOptions = {
  /** Replaces the bundled worker, for tests and hosts that serve workers themselves. */
  readonly workerFactory?: () => Worker
}

type Pending = {
  readonly resolve: (value: readonly string[]) => void
  readonly reject: (error: Error) => void
}

const DEFAULT_SUGGESTIONS = 5

/**
 * One dictionary worker, shared by every editor on the page. The host creates it once and hands it
 * to each editor's spellcheck; the worker starts on the first request.
 */
export class SpellcheckService {
  private worker: Worker | null = null
  private disposed = false
  private nextId = 1
  private acceptedWords: readonly string[] = []
  private accepted = new Set<string>()
  private readonly acceptedListeners = new Set<() => void>()
  private readonly pending = new Map<number, Pending>()

  public constructor(private readonly options: SpellcheckServiceOptions = {}) {}

  /** The words among `words` that are misspelled. */
  public check(words: readonly string[]): Promise<readonly string[]> {
    if (words.length === 0) return Promise.resolve([])
    return this.request((id) => ({ type: 'check', id, words }))
  }

  public suggest(word: string, limit = DEFAULT_SUGGESTIONS): Promise<readonly string[]> {
    return this.request((id) => ({ type: 'suggest', id, word, limit }))
  }

  /** Replaces the accepted list for every editor sharing the service; it survives a worker restart. */
  public setAcceptedWords(words: readonly string[]): void {
    this.acceptedWords = words
    this.accepted = new Set(words)
    if (this.worker) this.worker.postMessage({ type: 'setAcceptedWords', words })
    for (const listener of this.acceptedListeners) listener()
  }

  /** Answered here, so a verdict the worker gave before the word was accepted never needs asking again. */
  public isAccepted(word: string): boolean {
    return this.accepted.has(word) || this.accepted.has(word.toLowerCase())
  }

  public onDidChangeAcceptedWords(listener: () => void): { dispose(): void } {
    this.acceptedListeners.add(listener)
    return { dispose: () => this.acceptedListeners.delete(listener) }
  }

  public dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.acceptedListeners.clear()
    this.stop(new Error('The spellcheck service was disposed'))
  }

  private request(build: (id: number) => SpellcheckWorkerRequest): Promise<readonly string[]> {
    if (this.disposed) return Promise.reject(new Error('The spellcheck service was disposed'))

    const id = this.nextId++
    const worker = this.ensureWorker()
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      worker.postMessage(build(id))
    })
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker

    const worker =
      this.options.workerFactory?.() ??
      new Worker(new URL('./spellcheck.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<SpellcheckWorkerResponse>) => this.receive(event.data)
    worker.onerror = (event: ErrorEvent) => this.crash(event.message)
    if (this.acceptedWords.length > 0) {
      worker.postMessage({ type: 'setAcceptedWords', words: this.acceptedWords })
    }
    this.worker = worker
    return worker
  }

  private receive(response: SpellcheckWorkerResponse): void {
    if (response.type === 'error') {
      this.settleError(response.id, response.message)
      return
    }

    const pending = this.pending.get(response.id)
    if (!pending) return
    this.pending.delete(response.id)
    pending.resolve(response.type === 'check' ? response.misspelled : response.suggestions)
  }

  private settleError(id: number | null, message: string): void {
    const pending = id === null ? undefined : this.pending.get(id)
    if (!pending || id === null) return
    this.pending.delete(id)
    pending.reject(new Error(`Spellcheck failed: ${message}`))
  }

  /** A crashed worker is dropped; the next request starts a fresh one. */
  private crash(message: string): void {
    this.stop(new Error(`The spellcheck worker stopped: ${message}`))
  }

  private stop(error: Error): void {
    this.worker?.terminate()
    this.worker = null
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
  }
}
