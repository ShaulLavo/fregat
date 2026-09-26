import type { FileHandle } from 'node:fs/promises'
import { FsError } from '../fs/errors'

import { McpServer } from '@modelcontextprotocol/server'
import * as v from 'valibot'

import { openGrantFile } from './boundary'
import { platformReadTools } from './tool-names'
import type { McpGrant } from './grants'
import { toolInput } from './input-schema'

/** A hard bound on both scanned file bytes and returned text, including line-range reads. */
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
    platformReadTools.workspaceInfo,
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
    platformReadTools.readFile,
    {
      description:
        "Reads a text file up to 512 KiB in this session's checkout, whole or by line range.",
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
  const file = await openGrantFile(grant, input.path)
  try {
    const info = await file.stat()
    if (!info.isFile()) throw new FsError('NOT_A_FILE')
    if (info.size > READ_LIMIT_BYTES) throw new FsError('FILE_TOO_LARGE')
    return await readLines(file, input.startLine ?? 1, input.endLine ?? Infinity)
  } finally {
    await file.close()
  }
}

type LineSelection = { line: number; parts: Buffer[]; start: number; end: number }

async function readLines(file: FileHandle, start: number, end: number) {
  if (end < start) return ''
  const selection: LineSelection = { line: 1, parts: [], start, end }
  let scanned = 0
  for (;;) {
    const buffer = Buffer.allocUnsafe(Math.min(16 * 1024, READ_LIMIT_BYTES - scanned + 1))
    const { bytesRead } = await file.read(buffer, 0, buffer.length, null)
    if (bytesRead === 0) break
    scanned += bytesRead
    // fstat is only a snapshot: a writer can grow the file after the size check.
    if (scanned > READ_LIMIT_BYTES) throw new FsError('FILE_TOO_LARGE')
    if (selectLines(buffer.subarray(0, bytesRead), selection)) break
  }
  const text = Buffer.concat(selection.parts).toString('utf8')
  if (Buffer.byteLength(text) > READ_LIMIT_BYTES) throw new FsError('FILE_TOO_LARGE')
  return text
}

function selectLines(chunk: Buffer, selection: LineSelection) {
  let offset = 0
  let start = selection.line >= selection.start ? 0 : -1
  for (let newline = chunk.indexOf(10); newline !== -1; newline = chunk.indexOf(10, offset)) {
    if (selection.line === selection.end) {
      if (start !== -1) selection.parts.push(chunk.subarray(start, newline))
      return true
    }
    selection.line += 1
    offset = newline + 1
    if (selection.line === selection.start) start = offset
  }
  if (start !== -1) selection.parts.push(chunk.subarray(start))
  return false
}
