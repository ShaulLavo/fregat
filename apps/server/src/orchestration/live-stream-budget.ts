import { EvlogError, defineErrorCatalog } from 'evlog'

const errors = defineErrorCatalog('orchestration', {
  LIVE_STREAM_OVERFLOW: {
    status: 409,
    message: 'Live updates exceeded the subscription buffer.',
    why: 'The consumer has not acknowledged updates fast enough to keep retained delivery bounded.',
    fix: 'Resume the subscription from the last applied sequence.',
  },
  LIVE_STREAM_ACK_TIMEOUT: {
    status: 408,
    message: 'Live updates went unacknowledged, so the server closed the connection.',
    why: 'The client left a delivery unacknowledged past the server timeout.',
    fix: 'Reconnect and resume the subscription from the last applied sequence.',
  },
})

export function isLiveStreamAckTimeout(error: unknown) {
  return EvlogError.isEvlogError(error) && error.code === errors.LIVE_STREAM_ACK_TIMEOUT.code
}

export type RetainedLiveItem<T> = { readonly value: T; readonly serializedBytes: number }
export type LiveStreamLimits = { readonly maxItems: number; readonly maxBytes: number }
const defaults: LiveStreamLimits = { maxItems: 1_000, maxBytes: 8 * 1024 * 1024 }
const sizes = new WeakMap<object, number>()

export class LiveStreamBudget {
  private readonly retained = new Set<RetainedLiveItem<unknown>>()
  private bytes = 0
  private readonly controller = new AbortController()
  readonly signal = this.controller.signal

  private readonly limits: LiveStreamLimits

  constructor(limits: LiveStreamLimits = defaults) {
    this.limits = limits
  }

  get usage() {
    return { items: this.retained.size, bytes: this.bytes }
  }

  retain<T extends object>(value: T): RetainedLiveItem<T> {
    const [item] = this.replace([], [value])
    return item!
  }

  replace<T extends object>(previous: readonly RetainedLiveItem<unknown>[], values: readonly T[]) {
    this.signal.throwIfAborted()
    const next = values.map((value) => ({ value, serializedBytes: serializedSize(value) }))
    const removed = previous.filter((item) => this.retained.has(item))
    const items = this.retained.size - removed.length + next.length
    const bytes = this.bytes - sumBytes(removed) + sumBytes(next)
    if (items > this.limits.maxItems || bytes > this.limits.maxBytes) {
      throw this.overflow({ nextItems: items, nextBytes: bytes })
    }
    this.release(previous)
    for (const item of next) this.retained.add(item)
    this.bytes = bytes
    return next
  }

  /** Ends delivery for a consumer that stopped acknowledging; the caps were not reached. */
  ackTimeout(extra: Record<string, number>) {
    return this.abort(errors.LIVE_STREAM_ACK_TIMEOUT({ internal: { ...this.usage, ...extra } }))
  }

  release(items: readonly RetainedLiveItem<unknown>[]) {
    for (const item of items) {
      if (!this.retained.delete(item)) continue
      this.bytes -= item.serializedBytes
    }
  }

  dispose() {
    this.controller.abort()
    this.clear()
  }

  private overflow(extra: Record<string, number>) {
    return this.abort(
      errors.LIVE_STREAM_OVERFLOW({ internal: { ...this.usage, ...this.limits, ...extra } }),
    )
  }

  private abort(error: EvlogError) {
    this.controller.abort(error)
    this.clear()
    return error
  }

  private clear() {
    this.retained.clear()
    this.bytes = 0
  }
}

function serializedSize(value: object) {
  const cached = sizes.get(value)
  if (cached !== undefined) return cached
  const size = Buffer.byteLength(JSON.stringify(value))
  sizes.set(value, size)
  return size
}

function sumBytes(items: readonly RetainedLiveItem<unknown>[]) {
  return items.reduce((sum, item) => sum + item.serializedBytes, 0)
}
