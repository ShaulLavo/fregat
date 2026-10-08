import { CollabFailure } from './failure'
import type { Host } from './host'
import type { Participant } from './participant'
import type { Envelope } from './types'

type Delivery = { readonly at: number; readonly order: number; readonly deliver: () => void }

export class InMemoryTransport<Snapshot = unknown> {
  private queue: Delivery[] = []
  private clock = 0
  private order = 0
  private lastDelivery = new Map<Participant<Snapshot>, number>()
  private unsubscribe: () => void

  constructor(
    readonly host: Host<Snapshot>,
    participants: readonly Participant<Snapshot>[],
    delay: () => number = () => 0,
  ) {
    this.unsubscribe = host.subscribe((message) => {
      for (const participant of participants) {
        const at = Math.max(this.clock + delay(), this.lastDelivery.get(participant) ?? 0)
        this.lastDelivery.set(participant, at)
        this.schedule(at, () => participant.receive([message]))
      }
    })
  }

  submit(envelope: Envelope, delay = 0): void {
    if (!Number.isSafeInteger(delay) || delay < 0) throw new CollabFailure('invalid-delay')
    this.schedule(this.clock + delay, () => {
      this.host.submit(envelope)
    })
  }

  advance(ticks = 1): void {
    if (!Number.isSafeInteger(ticks) || ticks < 0) throw new CollabFailure('invalid-delay')
    const until = this.clock + ticks
    this.deliverUntil(until)
    this.clock = until
  }

  quiesce(maxDeliveries = 100_000): void {
    let delivered = 0
    while (this.queue.length) {
      if (++delivered > maxDeliveries) throw new CollabFailure('delivery-limit')
      this.queue.sort((a, b) => a.at - b.at || a.order - b.order)
      const next = this.queue.shift()!
      this.clock = next.at
      next.deliver()
    }
  }

  close(): void {
    this.unsubscribe()
    this.queue = []
  }

  private schedule(at: number, deliver: () => void): void {
    if (!Number.isSafeInteger(at) || at < this.clock) throw new CollabFailure('invalid-delay')
    this.queue.push({ at, order: ++this.order, deliver })
  }

  private deliverUntil(until: number): void {
    this.queue.sort((a, b) => a.at - b.at || a.order - b.order)
    while (this.queue[0] && this.queue[0].at <= until) {
      const next = this.queue.shift()!
      this.clock = next.at
      next.deliver()
      this.queue.sort((a, b) => a.at - b.at || a.order - b.order)
    }
  }
}
