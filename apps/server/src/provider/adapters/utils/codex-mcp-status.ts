import type { ProviderMcpServer, ProviderMcpTransport } from '@workspace/contracts'
import { isRecord } from '@workspace/utils/objects'

import type {
  CodexConfigLayerSource,
  CodexConfigReadResponse,
  CodexMcpServerStatus,
} from '../codex-protocol'
import { urlOrigin } from './claude-mcp-status'

/** What `config/read` says about one server: the layer it came from and its transport. */
export type CodexMcpDefinition = {
  readonly source: string | null
  readonly transport: ProviderMcpTransport | null
}

export function codexMcpServer(
  server: CodexMcpServerStatus,
  definition: CodexMcpDefinition | undefined,
): ProviderMcpServer {
  const transport = definition?.transport ?? (server.httpOrigin ? 'http' : null)
  return {
    auth: codexMcpAuth(server.authStatus),
    error: server.toolsError ?? null,
    name: server.name,
    origin: server.httpOrigin ? urlOrigin(server.httpOrigin) : null,
    source: server.pluginId ? 'plugin' : (definition?.source ?? null),
    status: codexMcpStatus(server),
    tools: Object.values(server.tools).map((tool) => tool.name),
    transport,
  }
}

function codexMcpStatus(server: CodexMcpServerStatus): ProviderMcpServer['status'] {
  const runtime = server.runtimeStatus
  if (runtime === 'connected') return 'connected'
  if (runtime === 'disabled') return 'disabled'
  if (runtime === 'failed' || runtime === 'cancelled') return 'failed'
  if (runtime === 'authenticationRequired' || server.authStatus === 'notLoggedIn')
    return 'needs-auth'

  return 'pending'
}

function codexMcpAuth(status: CodexMcpServerStatus['authStatus']): ProviderMcpServer['auth'] {
  if (status === 'unsupported') return 'unsupported'
  if (status === 'notLoggedIn') return 'signed-out'
  if (status === 'bearerToken' || status === 'oAuth') return 'signed-in'

  return 'unknown'
}

/** Each configured server's layer and transport, keyed by name. */
export function codexMcpDefinitions(config: CodexConfigReadResponse) {
  const definitions = new Map<string, CodexMcpDefinition>()
  const servers = (config.config as Record<string, unknown>).mcp_servers
  if (!isRecord(servers)) return definitions

  for (const [name, value] of Object.entries(servers)) {
    if (!isRecord(value)) continue

    const origin = originFor(config.origins, name)
    definitions.set(name, {
      source: origin ? codexLayerSource(origin.name) : null,
      transport: definitionTransport(value),
    })
  }
  return definitions
}

function definitionTransport(definition: Record<string, unknown>): ProviderMcpTransport | null {
  if ('url' in definition) return 'http'
  if ('command' in definition) return 'stdio'

  return null
}

export function originFor(origins: CodexConfigReadResponse['origins'], name: string) {
  const prefix = `mcp_servers.${name}.`
  for (const [key, origin] of Object.entries(origins)) {
    if (key.startsWith(prefix)) return origin
  }
  return undefined
}

/** Codex's layer kinds, named the way Claude names its scopes where they mean the same thing. */
function codexLayerSource(layer: CodexConfigLayerSource) {
  if (layer.type === 'user' || layer.type === 'project' || layer.type === 'system')
    return layer.type
  if (layer.type === 'sessionFlags') return 'session'
  if (layer.type === 'packagedDefaults') return 'default'

  return 'managed'
}
