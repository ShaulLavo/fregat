import path from 'node:path'
import type {
  ProviderMcpConfigServer,
  ProviderMcpDefinition,
  ProviderMcpScope,
} from '@workspace/contracts'
import { isRecord } from '@workspace/utils/objects'

import { mcpConfigErrors } from '../../structured-errors'
import type {
  CodexConfigLayer,
  CodexConfigLayerSource,
  CodexConfigReadResponse,
  CodexMcpServerStatus,
} from '../codex-protocol'
import { codexMcpDefinitions, codexMcpServer, originFor } from './codex-mcp-status'
import { mcpDefinitionFrom } from './mcp-definition'

/** Codex writes `config.toml` in the user's Codex home; a project's `.codex` needs a trusted project. */
export const CODEX_MCP_SCOPES: readonly ProviderMcpScope[] = ['user']

export function codexMcpConfigServers(
  statuses: readonly CodexMcpServerStatus[],
  config: CodexConfigReadResponse,
): ProviderMcpConfigServer[] {
  const definitions = codexMcpDefinitions(config)
  const userServers = new Set(Object.keys(layerServers(userLayer(config))))
  return statuses.map((status) => {
    const server = codexMcpServer(status, definitions.get(status.name))
    const origin = originFor(config.origins, status.name)
    return {
      ...server,
      file: origin ? layerFile(origin.name) : null,
      scope: userServers.has(status.name) ? 'user' : null,
    }
  })
}

export function userLayer(config: CodexConfigReadResponse) {
  return config.layers?.find((layer) => layer.name.type === 'user') ?? null
}

export function layerServers(layer: CodexConfigLayer | null): Record<string, unknown> {
  if (!layer || !isRecord(layer.config)) return {}

  const servers = layer.config.mcp_servers
  return isRecord(servers) ? servers : {}
}

function layerFile(layer: CodexConfigLayerSource) {
  if (layer.type === 'project') return path.join(layer.dotCodexFolder, 'config.toml')
  if ('file' in layer && typeof layer.file === 'string') return layer.file

  return null
}

/** Codex's `[mcp_servers.<name>]` table for a definition typed in the dialog. */
export function codexMcpTable(definition: ProviderMcpDefinition) {
  if (definition.transport === 'http')
    return { url: definition.url, http_headers: definition.headers }

  return { command: definition.command, args: definition.args, env: definition.env }
}

/** The user layer's table as a definition, secrets included; only a copy reads it. */
export function codexMcpDefinition(
  config: CodexConfigReadResponse,
  name: string,
): ProviderMcpDefinition {
  const table = layerServers(userLayer(config))[name]
  const definition = mcpDefinitionFrom(table, 'http_headers')
  if (definition) return definition

  throw mcpConfigErrors.MCP_SERVER_NOT_FOUND({
    internal: { name, scope: 'user', defined: isRecord(table) },
  })
}

export function requireCodexScope(scope: ProviderMcpScope) {
  if (CODEX_MCP_SCOPES.includes(scope)) return

  throw mcpConfigErrors.MCP_SCOPE_UNSUPPORTED({ internal: { provider: 'codex', scope } })
}

/** `config/batchWrite` refuses a stale `expectedVersion` with this message. */
export function isCodexConfigConflict(error: unknown) {
  return error instanceof Error && error.message.includes('modified since last read')
}
