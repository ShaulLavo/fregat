import { readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import type { McpServerStatus } from '@anthropic-ai/claude-agent-sdk'
import type {
  ProviderMcpConfigServer,
  ProviderMcpDefinition,
  ProviderMcpScope,
} from '@workspace/contracts'
import { isRecord } from '@workspace/utils/objects'

import { mcpConfigErrors } from '../../structured-errors'
import type { ProviderMcpConfigAccess } from '../../types'
import { claudeMcpServer, gatedProjectMcpServer } from './claude-mcp-status'
import {
  approveProjectMcpServer,
  projectMcpServers,
  unapprovedProjectMcpServers,
} from './claude-project-mcp'
import { startClaudeMcpSignIn, type ClaudeMcpLoginSpawn } from './claude-mcp-sign-in'
import { mcpDefinitionFrom } from './mcp-definition'

const CLI_TIMEOUT_MS = 30_000

const CLAUDE_MCP_SCOPES: readonly ProviderMcpScope[] = ['user', 'local', 'project']

type ClaudeMcpCliResult = { exitCode: number; stderr: string; stdout: string }

/** `claude mcp …` with the instance's environment; injected in tests so no real CLI runs. */
export type ClaudeMcpCli = (
  args: readonly string[],
  options: { cwd: string },
) => Promise<ClaudeMcpCliResult>

export function defaultClaudeMcpCli(
  executable: () => Promise<string>,
  env: NodeJS.ProcessEnv,
): ClaudeMcpCli {
  return async (args, options) => {
    const child = Bun.spawn([await executable(), ...args], {
      cwd: options.cwd,
      env,
      stderr: 'pipe',
      stdin: 'ignore',
      stdout: 'pipe',
    })
    const timer = setTimeout(() => child.kill(), CLI_TIMEOUT_MS)
    try {
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ])
      return { exitCode, stderr, stdout }
    } finally {
      clearTimeout(timer)
    }
  }
}

/** `.claude.json` holds user servers and, per project folder, local ones. */
function claudeGlobalConfigFile(env: NodeJS.ProcessEnv) {
  return path.join(env.CLAUDE_CONFIG_DIR || env.HOME || homedir(), '.claude.json')
}

/** Status rows for the settings page, each with the file it lives in and the scope Platform edits. */
async function claudeMcpConfigServers(input: {
  env: NodeJS.ProcessEnv
  folder: string
  statuses: readonly McpServerStatus[]
  unapproved: readonly string[]
}): Promise<ProviderMcpConfigServer[]> {
  const globalFile = claudeGlobalConfigFile(input.env)
  const projectFile = path.join(input.folder, '.mcp.json')
  const projectNames = new Set(Object.keys(await projectServers(input.folder)))
  const listed = new Set(input.statuses.map((status) => status.name))
  const rows = input.statuses.map((status) => {
    const server = claudeMcpServer(status, input.unapproved.includes(status.name))
    return {
      ...server,
      ...claudeRowLocation(server.source, status.name, globalFile, projectFile, projectNames),
    }
  })
  const gated = input.unapproved
    .filter((name) => !listed.has(name))
    .map((name) => ({
      ...gatedProjectMcpServer(name),
      ...claudeRowLocation('project', name, globalFile, projectFile, projectNames),
    }))
  return [...rows, ...gated]
}

function claudeRowLocation(
  source: string | null,
  name: string,
  globalFile: string,
  projectFile: string,
  projectNames: ReadonlySet<string>,
): Pick<ProviderMcpConfigServer, 'file' | 'scope'> {
  if (source === 'user' || source === 'local') return { file: globalFile, scope: source }
  if (source !== 'project') return { file: null, scope: null }
  // A `.mcp.json` above the folder defines it: named, but edited from its own project.
  if (!projectNames.has(name)) return { file: null, scope: null }

  return { file: projectFile, scope: 'project' }
}

/** The stored definition, secrets included; only a copy to another harness reads it. */
async function readClaudeMcpDefinition(input: {
  env: NodeJS.ProcessEnv
  folder: string
  name: string
  scope: ProviderMcpScope
}): Promise<ProviderMcpDefinition> {
  const servers = await scopeServers(input.env, input.scope, input.folder)
  const definition = servers[input.name]
  const parsed = mcpDefinitionFrom(definition, 'headers')
  if (parsed) return parsed

  throw mcpConfigErrors.MCP_SERVER_NOT_FOUND({
    internal: { name: input.name, scope: input.scope, defined: isRecord(definition) },
  })
}

async function claudeMcpNameTaken(input: {
  env: NodeJS.ProcessEnv
  folder: string
  name: string
  scope: ProviderMcpScope
}) {
  if (input.scope === 'project')
    return (await projectMcpServers(input.folder)).some((server) => server.name === input.name)

  return input.name in (await scopeServers(input.env, input.scope, input.folder))
}

