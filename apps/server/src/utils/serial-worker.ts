type PendingTask<Task> = {
  reject: (error: unknown) => void
  resolve: () => void
  task: Task
}

/**
 * One task at a time, in enqueue order, with a drain that re-reads the queue
 * instead of capturing its tail — the property five hand-rolled queues each
 * spelled differently, and one of them (ingestion) got wrong.
 *
 * `enqueue` rejects when the handler throws. Ignoring the returned promise is
 * only safe for handlers that catch everything themselves; every caller in this
 * repo either awaits it or passes a total handler.
 */
export class SerialWorker<Task> {
  private active = false
  private readonly handler: (task: Task) => Promise<void>
  private readonly queue: Array<PendingTask<Task>> = []
  private readonly waiters: Array<() => void> = []

  constructor(handler: (task: Task) => Promise<void>) {
    this.handler = handler
  }

  enqueue(task: Task) {
    const { promise, reject, resolve } = Promise.withResolvers<void>()
    this.queue.push({ reject, resolve: () => resolve(), task })
    void this.run()

    return promise
  }

  isIdle() {
    return !this.active && this.queue.length === 0
  }

  /**
   * Resolves without rejecting once work enqueued through the current
   * synchronous turn is complete and the worker is idle.
   */
  drain() {
    return new Promise<void>((resolve) => {
      this.waiters.push(resolve)
      void Promise.resolve().then(() => this.resolveWaitersIfIdle())
    })
  }

  private async run() {
    if (this.active) return

    this.active = true
    try {
      while (this.queue.length > 0) {
        const pending = this.queue.shift() as PendingTask<Task>
        await this.settle(pending)
      }
    } finally {
      this.active = false
      this.resolveWaitersIfIdle()
      if (this.queue.length > 0) void this.run()
    }
  }

  private async settle(pending: PendingTask<Task>) {
    try {
      await this.handler(pending.task)
      pending.resolve()
    } catch (error) {
      pending.reject(error)
    }
  }

  private resolveWaitersIfIdle() {
    if (!this.isIdle()) return

    const waiters = this.waiters.splice(0)
    for (const waiter of waiters) {
      waiter()
    }
  }
}
