import { createLiveStreamOverflowError } from './structured-errors'

type QueueEntry<T> = { item: T; bytes: number; snapshot: boolean }
type QueueOptions<T> = {
  maxItems?: number
  maxBytes?: number
  isSnapshot?: (item: T) => boolean
  onOverflow?: () => void
}

export class AsyncSubscriptionQueue<T> {
  private closed = false
  private error: unknown = null
  private items: QueueEntry<T>[] = []
  private delivered: QueueEntry<T> | null = null
  private bytes = 0
  private count = 0
  private snapshots = 0
  private readonly options: QueueOptions<T>
  private waiters: Array<{
    reject: (error: unknown) => void
    resolve: (result: IteratorResult<T>) => void
  }> = []

  constructor(options: QueueOptions<T> = {}) {
    this.options = options
  }

  get usage() {
    return { items: this.count, bytes: this.bytes }
  }

  push(item: T) {
    if (this.closed) return
    const snapshot = this.options.isSnapshot?.(item) ?? false
    const bytes = snapshot ? 0 : new TextEncoder().encode(JSON.stringify(item)).byteLength
    if (
      this.count + 1 > (this.options.maxItems ?? 1_000) ||
      this.bytes + bytes > (this.options.maxBytes ?? 8 * 1024 * 1024) ||
      (snapshot && this.snapshots > 0)
    ) {
      this.fail(createLiveStreamOverflowError())
      this.options.onOverflow?.()
      return
    }
    const entry = { item, bytes, snapshot }
    this.count += 1
    this.bytes += bytes
    if (snapshot) this.snapshots += 1
    const waiter = this.waiters.shift()
    if (waiter) {
      this.delivered = entry
      waiter.resolve({ done: false, value: item })
      return
    }
    this.items.push(entry)
  }

  fail(error: unknown) {
    if (this.closed) return
    this.error = error
    this.clear()
    for (const waiter of this.drainWaiters()) waiter.reject(error)
  }

  close() {
    if (this.closed) return
    this.clear()
    for (const waiter of this.drainWaiters()) waiter.resolve({ done: true, value: undefined })
  }

  next(): Promise<IteratorResult<T>> {
    this.releaseDelivered()
    const entry = this.items.shift()
    if (entry) {
      this.delivered = entry
      return Promise.resolve({ done: false, value: entry.item })
    }
    if (this.error !== null) return Promise.reject(this.error)
    if (this.closed) return Promise.resolve({ done: true, value: undefined })
    return new Promise((resolve, reject) => {
      this.waiters.push({ reject, resolve })
    })
  }

  private releaseDelivered() {
    if (!this.delivered) return
    this.count -= 1
    this.bytes -= this.delivered.bytes
    if (this.delivered.snapshot) this.snapshots -= 1
    this.delivered = null
  }

  private clear() {
    this.closed = true
    this.items = []
    this.delivered = null
    this.bytes = 0
    this.count = 0
    this.snapshots = 0
  }

  private drainWaiters() {
    const waiters = this.waiters
    this.waiters = []
    return waiters
  }
}

export async function* drainSubscriptionQueue<T>(queue: AsyncSubscriptionQueue<T>) {
  while (true) {
    const result = await queue.next()
    if (result.done) return
    yield result.value
  }
}
