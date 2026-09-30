/*
 * The worker's own session, run on this thread behind the `LspWorkerLike` a real `Worker` presents.
 *
 * Messages cross in both directions on a later task and through `structuredClone`, as they would
 * between threads, so a result that cannot be posted, or a handler that assumes a synchronous
 * answer, fails here the way it would in a browser. The lib files come off disk: no suite of ours
 * may reach the network.
 */

import type { LspWorkerLike } from '@singapore-editor/lsp'
import {
  createTypeScriptLanguageSession,
  type TypeScriptLanguageSession,
} from '../src/worker/session'
import { libraryFilesFromDisk } from './realTypeScriptService'

export class InProcessTypeScriptWorker implements LspWorkerLike {
  /** Every message the session posted, in order. */
  public readonly received: unknown[] = []
  readonly #listeners = { message: new Set<EventListener>(), error: new Set<EventListener>() }
  readonly #session: TypeScriptLanguageSession
  #terminated = false

  public constructor() {
    this.#session = createTypeScriptLanguageSession({
      post: (message) => this.#deliver(message),
      readLibraryFiles: (names) => Promise.resolve(libraryFilesFromDisk(names)),
    })
  }

  public postMessage(message: unknown): void {
    if (this.#terminated) throw new Error('The in-process TypeScript worker was terminated')

    const copy = structuredClone(message)
    setTimeout(() => {
      if (!this.#terminated) this.#session.receive(copy)
    }, 0)
  }

  public addEventListener(type: 'message' | 'error', handler: EventListener): void {
    this.#listeners[type].add(handler)
  }

  public removeEventListener(type: 'message' | 'error', handler: EventListener): void {
    this.#listeners[type].delete(handler)
  }

  public terminate(): void {
    this.#terminated = true
    this.#session.dispose()
  }

  #deliver(message: unknown): void {
    const copy = structuredClone(message)
    this.received.push(copy)
    setTimeout(() => {
      if (this.#terminated) return
      const event = new MessageEvent('message', { data: copy })
      for (const listener of this.#listeners.message) listener(event)
    }, 0)
  }
}
