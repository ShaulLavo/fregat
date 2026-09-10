import { Elysia } from 'elysia'
import { websocket } from 'elysia/ws'
import { expect } from 'vitest'

import { createMachineProxyRoutes } from '../src/machines/proxy'

export function machineProxyAdapter(options: Parameters<typeof createMachineProxyRoutes>[0]) {
  const upgrades: { request: Request; data: unknown }[] = []
  const app = new Elysia({ prefix: '/platform-api' })
    .ws('/existing-socket', {})
    .use(createMachineProxyRoutes(options))
  Object.defineProperty(app, 'server', {
    value: {
      upgrade(request: Request, { data }: { data: unknown }) {
        upgrades.push({ request, data })
        return true
      },
    },
  })
  return { app, upgrades }
}

export function dispatchMachineProxySocket(
  event: 'open' | 'message' | 'close',
  socket: object,
  ...args: readonly unknown[]
) {
  const dispatch = websocket[event]
  if (!dispatch) return expect.unreachable(`Missing Elysia ${event} WebSocket dispatch`)
  return Reflect.apply(dispatch, websocket, [socket, ...args])
}
