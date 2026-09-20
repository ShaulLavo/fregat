import { orchestrationWsClientMessageSchema } from '@workspace/contracts'
import { isRecord } from '@workspace/utils/objects'
import type { createApp } from 'server/testing'
import * as v from 'valibot'
import { createClientError } from '../src/errors'
import { FakeOrchestrationSocket } from './orchestration-socket'

type InProcessServer = {
  readonly app: ReturnType<typeof createApp>
  readonly clientOrigin: string
}

export function inProcessOrchestrationSocketFactory(server: InProcessServer) {
  return (_url: string) => {
    const { onOpen, onMessage, onClose } = orchestrationSocketHooks(server.app)
    const socket = new FakeOrchestrationSocket()
    const peer = {
      raw: {},
      data: { headers: { origin: server.clientOrigin } },
      send: (message: string) => socket.deliver(JSON.parse(message)),
      close: (code = 1000) => socket.serverClose({ code, wasClean: true }),
    }
    const close = socket.close.bind(socket)
    socket.close = () => {
      if (socket.closed) return
      Reflect.apply(onClose, undefined, [peer])
      close()
    }
    const serverClose = socket.serverClose.bind(socket)
    socket.serverClose = (event) => {
      if (socket.closed) return
      socket.close()
      serverClose(event)
    }
    socket.send = (raw: string) => {
      const message = v.parse(orchestrationWsClientMessageSchema, JSON.parse(raw))
      Reflect.apply(onMessage, undefined, [peer, message])
    }
    setTimeout(() => {
      if (socket.closed) return
      socket.open(false)
      Reflect.apply(onOpen, undefined, [peer])
    }, 0)
    return socket
  }
}

function orchestrationSocketHooks(app: InProcessServer['app']) {
  const hooks: unknown = app.routes.find((route) => route.path === '/orchestration/rpc')?.hooks
  if (
    !isRecord(hooks) ||
    typeof hooks.open !== 'function' ||
    typeof hooks.message !== 'function' ||
    typeof hooks.close !== 'function'
  ) {
    throw createClientError({
      code: 'TEST_ORCHESTRATION_HANDLERS_MISSING',
      message: 'The real server must expose orchestration WebSocket handlers.',
      status: 500,
      why: 'The in-process socket fixture needs the real route lifecycle handlers.',
      fix: 'Create the test server with the orchestration routes enabled.',
    })
  }
  return { onOpen: hooks.open, onMessage: hooks.message, onClose: hooks.close }
}
