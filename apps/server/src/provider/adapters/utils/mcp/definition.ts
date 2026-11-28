import type { ProviderMcpDefinition } from '@workspace/contracts'
import { isRecord } from '@workspace/utils/objects'

/**
 * A stored server table as one definition: `url` (with Claude's `headers` or Codex's
 * `http_headers`) or `command` with `args` and `env`. Null when it is neither.
 */
export function mcpDefinitionFrom(
  table: unknown,
  headersKey: 'headers' | 'http_headers',
): ProviderMcpDefinition | null {
  if (!isRecord(table)) return null
  if (typeof table.url === 'string')
    return { transport: 'http', url: table.url, headers: stringMap(table[headersKey]) }
  if (typeof table.command !== 'string') return null

  const args = Array.isArray(table.args)
    ? table.args.filter((arg): arg is string => typeof arg === 'string')
    : []
  return { transport: 'stdio', command: table.command, args, env: stringMap(table.env) }
}

function stringMap(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {}

  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  )
}
