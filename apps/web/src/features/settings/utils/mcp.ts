import type {
  ProviderMcpConfigServer,
  ProviderMcpScope,
  ProviderSnapshot,
} from '@workspace/contracts'

import { mcpSourceLabel } from '@/lib/mcp-status'

export const MCP_CATEGORY = 'MCP servers'

export function matchesMcpSearch(query: string) {
  const words = 'mcp model context protocol servers tools connectors claude codex'
  return query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .every((word) => words.includes(word))
}

/** The instances whose harness keeps MCP server definitions. */
export function mcpInstances(providers: readonly ProviderSnapshot[]) {
  return providers.filter(
    (provider) =>
      provider.enabled && (provider.driverKind === 'claude' || provider.driverKind === 'codex'),
  )
}

const SCOPE_LABELS: Record<ProviderMcpScope, string> = {
  user: 'User: every folder',
  local: 'Local: this folder, only you',
  project: 'Project: this folder’s .mcp.json',
}

const SCOPE_PLACES: Record<ProviderMcpScope, string> = {
  user: 'user config',
  local: 'local config for this folder',
  project: '.mcp.json in this folder',
}

export function mcpScopeLabel(scope: ProviderMcpScope) {
  return SCOPE_LABELS[scope]
}

export function mcpScopePlace(scope: ProviderMcpScope) {
  return SCOPE_PLACES[scope]
}

/** Rows grouped by where their definition lives, in the order the harness reported them. */
export function groupMcpServers(servers: readonly ProviderMcpConfigServer[]) {
  const groups = new Map<string, ProviderMcpConfigServer[]>()
  for (const server of servers) {
    const label = mcpSourceLabel(server.source) ?? 'Other'
    groups.set(label, (groups.get(label) ?? []).concat([server]))
  }
  return [...groups]
}

/**
 * Splits an argument line the way a shell would for plain words and quoted strings; no
 * expansion, so `$HOME` stays literal.
 */
export function parseMcpArgs(line: string) {
  const args: string[] = []
  for (const match of line.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)) {
    args.push(match[1] ?? match[2] ?? match[3] ?? '')
  }
  return args
}

export type McpPair = { readonly key: string; readonly value: string }

/** Rows with a blank key are dropped; a later row wins over an earlier one with the same key. */
export function mcpPairsRecord(pairs: readonly McpPair[]) {
  return Object.fromEntries(
    pairs.filter((pair) => pair.key.trim()).map((pair) => [pair.key.trim(), pair.value]),
  )
}
