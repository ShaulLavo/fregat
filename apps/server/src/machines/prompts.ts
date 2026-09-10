import type { MachineAuthPrompt } from '@workspace/contracts'
import { createSshError } from './structured-errors'

type PendingPrompt = {
  prompt: MachineAuthPrompt
  resolve: (response: string | null) => void
  timeout: ReturnType<typeof setTimeout> | null
}

export class MachinePrompts {
  private readonly queues = new Map<string, PendingPrompt[]>()
  private readonly publish: (client: string, prompt: MachineAuthPrompt | null) => void
  private closed = false

  constructor(publish: (client: string, prompt: MachineAuthPrompt | null) => void) {
    this.publish = publish
  }

  current(client: string) {
    return this.queues.get(client)?.[0]?.prompt ?? null
  }

  request(client: string, input: Omit<MachineAuthPrompt, 'id'>): Promise<string | null> {
    if (this.closed) return Promise.resolve(null)
    const prompt = { ...input, id: crypto.randomUUID() }
    return new Promise((resolve) => {
      const queue = this.queues.get(client) ?? []
      queue.push({
        prompt,
        resolve,
        timeout: null,
      })
      this.queues.set(client, queue)
      if (queue.length === 1) this.activate(client)
    })
  }

  respond(client: string, name: string, id: string, response: string | null) {
    const current = this.current(client)
    if (!current || current.id !== id || current.name !== name)
      throw createSshError('probe', 'This authentication prompt expired. Connect again.')
    this.finish(client, id, response)
  }

  cancelMachine(name: string) {
    for (const [client, queue] of this.queues) {
      for (const item of queue.filter((entry) => entry.prompt.name === name))
        this.finish(client, item.prompt.id, null)
    }
  }

  reassign(name: string, from: string, to: string) {
    if (from === to) return
    const queue = this.queues.get(from)
    if (!queue) return
    const moved = queue.filter((item) => item.prompt.name === name)
    if (moved.length === 0) return
    const activeMoved = queue[0]?.prompt.name === name
    const remaining = queue.filter((item) => item.prompt.name !== name)
    this.queues.set(from, remaining)
    for (const item of moved) {
      if (item.timeout) clearTimeout(item.timeout)
      item.timeout = null
    }
    const destination = this.queues.get(to) ?? []
    const wasEmpty = destination.length === 0
    destination.push(...moved)
    this.queues.set(to, destination)
    if (activeMoved) this.activate(from)
    if (wasEmpty) this.activate(to)
  }

  close() {
    this.closed = true
    for (const [client, queue] of this.queues) {
      for (const item of queue) this.cancel(item)
      this.publish(client, null)
    }
    this.queues.clear()
  }

  private cancel(item: PendingPrompt) {
    if (item.timeout) clearTimeout(item.timeout)
    item.resolve(null)
  }

  private finish(client: string, id: string, response: string | null) {
    const queue = this.queues.get(client)
    const index = queue?.findIndex((item) => item.prompt.id === id) ?? -1
    if (!queue || index === -1) return
    const item = queue.splice(index, 1)[0]!
    if (item.timeout) clearTimeout(item.timeout)
    item.resolve(response)
    if (queue.length === 0) this.queues.delete(client)
    if (index === 0) this.activate(client)
  }

  private activate(client: string) {
    const item = this.queues.get(client)?.[0]
    if (!item) {
      this.queues.delete(client)
      this.publish(client, null)
      return
    }
    item.timeout = setTimeout(() => this.finish(client, item.prompt.id, null), 120_000)
    this.publish(client, item.prompt)
  }
}
