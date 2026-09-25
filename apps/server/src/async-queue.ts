const DONE: IteratorReturnResult<undefined> = { done: true, value: undefined }

export type AsyncQueueOptions<T> = {
  /** Delivered before anything pushed. */
  readonly initial?: readonly T[]
  /** Closes the queue when it aborts. */
  readonly signal?: AbortSignal
}

/**
 * Unbounded listener-to-iterator bridge. Teardown drops undelivered items and settles every parked
 * `next()` with done. It logs nothing: subscribe and unsubscribe events belong to the caller.
 */
export class AsyncQueue<T> implements AsyncIterableIterator<T, undefined> {
  private readonly items: T[]
  private readonly waiters: Array<(result: IteratorResult<T, undefined>) => void> = []
  private readonly signal: AbortSignal | undefined
  private ended = false

  private readonly abort = () => {
    this.close()
  }

  constructor(options: AsyncQueueOptions<T> = {}) {
    this.items = [...(options.initial ?? [])]
    this.signal = options.signal
    this.signal?.addEventListener('abort', this.abort, { once: true })
    if (this.signal?.aborted) this.close()
  }

  get closed() {
    return this.ended
  }

  push(item: T) {
    if (this.ended) return

    this.items.push(item)
    const waiter = this.waiters.shift()
    if (!waiter) return

    // A parked waiter means the queue was empty, so this is the item just pushed.
    waiter({ done: false, value: this.items.shift() as T })
  }

  next(): Promise<IteratorResult<T, undefined>> {
    if (this.items.length > 0)
      return Promise.resolve({ done: false, value: this.items.shift() as T })
    if (this.ended) return Promise.resolve(DONE)

    return new Promise((resolve) => {
      this.waiters.push(resolve)
    })
  }

  return(): Promise<IteratorResult<T, undefined>> {
    this.close()
    return Promise.resolve(DONE)
  }

  /** Ends the queue and returns the items no consumer received. */
  close(): T[] {
    if (this.ended) return []

    this.ended = true
    this.signal?.removeEventListener('abort', this.abort)
    for (const waiter of this.waiters.splice(0)) waiter(DONE)
    return this.items.splice(0)
  }

  [Symbol.asyncIterator]() {
    return this
  }
}
