import type { MachineEvent } from '@workspace/contracts'
import { AsyncQueue } from '../async-queue'

type Listener = { client: string; queue: AsyncQueue<MachineEvent> }

export class MachineEvents {
  private readonly listeners = new Set<Listener>()
  private closed = false

  publish(event: MachineEvent, client?: string) {
    for (const listener of this.listeners) {
      if (client && listener.client !== client) continue
      listener.queue.push(event)
    }
  }

  hasClient(client: string) {
    return [...this.listeners].some((listener) => listener.client === client)
  }

  async *subscribe(client: string, initial: readonly MachineEvent[], signal: AbortSignal) {
    if (this.closed) return

    const listener: Listener = { client, queue: new AsyncQueue({ initial, signal }) }
    this.listeners.add(listener)
    try {
      yield* listener.queue
    } finally {
      this.listeners.delete(listener)
      listener.queue.close()
    }
  }

  close() {
    this.closed = true
    for (const listener of this.listeners) listener.queue.close()
  }
}
