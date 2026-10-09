import type { RenderSchedulerClock } from './scheduler.js'

export interface FrameSubmission {
  readonly owner: object
  readonly device: GPUDevice
  readonly encoder: GPUCommandEncoder
  commit(): void
  notify(): void
  failed(cause: unknown): void
}

export class FrameCoordinator implements RenderSchedulerClock {
  private readonly callbacks = new Map<number, () => void>()
  private readonly pending: FrameSubmission[] = []
  private readonly encoders = new Map<GPUDevice, GPUCommandEncoder>()
  private readonly abandoned = new WeakMap<GPUCommandEncoder, { cause: unknown }>()
  private nextHandle = 0
  private frameHandle?: number
  private active = false

  constructor(private readonly clock: RenderSchedulerClock) {}

  requestFrame(callback: () => void): number {
    const handle = ++this.nextHandle
    this.callbacks.set(handle, callback)
    this.frameHandle ??= this.clock.requestFrame(() => this.runFrame())
    return handle
  }

  cancelFrame(handle: number): void {
    this.callbacks.delete(handle)
    if (this.callbacks.size !== 0 || this.frameHandle === undefined) return
    this.clock.cancelFrame(this.frameHandle)
    this.frameHandle = undefined
  }

  setTimer(callback: () => void, delayMs: number): number {
    return this.clock.setTimer(callback, delayMs)
  }

  clearTimer(handle: number): void {
    this.clock.clearTimer(handle)
  }

  createEncoder(device: GPUDevice): GPUCommandEncoder {
    if (!this.active) return device.createCommandEncoder()
    const existing = this.encoders.get(device)
    if (existing) return existing
    const encoder = device.createCommandEncoder()
    this.encoders.set(device, encoder)
    return encoder
  }

  abandonEncoder(device: GPUDevice, encoder: GPUCommandEncoder, cause: unknown): void {
    this.abandoned.set(encoder, { cause })
    if (this.encoders.get(device) === encoder) this.encoders.delete(device)
  }

  submit(frame: FrameSubmission): void {
    if (!this.active) {
      try {
        frame.device.queue.submit([frame.encoder.finish()])
        frame.commit()
      } catch (cause) {
        frame.failed(cause)
        return
      }
      frame.notify()
      return
    }
    this.pending.push(frame)
  }

  flushPending(): void {
    this.flush()
  }

  flushOwner(owner: object): void {
    if (this.pending.some((frame) => frame.owner === owner)) this.flushPending()
  }

  private runFrame(): void {
    this.frameHandle = undefined
    const callbacks = [...this.callbacks.values()]
    this.callbacks.clear()
    this.active = true
    try {
      for (const callback of callbacks) this.invoke(callback)
    } finally {
      this.flush()
      this.active = false
    }
  }

  private flush(): void {
    this.encoders.clear()
    const frames = this.pending.splice(0)
    if (frames.length === 0) return
    const groups = new Map<GPUCommandEncoder, FrameSubmission[]>()
    for (const frame of frames) {
      const group = groups.get(frame.encoder) ?? []
      group.push(frame)
      groups.set(frame.encoder, group)
    }
    const submitted: FrameSubmission[] = []
    const failures: { frame: FrameSubmission; cause: unknown }[] = []
    for (const [encoder, group] of groups) {
      const result = this.submitGroup(encoder, group)
      if (result.kind === 'submitted') submitted.push(...result.frames)
      else failures.push(...result.frames.map((frame) => ({ frame, cause: result.cause })))
    }
    const committed = submitted.filter((frame) => {
      try {
        frame.commit()
        return true
      } catch (cause) {
        failures.push({ frame, cause })
        return false
      }
    })
    for (const failure of failures) this.invoke(() => failure.frame.failed(failure.cause))
    for (const frame of committed) this.invoke(() => frame.notify())
    this.flush()
  }

  private submitGroup(
    encoder: GPUCommandEncoder,
    frames: readonly FrameSubmission[],
  ):
    | { kind: 'submitted'; frames: readonly FrameSubmission[] }
    | { kind: 'failed'; frames: readonly FrameSubmission[]; cause: unknown } {
    const abandoned = this.abandoned.get(encoder)
    if (abandoned) return { kind: 'failed', frames, cause: abandoned.cause }
    try {
      frames[0]!.device.queue.submit([encoder.finish()])
      return { kind: 'submitted', frames }
    } catch (cause) {
      return { kind: 'failed', frames, cause }
    }
  }

  private invoke(callback: () => void): boolean {
    try {
      callback()
      return true
    } catch (cause) {
      queueMicrotask(() => {
        throw cause
      })
      return false
    }
  }
}
