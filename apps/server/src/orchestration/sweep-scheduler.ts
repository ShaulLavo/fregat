import { recordProcessWarning } from '../observability'

/**
 * A periodic sweep that also runs on demand. Requests during a sweep collapse into one more
 * sweep after it, so a burst of events never stacks work.
 */
export class SweepScheduler {
  private readonly sweep: () => Promise<void>
  private readonly failure: { event: string; area: string }
  private readonly intervalMs: number
  private interval: ReturnType<typeof setInterval> | null = null
  private running: Promise<void> | null = null
  private rerun = false
  private closed = false

  constructor(options: {
    sweep: () => Promise<void>
    failureEvent: string
    area: string
    intervalMs: number
  }) {
    this.sweep = options.sweep
    this.failure = { event: options.failureEvent, area: options.area }
    this.intervalMs = options.intervalMs
  }

  start() {
    if (this.closed || this.interval) return
    this.interval = setInterval(() => this.schedule(), this.intervalMs)
    this.interval.unref()
    this.schedule()
  }

  schedule() {
    if (this.closed) return
    if (this.running) {
      this.rerun = true
      return
    }
    this.running = this.sweep()
      .catch((error: unknown) =>
        recordProcessWarning(this.failure.event, { area: this.failure.area, error }),
      )
      .finally(() => {
        this.running = null
        if (!this.rerun) return
        this.rerun = false
        this.schedule()
      })
  }

  async drain() {
    while (this.running) await this.running
  }

  async close() {
    this.closed = true
    if (this.interval) clearInterval(this.interval)
    this.interval = null
    await this.drain()
  }
}
