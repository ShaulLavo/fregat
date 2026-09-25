import { orchestrationWsClientMessageSchema } from '@workspace/contracts'
import * as v from 'valibot'
import type { OrchestrationSocket, OrchestrationSocketEvents } from '../src/transport/rpc-host'
import { orchestrationServerConfig } from './orchestration-server-config'

type SocketListeners = {
  [K in keyof OrchestrationSocketEvents]: Set<(event: OrchestrationSocketEvents[K]) => void>
}

// Real sockets cannot stay OPEN while deliberately ignoring pings.
export class FakeOrchestrationSocket implements OrchestrationSocket {
  autoPong = false
  closed = false
  readyState = 0
  sent: string[] = []
  private listeners: SocketListeners = {
    open: new Set(),
    message: new Set(),
    error: new Set(),
    close: new Set(),
  }

  addEventListener<K extends keyof OrchestrationSocketEvents>(
    type: K,
    listener: (event: OrchestrationSocketEvents[K]) => void,
  ) {
    this.listeners[type].add(listener)
  }

  close() {
    this.closed = true
    this.readyState = 3
  }

  send(data: string) {
    this.sent.push(data)
    const message = v.parse(orchestrationWsClientMessageSchema, JSON.parse(data))
    if (!this.autoPong || message.kind !== 'ping') return

    setTimeout(() => this.deliver({ kind: 'pong', requestId: message.requestId }), 0)
  }

  open(handshake = true) {
    this.readyState = 1
    this.emit('open', { type: 'open' })
    if (handshake) this.deliver({ kind: 'connected', config: orchestrationServerConfig() })
  }

  deliver(message: unknown) {
    this.emit('message', { data: JSON.stringify(message) })
  }

  /** A browser reports a failed connection as `error`, then `close` with 1006. */
  transportFailure() {
    this.readyState = 3
    this.emit('error', { type: 'error' })
    this.emit('close', { code: 1006, reason: '', wasClean: false })
  }

  serverClose({ code, wasClean }: { code: number; wasClean: boolean }) {
    this.readyState = 3
    this.emit('close', { code, reason: '', wasClean })
  }

  private emit<K extends keyof OrchestrationSocketEvents>(
    type: K,
    event: OrchestrationSocketEvents[K],
  ) {
    for (const listener of this.listeners[type]) {
      listener(event)
    }
  }
}
