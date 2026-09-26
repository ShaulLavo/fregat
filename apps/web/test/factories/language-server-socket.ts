import { isRecord } from '@workspace/utils/objects'

import type { ServerSocket } from '@workspace/client-core/transport/socket'

export function createLanguageServerSocket() {
  const events = new EventTarget()
  const sent: Record<string, unknown>[] = []
  let closed = false
  const socket: ServerSocket = {
    send(message) {
      if (typeof message !== 'string') return
      const value: unknown = JSON.parse(message)
      if (isRecord(value)) sent.push(value)
    },
    close() {
      closed = true
      events.dispatchEvent(new Event('close'))
    },
    // EventTarget types its listener as a plain Event one; the socket's are typed per event.
    addEventListener(type, listener, options) {
      events.addEventListener(type, listener as EventListener, options)
    },
    removeEventListener(type, listener, options) {
      events.removeEventListener(type, listener as EventListener, options)
    },
  }
  return {
    socket,
    sent,
    get closed() {
      return closed
    },
    open() {
      events.dispatchEvent(new Event('open'))
    },
    respond(id: unknown, result: unknown) {
      events.dispatchEvent(
        new MessageEvent('message', {
          data: JSON.stringify({ jsonrpc: '2.0', id, result }),
        }),
      )
    },
  }
}
