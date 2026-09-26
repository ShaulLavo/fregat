import type { ProviderMcpServer } from '@workspace/contracts'

/** One MCP server row as a provider reports it; a stdio server with no tools by default. */
export function mcpServer(
  input: Pick<ProviderMcpServer, 'name' | 'status'> & Partial<ProviderMcpServer>,
): ProviderMcpServer {
  return {
    auth: 'unsupported',
    error: null,
    origin: null,
    source: 'user',
    tools: [],
    transport: 'stdio',
    ...input,
  }
}
