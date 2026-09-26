import type { McpServerStatus } from '@anthropic-ai/claude-agent-sdk'
import type { ProviderMcpServer, ProviderMcpTransport } from '@workspace/contracts'

/** Claude's status row, reduced to what the web may see: no command, headers or environment. */
export function claudeMcpServer(server: McpServerStatus, unapproved: boolean): ProviderMcpServer {
  const transport = claudeMcpTransport(server.config)
  return {
    auth: claudeMcpAuth(server.status, transport),
    error: server.error ?? null,
    name: server.name,
    origin: claudeMcpOrigin(server.config),
    source: server.source ?? server.scope ?? null,
    status: unapproved ? 'unapproved' : server.status,
    tools: server.tools?.map((tool) => tool.name) ?? [],
    transport,
  }
}

/** A project server the trust gate kept off: the CLI never saw it, so only the name is known. */
export function gatedProjectMcpServer(name: string): ProviderMcpServer {
  return {
    auth: 'unknown',
    error: null,
    name,
    origin: null,
    source: 'project',
    status: 'unapproved',
    tools: [],
    transport: null,
  }
}

/** A server this session runs without reads as off, whatever the CLI calls the way it was kept off. */
export function sessionOffServer(
  server: ProviderMcpServer,
  off: readonly string[],
): ProviderMcpServer {
  if (!off.includes(server.name) || server.status === 'unapproved') return server

  return { ...server, error: null, status: 'disabled' }
}

/** An off server the CLI no longer lists: only its name is known. */
export function sessionOffPlaceholder(name: string): ProviderMcpServer {
  return {
    auth: 'unknown',
    error: null,
    name,
    origin: null,
    source: null,
    status: 'disabled',
    tools: [],
    transport: null,
  }
}

function claudeMcpTransport(config: McpServerStatus['config']): ProviderMcpTransport | null {
  if (!config) return null
  if (config.type === 'claudeai-proxy') return 'http'
  if (config.type === 'http' || config.type === 'sse' || config.type === 'sdk') return config.type

  return 'command' in config ? 'stdio' : null
}

function claudeMcpOrigin(config: McpServerStatus['config']) {
  if (!config || !('url' in config)) return null

  return urlOrigin(config.url)
}

// Claude reports sign-in only as the `needs-auth` status; a connected HTTP server may or may not use OAuth.
function claudeMcpAuth(status: McpServerStatus['status'], transport: ProviderMcpTransport | null) {
  if (status === 'needs-auth') return 'signed-out'
  if (transport === 'stdio' || transport === 'sdk') return 'unsupported'

  return 'unknown'
}

export function urlOrigin(url: string) {
  if (!URL.canParse(url)) return null

  const origin = new URL(url).origin
  return origin === 'null' ? null : origin
}

/**
 * Remembers each server's last status so a Claude session reports a server once when it moves
 * into `failed` or `needs-auth`, the way Codex's startup-status stream does.
 */
export class ClaudeMcpStatusWatch {
  private readonly last = new Map<string, ProviderMcpServer['status']>()

  /** The servers that newly need attention since the previous reading. */
  changed(servers: readonly ProviderMcpServer[]) {
    const alerts: ProviderMcpServer[] = []
    for (const server of servers) {
      const previous = this.last.get(server.name)
      this.last.set(server.name, server.status)
      if (previous === server.status) continue
      if (server.status !== 'failed' && server.status !== 'needs-auth') continue

      alerts.push(server)
    }
    return alerts
  }
}
