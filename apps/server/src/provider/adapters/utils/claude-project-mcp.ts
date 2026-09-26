import { createHash } from 'node:crypto'
import { mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { isRecord } from '@workspace/utils/objects'
import { platformHomePath } from '../../../home'

/**
 * A checkout's `.mcp.json` servers run commands the repository chose, and the Claude CLI loads
 * `.mcp.json` from the session folder and every folder above it. An SDK session starts them without
 * the approval the CLI asks for, so each one this server has not approved is turned off at CLI start
 * (`disabledMcpjsonServers`). An approval names the server's exact definition: a pull that changes
 * its command, arguments or environment needs a new one. Approvals live in the Platform state home,
 * where no repository can put one.
 */
export function defaultProjectMcpApprovalsPath() {
  return platformHomePath('claude-project-mcp-approvals.json')
}

type ProjectMcpServer = { readonly fingerprint: string; readonly name: string }
type Approvals = { readonly approved: Readonly<Record<string, string>> }

export async function unapprovedProjectMcpServers(input: { approvalsFile: string; cwd: string }) {
  const servers = await projectMcpServers(input.cwd)
  if (servers.length === 0) return []

  const approved = new Set(Object.keys((await readApprovals(input.approvalsFile)).approved))
  return servers
    .filter((server) => !approved.has(server.fingerprint))
    .map((server) => server.name)
    .sort()
}

/** Approves `name` as every `.mcp.json` above `cwd` defines it right now. */
export async function approveProjectMcpServer(input: {
  approvalsFile: string
  cwd: string
  name: string
}) {
  const server = (await projectMcpServers(input.cwd)).find((entry) => entry.name === input.name)
  if (!server) return false

  const approvals = await readApprovals(input.approvalsFile)
  const next: Approvals = {
    approved: { ...approvals.approved, [server.fingerprint]: server.name },
  }
  await mkdir(path.dirname(input.approvalsFile), { recursive: true })
  const staging = `${input.approvalsFile}.${process.pid}.tmp`
  await writeFile(staging, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 })
  await rename(staging, input.approvalsFile)
  return true
}

/** Every server the CLI would load, fingerprinted by each file that defines it and how. */
async function projectMcpServers(cwd: string): Promise<ProjectMcpServer[]> {
  const definitions = new Map<string, Array<[string, unknown]>>()
  for (const file of await mcpConfigFiles(cwd)) {
    const servers = (await readJson(file))?.mcpServers
    if (!isRecord(servers)) continue
    for (const [name, definition] of Object.entries(servers)) {
      const entries = definitions.get(name) ?? []
      entries.push([file, definition])
      definitions.set(name, entries)
    }
  }
  return [...definitions].map(([name, entries]) => ({
    fingerprint: fingerprint(name, entries),
    name,
  }))
}

async function mcpConfigFiles(cwd: string) {
  const files: string[] = []
  let directory = await realpath(cwd).catch(() => path.resolve(cwd))
  for (;;) {
    const file = path.join(directory, '.mcp.json')
    const resolved = await realpath(file).catch(() => null)
    if (resolved) files.push(resolved)
    const parent = path.dirname(directory)
    if (parent === directory) return files
    directory = parent
  }
}

function fingerprint(name: string, entries: ReadonlyArray<[string, unknown]>) {
  return createHash('sha256')
    .update(stableJson([name, entries]))
    .digest('hex')
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (!isRecord(value)) return JSON.stringify(value) ?? 'null'
  const keys = Object.keys(value).sort()
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
}

async function readApprovals(file: string): Promise<Approvals> {
  const approved = (await readJson(file))?.approved
  if (!isRecord(approved)) return { approved: {} }

  return {
    approved: Object.fromEntries(
      Object.entries(approved).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    ),
  }
}

async function readJson(file: string): Promise<Record<string, unknown> | null> {
  const text = await readFile(file, 'utf8').catch(() => null)
  if (text === null) return null
  try {
    const value: unknown = JSON.parse(text)
    return isRecord(value) ? value : null
  } catch {
    return null
  }
}
