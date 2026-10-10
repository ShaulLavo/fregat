import { Elysia } from 'elysia'

import { authGuard, type AuthConfig } from '../auth'
import { requestHeaderReader } from '../devices/trust'
import { recordRequestContext } from '../observability'
import { createMachineProxyError } from './proxy-errors'
import {
  forwardMachineRequest,
  isUnpairedResponse,
  machineProxyHeaders,
  machineProxyTarget,
  type MachineProxyFetcher,
} from './proxy-http'
import { createMachineProxySocket } from './proxy-socket'

export type MachineProxyTarget = {
  readonly origin: string
  readonly webOrigin: string
  readonly cookie: string
  readonly refresh?: () => Promise<MachineProxyTarget>
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
    let machine = await resolve(params.name)
    const target = machineProxyTarget(machine.origin, request, params['*'])
    let headers = machineProxyHeaders(request, machine.webOrigin, machine.cookie)
    const websocket = request.headers.get('upgrade')?.toLowerCase() === 'websocket'
    recordRequestContext({
      area: 'machines',
      machineName: params.name,
      operation: 'proxy',
      transport: websocket ? 'websocket' : 'http',
    })
    const renew = machine.refresh
    const refresh = renew
      ? async () => {
          machine = await renew()
          return machineProxyHeaders(request, machine.webOrigin, machine.cookie)
        }
      : undefined
    if (!websocket) return forwardMachineRequest(request, target, headers, fetcher, refresh)
    if (refresh) {
      // Check admission before a WebSocket upgrade, whose rejection body Bun does not expose.
      const admission = await fetcher(new URL('/system/capabilities', machine.origin), {
        headers,
        redirect: 'error',
        signal: request.signal,
      })
      if (await isUnpairedResponse(admission)) headers = await refresh()
      await admission.body?.cancel()
    }

    target.protocol = 'ws:'
    // Elysia's .ws() parses JSON before custom parsers. Raw Bun hooks preserve every frame.
    const data = createMachineProxySocket(target, headers, params.name, (close) =>
      auth.devices ? auth.devices.hold(requestHeaderReader(request), close) : noop,
    )
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

function noop() {}
