import { getClient } from '@/lib/client'
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { describe } from 'vitest'

import { expect, test } from '../../../../test/fixtures'
import * as api from '@/features/git/utils/api'

// Drives the real git server in-process through the api.ts wrappers — the same
// `getClient()` the app uses, pointed at the test server by the `client` fixture.
// No mock.module, no fake client.

async function initRepo(root: string) {
  const repo = path.join(root, 'repo')
  await mkdir(repo, { recursive: true })
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' })
  git('init', '-b', 'main')
  git('config', 'user.email', 'test@example.com')
  git('config', 'user.name', 'Test')
  await writeFile(path.join(repo, 'a.ts'), 'export const a = 1\n')
  git('add', 'a.ts')
  git('commit', '-m', 'init')
  return repo
}

describe('git api against the real server', () => {
  test('reports a clean repository on its branch', async ({ client, server }) => {
    void client
    await initRepo(server.root)

    const status = await api.fetchStatus('repo', undefined, getClient())

    expect(status.repository?.branch).toBe('main')
    expect(status.files).toEqual([])
  })

  test('surfaces worktree modifications', async ({ client, server }) => {
    void client
    const repo = await initRepo(server.root)
    await writeFile(path.join(repo, 'a.ts'), 'export const a = 2\n')

    const status = await api.fetchStatus('repo', undefined, getClient())

    const changed = status.files.find((file) => file.path.endsWith('a.ts'))
    expect(changed?.worktree).toBe('modified')
  })
})
