import { mkdir, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { workspaceToken } from '@workspace/client-core/address/workspace'
import type { Client } from '@/lib/client'
import type { TestServer } from '../server'
import { registerTestWorkspaceAddress } from './workspace-address'

export async function navigationWorkspace(client: Client, server: TestServer) {
  const rootPath = 'repo'
  await mkdir(path.join(server.root, rootPath))
  await Promise.all(
    ['a.ts', 'b.ts', 'c.ts', 'dirty.ts'].map((name) =>
      writeFile(path.join(server.root, rootPath, name), `export const value = '${name}'\n`),
    ),
  )
  const workspaceAddress = await registerTestWorkspaceAddress(client, rootPath)
  return { rootPath, workspaceAddress, base: `/~${workspaceToken(workspaceAddress)}/workbench` }
}

export async function initializeNavigationGitWorkspace(server: TestServer) {
  const cwd = path.join(server.root, 'repo')
  execFileSync('git', ['init', '-b', 'main'], { cwd, stdio: 'pipe' })
  execFileSync('git', ['config', 'user.name', 'Navigation fixture'], { cwd })
  execFileSync('git', ['config', 'user.email', 'navigation@example.com'], { cwd })
  execFileSync('git', ['add', '.'], { cwd })
  execFileSync('git', ['commit', '-m', 'Initial files'], { cwd, stdio: 'pipe' })
  await writeFile(path.join(cwd, 'a.ts'), 'export const changed = true\n')
}
