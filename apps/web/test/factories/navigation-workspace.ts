import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { workspaceToken } from '@workspace/client-core/address/workspace'
import type { Client } from '@/lib/client'
import type { TestServer } from '../server'
import { registerTestWorkspaceAddress } from './workspace-address'
import { runGit } from './git'

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
  runGit(cwd, ['init', '-b', 'main'], { cwdMode: 'option' })
  runGit(cwd, ['add', '.'], { cwdMode: 'option' })
  runGit(cwd, ['commit', '-m', 'Initial files'], { cwdMode: 'option' })
  await writeFile(path.join(cwd, 'a.ts'), 'export const changed = true\n')
}
