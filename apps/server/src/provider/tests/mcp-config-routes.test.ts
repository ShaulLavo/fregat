import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { McpServerStatus, Options, Query } from '@anthropic-ai/claude-agent-sdk'
import type { ProviderInstanceMcp } from '@workspace/contracts'
import { isRecord } from '@workspace/utils/objects'
import type { App } from '../../app'
import { closeTestApps, createTestApp } from '../../../test/server'
import { resolveFakeClaudeExecutable } from '../../../test/factories/claude-models'
import { signedInClaudeAuth } from '../../../test/factories/fake-claude-query'
import { ClaudeProviderAdapter, type ClaudeCreateQuery } from '../adapters/claude'
import { MockProviderAdapter } from '../adapters/mock'
import type { ClaudeMcpCli } from '../adapters/utils/claude-mcp-config'
import { ProviderAdapterRegistry } from '../provider-adapter-registry'
import { testSettingsOptions } from '../../settings/testing'

const TRUSTED_ORIGIN = 'http://localhost:5173'
const roots: string[] = []

afterEach(async () => {
  await closeTestApps()
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

type CliCall = { args: string[]; cwd: string }

async function readJson(file: string): Promise<Record<string, unknown>> {
  const text = await readFile(file, 'utf8').catch(() => '{}')
  const value: unknown = JSON.parse(text)
  return isRecord(value) ? value : {}
}

function servers(config: Record<string, unknown>, ...keys: string[]): Record<string, unknown> {
  let value: unknown = config
  for (const key of keys) value = isRecord(value) ? value[key] : undefined
  return isRecord(value) ? value : {}
}

/** `claude mcp add-json|remove`, faked over the same files the real CLI edits. */
function fakeMcpCli(configDir: string, calls: CliCall[]): ClaudeMcpCli {
  return async (args, { cwd }) => {
    calls.push({ args: [...args], cwd })
    const [, verb, , scope, name, json] = args
    if (!name) return { exitCode: 1, stderr: 'missing name', stdout: '' }
    const file =
      scope === 'project' ? path.join(cwd, '.mcp.json') : path.join(configDir, '.claude.json')
    const config = await readJson(file)
    const keys = scope === 'local' ? ['projects', cwd, 'mcpServers'] : ['mcpServers']
    let target: Record<string, unknown> = config
    for (const key of keys) {
      target[key] = servers(target, key)
      target = target[key] as Record<string, unknown>
    }
    if (verb === 'add-json') target[name] = JSON.parse(json ?? '{}')
    if (verb === 'remove') delete target[name]
    await writeFile(file, JSON.stringify(config))
    return { exitCode: 0, stderr: '', stdout: '' }
  }
}

/** The probe: user servers from `.claude.json`, project ones from `.mcp.json` unless gated. */
function fakeProbe(configDir: string, probes: Options[]): ClaudeCreateQuery {
  return (input) => {
    probes.push(input.options)
    const cwd = input.options.cwd ?? ''
    const gated = new Set(
      (input.options.settings as { disabledMcpjsonServers?: string[] } | undefined)
        ?.disabledMcpjsonServers ?? [],
    )
    let reads = 0
    return {
      initializationResult: async () => ({ account: {}, commands: [] }),
      mcpServerStatus: async (): Promise<McpServerStatus[]> => {
        reads += 1
        const user = servers(await readJson(path.join(configDir, '.claude.json')), 'mcpServers')
        const project = servers(await readJson(path.join(cwd, '.mcp.json')), 'mcpServers')
        return [
          ...Object.entries(user).map(([name, config]) => ({
            config: config as McpServerStatus['config'],
            name,
            source: 'user',
            // The first read finds servers still starting; the probe waits them out.
            status: reads === 1 ? ('pending' as const) : ('connected' as const),
            tools: [{ name: 'search' }],
          })),
          ...Object.keys(project)
            .filter((name) => !gated.has(name))
            .map((name) => ({ name, source: 'project', status: 'connected' as const })),
        ]
      },
      [Symbol.asyncIterator]: () => ({ next: () => new Promise<never>(() => {}) }),
    } as unknown as Query
  }
}

async function harness() {
  const root = await mkdtemp(path.join(tmpdir(), 'platform-mcp-config-'))
  roots.push(root)
  const configDir = path.join(root, 'claude-config')
  const project = path.join(root, 'project')
  await mkdir(configDir, { recursive: true })
  await mkdir(project, { recursive: true })
  await writeFile(
    path.join(configDir, '.claude.json'),
    JSON.stringify({
      mcpServers: {
        linear: {
          type: 'http',
          url: 'https://mcp.linear.app/mcp',
          headers: { Authorization: 'Bearer secret-linear' },
        },
      },
    }),
  )
  await writeFile(
    path.join(project, '.mcp.json'),
    JSON.stringify({ mcpServers: { deploy: { command: 'deploy-server' } } }),
  )
  const calls: CliCall[] = []
  const probes: Options[] = []
  const claude = new ClaudeProviderAdapter({
    attachmentsDir: path.join(root, 'attachments'),
    auth: signedInClaudeAuth(),
    createQuery: fakeProbe(configDir, probes),
    env: { ...process.env, CLAUDE_CONFIG_DIR: configDir },
    mcpCli: fakeMcpCli(configDir, calls),
    projectMcpApprovalsFile: path.join(root, 'state', 'approvals.json'),
    resolveExecutable: resolveFakeClaudeExecutable,
  })
  const app = createTestApp({
    auth: { allowedOrigins: [TRUSTED_ORIGIN] },
    orchestration: {
      providerAdapterRegistry: new ProviderAdapterRegistry([claude, new MockProviderAdapter()]),
    },
    settings: testSettingsOptions(root),
    watch: false,
    workspaceRoot: root,
  })
  return { app, calls, configDir, probes, project }
}

async function send(app: App, method: string, route: string, body?: unknown) {
  const response = await app.handle(
    new Request(`http://local${route}`, {
      method,
      headers: { origin: TRUSTED_ORIGIN, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  )
  const text = await response.text()
  return { body: text ? (JSON.parse(text) as unknown) : null, status: response.status }
}

async function list(app: App, folder: string) {
  const result = await send(
    app,
    'GET',
    `/providers/claude/mcp?folder=${encodeURIComponent(folder)}`,
  )
  expect(result.status).toBe(200)
  return result.body as ProviderInstanceMcp
}

describe('MCP config routes', () => {
  it('lists servers with their files, keeps unapproved project servers off, and sends no values', async () => {
    const { app, configDir, probes, project } = await harness()
    const mcp = await list(app, project)

    expect(mcp.scopes).toEqual(['user', 'local', 'project'])
    expect(
      mcp.servers.map((server) => [server.name, server.status, server.scope, server.file]),
    ).toEqual([
      ['linear', 'connected', 'user', path.join(configDir, '.claude.json')],
      ['deploy', 'unapproved', 'project', path.join(project, '.mcp.json')],
    ])
    expect(probes[0]).toMatchObject({
      cwd: project,
      settings: { disabledMcpjsonServers: ['deploy'] },
    })
    expect(JSON.stringify(mcp)).not.toContain('secret-linear')
  })

  it('adds through claude mcp add-json, and a project server it wrote needs no approval', async () => {
    const { app, calls, project } = await harness()
    const added = await send(app, 'POST', '/providers/claude/mcp', {
      name: 'docs',
      scope: 'project',
      folder: project,
      definition: { transport: 'stdio', command: 'docs-server', args: ['--port', '1'], env: {} },
    })

    expect(added.status).toBe(200)
    expect(calls).toEqual([
      {
        args: [
          'mcp',
          'add-json',
          '-s',
          'project',
          'docs',
          JSON.stringify({ type: 'stdio', command: 'docs-server', args: ['--port', '1'], env: {} }),
        ],
        cwd: project,
      },
    ])
    const mcp = await list(app, project)
    expect(mcp.servers.find((server) => server.name === 'docs')?.status).toBe('connected')
  })

  it('refuses the reserved name, a taken name and a local server with no folder', async () => {
    const { app, calls } = await harness()
    const definition = { transport: 'http', url: 'https://x.example.test/mcp', headers: {} }

    const reserved = await send(app, 'POST', '/providers/claude/mcp', {
      name: 'platform',
      scope: 'user',
      folder: null,
      definition,
    })
    const taken = await send(app, 'POST', '/providers/claude/mcp', {
      name: 'linear',
      scope: 'user',
      folder: null,
      definition,
    })
    const local = await send(app, 'POST', '/providers/claude/mcp', {
      name: 'fresh',
      scope: 'local',
      folder: null,
      definition,
    })

    expect([reserved.status, taken.status, local.status]).toEqual([400, 409, 400])
    expect(calls).toEqual([])
  })

  it('removes through claude mcp remove, and copies a user server into a project local scope', async () => {
    const { app, calls, configDir, project } = await harness()
    const copied = await send(app, 'POST', '/providers/claude/mcp/linear/copy', {
      scope: 'user',
      folder: project,
      target: { providerInstanceId: 'claude', scope: 'local' },
    })
    expect(copied.status).toBe(200)
    const config = await readJson(path.join(configDir, '.claude.json'))
    expect(servers(config, 'projects', project, 'mcpServers')).toEqual({
      linear: {
        type: 'http',
        url: 'https://mcp.linear.app/mcp',
        headers: { Authorization: 'Bearer secret-linear' },
      },
    })

    const removed = await send(app, 'DELETE', '/providers/claude/mcp/linear', {
      scope: 'user',
      folder: null,
    })
    const missing = await send(app, 'DELETE', '/providers/claude/mcp/linear', {
      scope: 'user',
      folder: null,
    })

    expect([removed.status, missing.status]).toEqual([200, 404])
    expect(calls.map((call) => call.args.slice(0, 4))).toEqual([
      ['mcp', 'add-json', '-s', 'local'],
      ['mcp', 'remove', '-s', 'user'],
    ])
  })

  it('answers an instance without MCP config (the mock Codex) with a conflict', async () => {
    const { app } = await harness()
    const result = await send(app, 'GET', '/providers/codex/mcp')

    expect(result.status).toBe(409)
  })
})
