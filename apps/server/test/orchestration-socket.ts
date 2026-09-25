import {
  orchestrationWsServerMessageSchema,
  type OrchestrationWsClientMessage,
  type OrchestrationWsServerMessage,
} from '@workspace/contracts'
import { isRecord } from '@workspace/utils/objects'
import * as v from 'valibot'
import { expect } from 'vitest'
import type { App } from '../src/app'

export function createInProcessOrchestrationSocket(
  app: App,
  origin?: string,
  query: Record<string, string> = {},
) {
  const hooks: unknown = app.routes.find((route) => route.path === '/orchestration/rpc')?.hooks
  if (
    !isRecord(hooks) ||
    typeof hooks.open !== 'function' ||
    typeof hooks.message !== 'function' ||
    typeof hooks.close !== 'function'
  ) {
    return expect.unreachable('missing orchestration WS hooks')
  }

  const messages: OrchestrationWsServerMessage[] = []
  const closes: { code?: number; reason?: string }[] = []
  const onClose = hooks.close
  let closed = false
  const socket = {
    raw: {},
    data: { headers: { origin }, query },
    send(message: string) {
      messages.push(v.parse(orchestrationWsServerMessageSchema, JSON.parse(message)))
    },
    // Bun runs the close hook inside close(), and reports a bare close() as 1000.
    close(code?: number, reason?: string) {
      if (closed) return
      closed = true
      closes.push({ code, reason })
      Reflect.apply(onClose, undefined, [socket, code ?? 1000, reason ?? ''])
    },
  }
  const onMessage = hooks.message
  Reflect.apply(hooks.open, undefined, [socket])

  return {
    messages,
    closes,
    receive(message: OrchestrationWsClientMessage) {
      Reflect.apply(onMessage, undefined, [socket, message])
    },
    /** The client going away. */
    close: () => socket.close(1000, ''),
  }
}
