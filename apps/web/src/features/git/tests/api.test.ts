import { activeServerOrigin, getClient, setActiveServerOrigin } from '@/lib/client'
import { useEnvironmentsStore } from '@/lib/environments/state/store'
import { createEnvironmentEntry } from '@workspace/client-core/environments/utils/connection'
import { environmentIdSchema } from '@workspace/contracts'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import * as v from 'valibot'
import { describe } from 'vitest'

import { recordClientLog } from '../../../../test/factories/client-log'
import { runGit } from '../../../../test/factories/git'
import { expect, test } from '../../../../test/fixtures'
import * as api from '@/features/git/utils/api'

// Drives the real git server in-process through the api.ts wrappers — the same
// `getClient()` the app uses, pointed at the test server by the `client` fixture.
// No mock.module, no fake client.

async function initRepo(root: string) {
  const repo = path.join(root, 'repo')
  await mkdir(repo, { recursive: true })
  runGit(repo, ['init', '-b', 'main'], { cwdMode: 'option' })
  await writeFile(path.join(repo, 'a.ts'), 'export const a = 1\n')
  runGit(repo, ['add', 'a.ts'], { cwdMode: 'option' })
  runGit(repo, ['commit', '-m', 'init'], { cwdMode: 'option' })
  return repo
}

function addUpstream(root: string, repo: string) {
  runGit(root, ['init', '--bare', '-b', 'main', 'remote.git'], { cwdMode: 'option' })
  runGit(repo, ['remote', 'add', 'origin', path.join(root, 'remote.git')], { cwdMode: 'option' })
  runGit(repo, ['push', '-u', 'origin', 'main'], { cwdMode: 'option' })
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

  test('attributes a sync to the machine its client targets', async ({ client, server }) => {
    const repo = await initRepo(server.root)
    addUpstream(server.root, repo)
    const origin = activeServerOrigin()
    const otherOrigin = 'http://localhost:39911'
    const environmentId = v.parse(environmentIdSchema, '01900000-0000-4000-8000-000000000011')
    const previous = useEnvironmentsStore.getState()
    useEnvironmentsStore.setState({
      entries: {
        [origin]: { ...createEnvironmentEntry(origin, origin), name: 'target', environmentId },
        [otherOrigin]: { ...createEnvironmentEntry(otherOrigin, origin), name: 'other' },
      },
    })
    const info = recordClientLog('info')
    try {
      setActiveServerOrigin(otherOrigin)
      await api.syncRemote('repo', client)
    } finally {
      setActiveServerOrigin(origin)
      useEnvironmentsStore.setState(previous, true)
    }

    expect(info.events('git.sync_remote')).toEqual([
      expect.objectContaining({ environmentId, machine: 'target', outcome: 'ok' }),
    ])
  })
})
