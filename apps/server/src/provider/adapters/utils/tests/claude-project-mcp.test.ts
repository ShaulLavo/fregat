import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { gitFixtureEnv } from '../../../../testing/git-identity'
import { approveProjectMcpServer, unapprovedProjectMcpServers } from '../claude-project-mcp'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

/** A checkout whose `.mcp.json` declares two servers, and a Claude config home with no approvals. */
async function checkout() {
  const root = await mkdtemp(path.join(tmpdir(), 'platform-project-mcp-'))
  roots.push(root)
  const cwd = path.join(root, 'repo')
  const configDir = path.join(root, 'claude-config')
  await mkdir(path.join(cwd, '.claude'), { recursive: true })
  await mkdir(configDir, { recursive: true })
  await writeJson(path.join(cwd, '.mcp.json'), {
    mcpServers: { deploy: { command: 'deploy-server' }, docs: { command: 'docs-server' } },
  })
  return { configDir, cwd, env: { CLAUDE_CONFIG_DIR: configDir } }
}

async function writeJson(file: string, value: unknown) {
  await writeFile(file, JSON.stringify(value))
}

function git(cwd: string, ...args: string[]) {
  const result = Bun.spawnSync(['git', '-C', cwd, ...args], {
    env: { ...process.env, ...gitFixtureEnv },
  })
  if (result.exitCode !== 0) throw new TypeError(`git ${args.join(' ')} failed`)
}

test('every project server is off until something the repository cannot ship approves it', async () => {
  const { cwd, env } = await checkout()

  expect(await unapprovedProjectMcpServers({ cwd, env })).toEqual(['deploy', 'docs'])
})

test('approvals count from user settings, .claude.json and an untracked local file', async () => {
  const user = await checkout()
  await writeJson(path.join(user.configDir, 'settings.json'), { enabledMcpjsonServers: ['docs'] })
  expect(await unapprovedProjectMcpServers(user)).toEqual(['deploy'])

  const state = await checkout()
  await writeJson(path.join(state.configDir, '.claude.json'), {
    projects: { [state.cwd]: { enableAllProjectMcpServers: true } },
  })
  expect(await unapprovedProjectMcpServers(state)).toEqual([])

  const local = await checkout()
  await approveProjectMcpServer({ cwd: local.cwd, name: 'deploy' })
  expect(await unapprovedProjectMcpServers(local)).toEqual(['docs'])
})

test("the repository's own settings cannot approve its servers", async () => {
  const { cwd, env } = await checkout()
  await writeJson(path.join(cwd, '.claude', 'settings.json'), { enableAllProjectMcpServers: true })
  await writeJson(path.join(cwd, '.claude', 'settings.local.json'), {
    enabledMcpjsonServers: ['deploy', 'docs'],
  })
  git(cwd, 'init', '--quiet')
  git(cwd, 'add', '--force', '.claude/settings.local.json')

  expect(await unapprovedProjectMcpServers({ cwd, env })).toEqual(['deploy', 'docs'])
})

test('approving keeps the local settings already there', async () => {
  const { cwd } = await checkout()
  const file = path.join(cwd, '.claude', 'settings.local.json')
  await writeJson(file, { enabledMcpjsonServers: ['docs'], permissions: { allow: ['Bash(ls)'] } })

  await approveProjectMcpServer({ cwd, name: 'deploy' })
  await approveProjectMcpServer({ cwd, name: 'deploy' })

  expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({
    enabledMcpjsonServers: ['docs', 'deploy'],
    permissions: { allow: ['Bash(ls)'] },
  })
})
