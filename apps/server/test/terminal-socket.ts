import {
  isRecord,
  parseTerminalServerMessage,
  type TerminalOpenInput,
  type TerminalServerMessage,
} from '@workspace/contracts'
import { expect } from 'vitest'
import type { App } from '../src/app'

export function createInProcessTerminalSocket(app: App, input: TerminalOpenInput, origin: string) {
  const hooks: unknown = app.routes.find((route) => route.path === '/terminal')?.hooks
  if (
    !isRecord(hooks) ||
    typeof hooks.open !== 'function' ||
    typeof hooks.message !== 'function' ||
    typeof hooks.close !== 'function'
  )
    return expect.unreachable('Missing terminal WebSocket hooks')
  const messages: TerminalServerMessage[] = []
  const closes: { code?: number; reason?: string }[] = []
  const socket = {
    raw: {},
    data: {
      headers: { origin },
      query: Object.fromEntries(Object.entries(input).map(([key, value]) => [key, String(value)])),
    },
    send(raw: string | Uint8Array) {
      const message = parseTerminalServerMessage(raw)
      if (!message) return expect.unreachable('Invalid terminal frame')
      messages.push(message)
    },
    close(code?: number, reason?: string) {
      closes.push({ code, reason })
    },
  }
  const onOpen = hooks.open
  const onMessage = hooks.message
  const onClose = hooks.close
  return {
    messages,
    closes,
    open: () => Promise.resolve(Reflect.apply(onOpen, undefined, [socket])),
    receive: (message: string | Uint8Array) =>
      Reflect.apply(onMessage, undefined, [socket, message]),
    detach: () => Reflect.apply(onClose, undefined, [socket]),
  }
}
