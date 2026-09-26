import { McpServer } from '@modelcontextprotocol/server'

import type { McpGrant } from './grants'

/** One server per request: the grant is the whole of its state, and nothing outlives the call. */
export function platformMcpServer(grant: McpGrant | null) {
  const server = new McpServer({ name: 'platform', version: '1.0.0' })
  if (!grant) return server
  server.registerTool(
    'workspace_info',
    {
      description: 'The Platform session and checkout this agent works in.',
      annotations: { readOnlyHint: true },
    },
    async () => {
      const info = { cwd: grant.cwd, sessionId: grant.sessionId }
      return { content: [{ type: 'text', text: JSON.stringify(info) }], structuredContent: info }
    },
  )
  return server
}
