import { Elysia } from 'elysia'

import { authGuard, type AuthConfig } from '../auth'
import { recordRequestContext } from '../observability'
import { createMachineProxyError } from './proxy-errors'
import {
  forwardMachineRequest,
  machineProxyHeaders,
  machineProxyTarget,
  type MachineProxyFetcher,
} from './proxy-http'
import { createMachineProxySocket } from './proxy-socket'

type MachineProxyTarget = {
  readonly origin: string
  readonly webOrigin: string
}

type MachineProxyOptions = {
  readonly auth: AuthConfig
  readonly resolve: (name: string) => MachineProxyTarget | Promise<MachineProxyTarget>
  readonly fetcher?: MachineProxyFetcher
}

export function createMachineProxyRoutes({ auth, resolve, fetcher = fetch }: MachineProxyOptions) {
  return new Elysia({ name: 'machine-proxy' }).onBeforeHandle(authGuard(auth)).all(
    '/machines/:name/proxy/*',
    async ({ request, params, server }) => {
      const machine = await resolve(params.name)
      const target = machineProxyTarget(machine.origin, request, params['*'])
      const headers = machineProxyHeaders(request, machine.webOrigin)
      const websocket = request.headers.get('upgrade')?.toLowerCase() === 'websocket'
      recordRequestContext({
        area: 'machines',
        machineName: params.name,
        operation: 'proxy',
        transport: websocket ? 'websocket' : 'http',
      })
      if (!websocket) return forwardMachineRequest(request, target, headers, fetcher)

      target.protocol = 'ws:'
      // Elysia's .ws() parses JSON before custom parsers. Raw Bun hooks preserve every frame.
      const data = createMachineProxySocket(target, headers, params.name)
      if (!server?.upgrade(request, { data })) throw createMachineProxyError()
    },
    { parse: 'none' },
  )
}
