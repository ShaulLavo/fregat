import {
  orchestrationWsServerMessageSchema,
  type OrchestrationWsClientMessage,
  type OrchestrationWsServerMessage,
} from '@workspace/contracts'
import { isRecord } from '@workspace/utils/objects'
import * as v from 'valibot'
import { expect } from 'vitest'
import type { App } from '../src/app'

export function createInProcessOrchestrationSocket(app: App, origin?: string) {
  const hooks: unknown = app.routes.find((route) => route.path === '/orchestration/rpc')?.hooks
  if (!isRecord(hooks) || typeof hooks.open !== 'function' || typeof hooks.message !== 'function') {
    return expect.unreachable('missing orchestration WS hooks')
  }

  const messages: OrchestrationWsServerMessage[] = []
  const closes: { code?: number; reason?: string }[] = []
  const socket = {
    raw: {},
    data: { headers: { origin } },
    send(message: string) {
      messages.push(v.parse(orchestrationWsServerMessageSchema, JSON.parse(message)))
    },
    close(code?: number, reason?: string) {
      closes.push({ code, reason })
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
  }
}
