import type { MachineEvent } from '@workspace/contracts'

type Listener = { client: string; push: (event: MachineEvent) => void; wake: () => void }

export class MachineEvents {
  private readonly listeners = new Set<Listener>()
  private closed = false

  publish(event: MachineEvent, client?: string) {
    for (const listener of this.listeners) {
      if (client && listener.client !== client) continue
      listener.push(event)
    }
  }

  hasClient(client: string) {
    return [...this.listeners].some((listener) => listener.client === client)
  }

  async *subscribe(client: string, initial: readonly MachineEvent[], signal: AbortSignal) {
    const queue = [...initial]
    let wake: (() => void) | null = null
    const listener: Listener = {
      client,
      push: (event) => {
        queue.push(event)
        wake?.()
      },
      wake: () => wake?.(),
    }
    this.listeners.add(listener)
    signal.addEventListener('abort', listener.wake, { once: true })
    try {
      while (!this.closed && !signal.aborted) {
        const event = queue.shift()
        if (event) yield event
        else
          await new Promise<void>((resolve) => {
            wake = resolve
          })
      }
    } finally {
      this.listeners.delete(listener)
      signal.removeEventListener('abort', listener.wake)
    }
  }

  close() {
    this.closed = true
    for (const listener of this.listeners) listener.wake()
  }
}
