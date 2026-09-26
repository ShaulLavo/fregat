import { createMcpHandler, type AuthInfo } from '@modelcontextprotocol/server'
import { Elysia } from 'elysia'

import type { McpGrant, McpGrantRegistry } from './grants'
import { platformMcpServer } from './tools'

export type McpEndpointOptions = {
  /** The loopback URL agents are given, e.g. `http://127.0.0.1:3301/mcp`. */
  readonly endpoint: string
  readonly grants: McpGrantRegistry
  /** Browser origins the rest of the app trusts; an agent sends none. */
  readonly allowedOrigins: readonly string[]
}

/**
 * Platform's own tools for provider agents, on MCP revision 2026-07-28 only. Mounted ahead of the
 * browser guard: agents send no Origin, and a bearer grant scopes every request by itself.
 */
export function mcpRoutes(options: McpEndpointOptions) {
  const hosts = allowedHosts(options.endpoint)
  const origins = new Set(options.allowedOrigins)
  const handler = createMcpHandler(
    (ctx) => platformMcpServer(grantOf(options.grants, ctx.authInfo)),
    { legacy: 'reject' },
  )
  const serve = (request: Request) => {
    const verdict = guard(request, hosts, origins, options.grants)
    if (verdict instanceof Response) return verdict
    return handler.fetch(request, { authInfo: verdict })
  }
  return new Elysia({ name: 'mcp-routes' })
    .post('/mcp', ({ request }) => serve(request), { parse: 'none' })
    .get('/mcp', ({ request }) => serve(request))
    .delete('/mcp', ({ request }) => serve(request))
    .onStop(() => handler.close())
}

function guard(
  request: Request,
  hosts: ReadonlySet<string>,
  origins: ReadonlySet<string>,
  grants: McpGrantRegistry,
): Response | AuthInfo {
  // The mesh keeps the inbound Host, so a tailnet request never matches a loopback one.
  const host = request.headers.get('host') ?? new URL(request.url).host
  if (!hosts.has(host)) return new Response(null, { status: 421 })
  const origin = request.headers.get('origin')
  if (origin !== null && !origins.has(origin)) return new Response(null, { status: 403 })
  const header = request.headers.get('authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : ''
  const grant = token ? grants.resolve(token) : null
  if (!grant)
    return new Response(null, {
      status: 401,
      headers: { 'www-authenticate': 'Bearer realm="platform"' },
    })
  return { token, clientId: grant.sessionId, scopes: [] }
}

// A grant revoked between the guard and the factory leaves a server with no tools.
function grantOf(grants: McpGrantRegistry, authInfo: AuthInfo | undefined): McpGrant | null {
  return authInfo ? grants.resolve(authInfo.token) : null
}

function allowedHosts(endpoint: string) {
  const url = new URL(endpoint)
  return new Set([url.host, `localhost:${url.port}`, `127.0.0.1:${url.port}`, `[::1]:${url.port}`])
}
