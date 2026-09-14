import { isRecord } from '@workspace/contracts'

import type { EdenServerSocket } from '@/lib/server-sockets'

export function createLanguageServerSocket() {
  const events = new EventTarget()
  const sent: Record<string, unknown>[] = []
  let closed = false
  const socket: EdenServerSocket = {
    send(message) {
      if (typeof message !== 'string') return
      const value: unknown = JSON.parse(message)
      if (isRecord(value)) sent.push(value)
    },
    close() {
      closed = true
      events.dispatchEvent(new Event('close'))
    },
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
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
