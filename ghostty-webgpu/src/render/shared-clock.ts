import type { RenderSchedulerClock } from './scheduler.js'

/** Delivers pending terminals as one synchronous batch; new work during delivery waits a frame. */
export class SharedRenderClock implements RenderSchedulerClock {
  private frameHandle?: number
  private frameToken = 0
  private nextHandle = 1
  private pending = new Map<number, () => void>()
  private running = new Map<number, () => void>()

  constructor(
    private readonly clock: RenderSchedulerClock,
    private readonly reportError: (error: unknown) => void = (error) =>
      globalThis.reportError(error),
  ) {}

  cancelFrame(handle: number): void {
    this.running.delete(handle)
    this.pending.delete(handle)
    if (this.pending.size !== 0 || this.frameHandle === undefined) return
    this.clock.cancelFrame(this.frameHandle)
    this.frameHandle = undefined
    this.frameToken += 1
  }

  clearTimer(handle: number): void {
    this.clock.clearTimer(handle)
  }

  requestFrame(callback: () => void): number {
    const handle = this.nextHandle++
    if (this.frameHandle === undefined) {
      const token = ++this.frameToken
      this.frameHandle = this.clock.requestFrame(() => this.runFrame(token))
    }
    this.pending.set(handle, callback)
    return handle
  }

  setTimer(callback: () => void, delayMs: number): number {
    return this.clock.setTimer(callback, delayMs)
  }

  private runFrame(token: number): void {
    if (token !== this.frameToken) return
    this.frameHandle = undefined
    const empty = this.running
    this.running = this.pending
    this.pending = empty
    for (const [handle, callback] of this.running) {
      this.running.delete(handle)
      try {
        callback()
      } catch (error) {
        // Native rAF reports callback errors without stopping the other terminals.
        this.reportError(error)
      }
    }
  }
}
