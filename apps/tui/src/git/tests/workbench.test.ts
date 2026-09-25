import { test, expect } from '../../../test/fixtures'
import { prepareGitWorkbench } from '../../../test/factories/git-workbench'
import { createGitWorkbench } from '@/git/state/workbench'
import {
  createSplitProjection,
  createStackedProjection,
  createDiffRegionStore,
} from '@singapore-editor/diff'
import { gitRows } from '@/git/utils/rows'
import { createControlledInProcessTransport } from '../../../test/client'
import { createEnvironmentClient } from '@workspace/client-core/transport/client'
import { runGit } from 'server/testing'

test('status, expandable whole-file diff, stage, unstage, and streaming commit use the real repository', async ({
  server,
  client,
}) => {
  await prepareGitWorkbench(server.root)
  const store = createGitWorkbench(client, '')
  try {
    await store.refresh()
    const initial = store.getSnapshot()
    expect(initial.listing, JSON.stringify(initial.listing)).toMatchObject({ kind: 'ready' })
    if (initial.listing.kind !== 'ready') return
    expect(gitRows(initial.listing.data.files).map((row) => row.value.staged)).toEqual([false])
    await store.openDiff('sample.txt', false)
    const diff = store.getSnapshot().diff
    expect(diff.kind).toBe('ready')
    if (diff.kind !== 'ready' || !diff.files[0]) return
    const file = diff.files[0]
    expect(file.isPartial).toBe(false)
    const regions = createDiffRegionStore()
    regions.setFile(file)
    const before = createStackedProjection(file)
    const expandable = before.rows.find((row) => row.expandKey)
    expect(expandable?.expandKey).toBeTruthy()
    if (expandable?.expandKey) regions.toggleRegion(expandable.expandKey)
    const expanded = createSplitProjection(file, { expandedRegions: regions.getExpandedRegions() })
    expect(expanded.leftRows.length).toBe(expanded.rightRows.length)
    expect(expanded.leftRows.some((row) => row.text === 'line 1')).toBe(true)
    expect(await store.stage('sample.txt')).toBe(true)
    expect((await runGit(server.root, ['diff', '--cached', '--name-only'])).stdout).toContain(
      'sample.txt',
    )
    expect(await store.unstage('sample.txt')).toBe(true)
    expect((await runGit(server.root, ['diff', '--cached', '--name-only'])).stdout).toBe('')
    await store.stage('sample.txt')
    expect(await store.commit('TUI commit fixture')).toBe(true)
    expect((await runGit(server.root, ['log', '-1', '--format=%s'])).stdout).toContain(
      'TUI commit fixture',
    )
    expect(store.getSnapshot().message).toBe('Committed staged changes.')
  } finally {
    store.dispose()
  }
})

test('draft PR reports unsupported remotes without claiming to publish', async ({
  server,
  client,
}) => {
  await prepareGitWorkbench(server.root)
  const store = createGitWorkbench(client, '')
  try {
    expect(await store.createPullRequest('A draft title')).toBe(false)
    expect(store.getSnapshot().message).toContain('unavailable')
    expect(store.getSnapshot().busy).toBe(false)
  } finally {
    store.dispose()
  }
})

test.for(['discard', 'refresh'])(
  '%s invalidates a delayed diff response',
  async (action, { server }) => {
    await prepareGitWorkbench(server.root)
    const transport = createControlledInProcessTransport(server)
    const client = createEnvironmentClient({
      origin: server.origin,
      headers: () => ({ origin: server.clientOrigin }),
      fetcher: transport.fetcher,
    })
    const store = createGitWorkbench(client, '')
    const gate = transport.pauseNextResponse('/git/diff/blob')
    try {
      await store.refresh()
      const pending = store.openDiff('sample.txt', false)
      await gate.reached
      if (action === 'discard') expect(await store.discard('sample.txt')).toBe(true)
      if (action === 'refresh') {
        const response = await client.git.discard.post({ paths: ['sample.txt'] })
        expect(response.error).toBeNull()
        await store.refresh()
      }
      gate.release()
      await pending
      expect(store.getSnapshot()).toMatchObject({
        listing: { kind: 'ready', data: { files: [] } },
        diff: { kind: 'empty' },
      })
      expect((await runGit(server.root, ['diff', '--name-only'])).stdout).toBe('')
    } finally {
      gate.release()
      store.dispose()
    }
  },
)

test('refresh removes a loaded diff when another client discards the final change', async ({
  server,
  client,
}) => {
  await prepareGitWorkbench(server.root)
  const store = createGitWorkbench(client, '')
  try {
    await store.refresh()
    await store.openDiff('sample.txt', false)
    expect(store.getSnapshot().diff.kind).toBe('ready')
    const response = await client.git.discard.post({ paths: ['sample.txt'] })
    expect(response.error).toBeNull()
    await store.refresh()
    expect(store.getSnapshot()).toMatchObject({
      listing: { kind: 'ready', data: { files: [] } },
      diff: { kind: 'empty' },
    })
  } finally {
    store.dispose()
  }
})
