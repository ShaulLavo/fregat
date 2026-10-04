import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client'
import { Elysia } from 'elysia'

import { McpGrantRegistry } from '../mcp/grants'
import { mcpRoutes } from '../mcp/routes'

export function withGrantedMcpClient<Result>(
  cwd: string,
  run: (client: Client) => Promise<Result>,
) {
  const endpoint = 'http://127.0.0.1:39087/mcp'
  const grants = new McpGrantRegistry()
  const token = grants.issue({ cwd, runtimeEpoch: 'test', sessionId: 'input-contract' })
  const app = new Elysia().use(mcpRoutes({ allowedOrigins: [], endpoint, grants }))
  return withMcpClient(app, endpoint, token, run)
}

export async function withMcpClient<Result>(
  app: { handle(request: Request): Promise<Response> },
  endpoint: string,
  token: string,
  run: (client: Client) => Promise<Result>,
) {
  const client = new Client(
    { name: 'platform-test', version: '0' },
    { versionNegotiation: { mode: { pin: '2026-07-28' } } },
  )
  const fetch = (url: string | URL | Request, init?: RequestInit) =>
    app.handle(
      new Request(url, {
        ...init,
        headers: {
          ...Object.fromEntries(new Headers(init?.headers)),
          authorization: `Bearer ${token}`,
        },
      }),
    )
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(endpoint), { fetch }))
    return await run(client)
  } finally {
    await client.close()
  }
}
