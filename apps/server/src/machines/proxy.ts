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

// Registered per method, not with `.all()`: Elysia resolves a method's own routes
// before ALL routes, so a GET (and every WS upgrade) would otherwise land in the
// web bundle's `GET /*` catch-all and 404 in production.
const PROXY_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const

export function createMachineProxyRoutes({ auth, resolve, fetcher = fetch }: MachineProxyOptions) {
  const routes = new Elysia({ name: 'machine-proxy' }).onBeforeHandle(authGuard(auth))
  const handler = async ({ request, params, server }: MachineProxyContext) => {
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
  }
  for (const method of PROXY_METHODS) {
    routes.route(method, '/machines/:name/proxy/*', handler, { parse: 'none' })
  }
  return routes
}

type MachineProxyContext = {
  readonly request: Request
  readonly params: { readonly name: string; readonly '*': string }
  readonly server: { upgrade(request: Request, options: { data: unknown }): boolean } | null
}
