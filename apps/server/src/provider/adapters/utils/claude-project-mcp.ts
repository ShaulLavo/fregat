import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { isRecord } from '@workspace/utils/objects'

/**
 * A checkout's `.mcp.json` servers run commands the repository chose. The Claude CLI asks before
 * starting them; an SDK session does not, so each unapproved name is turned off at CLI start
 * (`disabledMcpjsonServers`) until the owner approves it. Approvals count only from files the
 * repository cannot ship: the user's settings, the user's `.claude.json`, and a
 * `.claude/settings.local.json` git does not track.
 */
export async function unapprovedProjectMcpServers(input: { cwd: string; env?: NodeJS.ProcessEnv }) {
  const names = await projectMcpServerNames(input.cwd)
  if (names.length === 0) return []

  const approvals = await Promise.all([
    approvalsIn(await readJson(path.join(claudeConfigDir(input.env), 'settings.json'))),
    approvalsIn(projectEntry(await readJson(claudeStatePath(input.env)), input.cwd)),
    localApprovals(input.cwd),
  ])
  if (approvals.some((approval) => approval.all)) return []

  const approved = new Set(approvals.flatMap((approval) => approval.names))
  return names.filter((name) => !approved.has(name)).sort()
}

/** Adds `name` to the checkout's local `enabledMcpjsonServers`, keeping every other key. */
export async function approveProjectMcpServer(input: { cwd: string; name: string }) {
  const file = localSettingsPath(input.cwd)
  const settings = (await readJson(file)) ?? {}
  const enabled = stringList(settings.enabledMcpjsonServers)
  if (enabled.includes(input.name)) return

  await mkdir(path.dirname(file), { recursive: true })
  const next = { ...settings, enabledMcpjsonServers: [...enabled, input.name] }
  await writeFile(file, `${JSON.stringify(next, null, 2)}\n`)
}

export function isLocalSettingsTracked(cwd: string) {
  const result = Bun.spawnSync(
    ['git', '-C', cwd, 'ls-files', '--error-unmatch', '.claude/settings.local.json'],
    { stderr: 'ignore', stdout: 'ignore' },
  )
  return result.exitCode === 0
}

async function projectMcpServerNames(cwd: string) {
  const config = await readJson(path.join(cwd, '.mcp.json'))
  const servers = config?.mcpServers
  return isRecord(servers) ? Object.keys(servers) : []
}

async function localApprovals(cwd: string) {
  if (isLocalSettingsTracked(cwd)) return { all: false, names: [] }

  return approvalsIn(await readJson(localSettingsPath(cwd)))
}

function approvalsIn(settings: Record<string, unknown> | null) {
  return {
    all: settings?.enableAllProjectMcpServers === true,
    names: stringList(settings?.enabledMcpjsonServers),
  }
}

function projectEntry(state: Record<string, unknown> | null, cwd: string) {
  const projects = state?.projects
  if (!isRecord(projects)) return null
  const entry = projects[cwd]
  return isRecord(entry) ? entry : null
}

function localSettingsPath(cwd: string) {
  return path.join(cwd, '.claude', 'settings.local.json')
}

function claudeConfigDir(env: NodeJS.ProcessEnv | undefined) {
  return env?.CLAUDE_CONFIG_DIR ?? process.env.CLAUDE_CONFIG_DIR ?? path.join(homedir(), '.claude')
}

/** The CLI keeps `.claude.json` inside `CLAUDE_CONFIG_DIR` when set, else beside it in home. */
function claudeStatePath(env: NodeJS.ProcessEnv | undefined) {
  const configDir = env?.CLAUDE_CONFIG_DIR ?? process.env.CLAUDE_CONFIG_DIR
  return configDir ? path.join(configDir, '.claude.json') : path.join(homedir(), '.claude.json')
}

function stringList(value: unknown) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === 'string') : []
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
