import { readFile, stat } from 'node:fs/promises'

import { McpServer } from '@modelcontextprotocol/server'
import * as v from 'valibot'

import { resolveGrantPath } from './boundary'
import type { McpGrant } from './grants'
import { toolInput } from './input-schema'

/** More than an agent reads at once; a bigger file is read by range. */
const READ_LIMIT_BYTES = 512 * 1024

const readFileInput = toolInput(
  v.object({
    path: v.pipe(v.string(), v.minLength(1)),
    startLine: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1))),
    endLine: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1))),
  }),
  {
    type: 'object',
    additionalProperties: false,
    required: ['path'],
    properties: {
      path: { type: 'string', description: 'Relative to the checkout, or absolute inside it.' },
      startLine: { type: 'integer', minimum: 1 },
      endLine: { type: 'integer', minimum: 1 },
    },
  },
)

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
  server.registerTool(
    'read_file',
    {
      description: "Reads a text file in this session's checkout, whole or by line range.",
      inputSchema: readFileInput,
      annotations: { readOnlyHint: true },
    },
    async (input) => {
      const text = await readInside(grant, input)
      return { content: [{ type: 'text', text }] }
    },
  )
  return server
}

async function readInside(
  grant: McpGrant,
  input: { path: string; startLine?: number; endLine?: number },
) {
  const target = await resolveGrantPath(grant, input.path)
  const info = await stat(target.absolutePath)
  if (!info.isFile()) return `${target.relativePath} is not a file.`
  if (info.size > READ_LIMIT_BYTES && input.startLine === undefined)
    return `${target.relativePath} is ${info.size} bytes; read it by line range.`
  const lines = (await readFile(target.absolutePath, 'utf8')).split('\n')
  const start = (input.startLine ?? 1) - 1
  const end = input.endLine ?? lines.length
  return lines.slice(start, end).join('\n')
}
