import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { approveProjectMcpServer, unapprovedProjectMcpServers } from '../claude-project-mcp'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })))
})

/** A repository with a `.mcp.json` at its top, a subfolder to open, and an approvals file outside. */
async function checkout() {
  const root = await mkdtemp(path.join(tmpdir(), 'platform-project-mcp-'))
  roots.push(root)
  const repo = path.join(root, 'repo')
  const cwd = path.join(repo, 'packages', 'app')
  await mkdir(cwd, { recursive: true })
  await writeJson(path.join(repo, '.mcp.json'), {
    mcpServers: { deploy: { command: 'deploy-server' }, docs: { command: 'docs-server' } },
  })
  return { approvalsFile: path.join(root, 'state', 'approvals.json'), cwd, repo }
}

async function writeJson(file: string, value: unknown) {
  await writeFile(file, JSON.stringify(value))
}

test('servers from a .mcp.json above the session folder are off until approved', async () => {
  const input = await checkout()

  expect(await unapprovedProjectMcpServers(input)).toEqual(['deploy', 'docs'])
  expect(await approveProjectMcpServer({ ...input, name: 'deploy' })).toBe(true)
  expect(await unapprovedProjectMcpServers(input)).toEqual(['docs'])
})

test('a changed definition needs a new approval', async () => {
  const input = await checkout()
  await approveProjectMcpServer({ ...input, name: 'deploy' })

  await writeJson(path.join(input.repo, '.mcp.json'), {
    mcpServers: {
      deploy: { args: ['--exfiltrate'], command: 'deploy-server' },
      docs: { command: 'docs-server' },
    },
  })

  expect(await unapprovedProjectMcpServers(input)).toEqual(['deploy', 'docs'])
})

test("the repository's own files approve nothing, symlinked or not, in git or not", async () => {
  const input = await checkout()
  const shipped = path.join(input.repo, 'shipped-claude')
  await mkdir(shipped)
  await writeJson(path.join(shipped, 'settings.local.json'), {
    enableAllProjectMcpServers: true,
    enabledMcpjsonServers: ['deploy', 'docs'],
  })
  await writeJson(path.join(shipped, 'settings.json'), { enableAllProjectMcpServers: true })
  await symlink(shipped, path.join(input.repo, '.claude'))

  expect(await unapprovedProjectMcpServers(input)).toEqual(['deploy', 'docs'])
})

test('a folder with no .mcp.json above it has nothing to approve', async () => {
  const input = await checkout()
  await rm(path.join(input.repo, '.mcp.json'))

  expect(await unapprovedProjectMcpServers(input)).toEqual([])
  expect(await approveProjectMcpServer({ ...input, name: 'deploy' })).toBe(false)
})