async function scopeServers(env: NodeJS.ProcessEnv, scope: ProviderMcpScope, folder: string) {
  if (scope === 'project') return projectServers(folder)

  const config = await readJson(claudeGlobalConfigFile(env))
  if (scope === 'user') return recordField(config, 'mcpServers')

  const projects = recordField(config, 'projects')
  return recordField(projects[folder], 'mcpServers')
}

async function projectServers(folder: string) {
  return recordField(await readJson(path.join(folder, '.mcp.json')), 'mcpServers')
}

/** The JSON `claude mcp add-json` takes: the CLI's own `.mcp.json` shape. */
function claudeAddJson(definition: ProviderMcpDefinition) {
  if (definition.transport === 'http')
    return JSON.stringify({ type: 'http', url: definition.url, headers: definition.headers })

  return JSON.stringify({
    type: 'stdio',
    command: definition.command,
    args: definition.args,
    env: definition.env,
  })
}

/** Writes and removals go through `claude mcp`, in the folder a local or project server belongs to. */
async function runClaudeMcpWrite(cli: ClaudeMcpCli, args: readonly string[], folder: string) {
  const result = await cli(args, { cwd: folder })
  if (result.exitCode === 0) return

  throw mcpConfigErrors.MCP_WRITE_FAILED({
    internal: {
      command: args.slice(0, 2).join(' '),
      exitCode: result.exitCode,
      // Its stderr can echo the definition, secrets included, so only its size is kept.
      stderrBytes: result.stderr.length,
    },
  })
}

async function requireFolder(folder: string) {
  const info = await stat(folder).catch(() => null)
  if (info?.isDirectory()) return

  throw mcpConfigErrors.MCP_FOLDER_MISSING({ internal: { exists: info !== null } })
}

function recordField(value: unknown, key: string): Record<string, unknown> {
  if (!isRecord(value)) return {}

  const field = value[key]
  return isRecord(field) ? field : {}
}

async function readJson(file: string): Promise<unknown> {
  const text = await readFile(file, 'utf8').catch(() => null)
  if (text === null) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/** Claude's side of the settings page: a probe for status, `claude mcp` for every write. */
export function claudeMcpConfigAccess(input: {
  approvalsFile: string
  cli: ClaudeMcpCli
  env: NodeJS.ProcessEnv
  loginSpawn: ClaudeMcpLoginSpawn
  probe: (folder: string, unapproved: readonly string[]) => Promise<McpServerStatus[]>
}): ProviderMcpConfigAccess {
  const { approvalsFile, cli, env } = input
  return {
    scopes: CLAUDE_MCP_SCOPES,
    async list({ folder }) {
      const unapproved = await unapprovedProjectMcpServers({ approvalsFile, cwd: folder })
      const statuses = await input.probe(folder, unapproved).catch((error: unknown) => {
        throw mcpConfigErrors.MCP_PROBE_FAILED({
          cause: error instanceof Error ? error : undefined,
          internal: { provider: 'claude' },
        })
      })
      return claudeMcpConfigServers({ env, folder, statuses, unapproved })
    },
    async add({ definition, folder, name, scope }) {
      await requireFolder(folder)
      if (await claudeMcpNameTaken({ env, folder, name, scope }))
        throw mcpConfigErrors.MCP_NAME_TAKEN({ internal: { name, scope } })

      await runClaudeMcpWrite(
        cli,
        ['mcp', 'add-json', '-s', scope, name, claudeAddJson(definition)],
        folder,
      )
      // The owner wrote this project server here, so it needs no second approval.
      if (scope === 'project') await approveProjectMcpServer({ approvalsFile, cwd: folder, name })
    },
    async remove({ folder, name, scope }) {
      await requireFolder(folder)
      if (!(await claudeMcpNameTaken({ env, folder, name, scope })))
        throw mcpConfigErrors.MCP_SERVER_NOT_FOUND({ internal: { name, scope, defined: false } })

      await runClaudeMcpWrite(cli, ['mcp', 'remove', '-s', scope, name], folder)
    },
    async read({ folder, name, scope }) {
      if (
        scope === 'project' &&
        (await unapprovedProjectMcpServers({ approvalsFile, cwd: folder })).includes(name)
      )
        throw mcpConfigErrors.MCP_APPROVAL_REQUIRED({ internal: { name, scope } })

      return readClaudeMcpDefinition({ env, folder, name, scope })
    },
    signIn: ({ folder, name }) => startClaudeMcpSignIn(input.loginSpawn, { folder, name }),
  }
}
