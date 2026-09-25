import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { closeTestApps } from '../../../test/server'
import {
  lifecycleWorktreeId,
  worktreeLifecycleFixture,
} from '../../../test/factories/worktree-lifecycle'
import { runGit } from '../../testing/git'

const fixtures: Awaited<ReturnType<typeof worktreeLifecycleFixture>>[] = []
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.dispose()))
  await closeTestApps()
})

test('status records external A to B to A changes and Platform Git mutations refresh the projection', async () => {
  const fixture = await worktreeLifecycleFixture()
  fixtures.push(fixture)
  const worktree = await fixture.create()
  const branches = ['renamed', worktree.branch]
  if (!worktree.branch) throw new TypeError('Missing managed branch')
  let expectedVersion = worktree.metadataVersion
  for (const branch of branches) {
    if (!branch) throw new TypeError('Missing branch')
    await runGit(worktree.canonicalPath, ['branch', '-m', branch], { cwdMode: 'option' })
    const response = await fixture.app.handle(
      new Request(`http://localhost/git/status?path=${encodeURIComponent(worktree.path)}`, {
        headers: { origin: 'http://localhost:5173' },
      }),
    )
    expect(response.status, await response.clone().text()).toBe(200)
    expect(
      (await fixture.engine.readModelSnapshot()).worktrees.get(lifecycleWorktreeId),
    ).toMatchObject({
      branch,
      metadataVersion: ++expectedVersion,
      baseCommit: worktree.baseCommit,
    })
  }
  await fixture.engine.refreshWorktreeMetadata(worktree.path)
  expect(
    (await fixture.engine.readModelSnapshot()).worktrees.get(lifecycleWorktreeId)?.metadataVersion,
  ).toBe(expectedVersion)
  const response = await fixture.app.handle(
    new Request('http://localhost/git/create-branch', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:5173' },
      body: JSON.stringify({ path: worktree.path, branch: 'platform-created' }),
    }),
  )
  expect(response.status, await response.clone().text()).toBe(200)
  expect(
    (await fixture.engine.readModelSnapshot()).worktrees.get(lifecycleWorktreeId),
  ).toMatchObject({
    branch: 'platform-created',
    metadataVersion: expectedVersion + 1,
  })
})

test('branch diff uses the accepted fork commit after the base advances and the managed branch is renamed', async () => {
  const fixture = await worktreeLifecycleFixture()
  fixtures.push(fixture)
  const worktree = await fixture.create()
  await writeFile(path.join(fixture.root, 'tracked.txt'), 'base advanced\n')
  await runGit(fixture.root, ['commit', '-am', 'advance base'], { cwdMode: 'option' })
  await writeFile(path.join(worktree.canonicalPath, 'tracked.txt'), 'isolated change\n')
  await runGit(worktree.canonicalPath, ['commit', '-am', 'isolated change'], { cwdMode: 'option' })
  await runGit(worktree.canonicalPath, ['branch', '-m', 'renamed-worktree'], { cwdMode: 'option' })
  await runGit(
    worktree.canonicalPath,
    ['config', 'branch.renamed-worktree.platform-base', 'HEAD'],
    { cwdMode: 'option' },
  )
  const response = await fixture.app.handle(
    new Request(
      `http://localhost/git/branch-diff?path=${encodeURIComponent(worktree.path)}&base=HEAD`,
      { headers: { origin: 'http://localhost:5173' } },
    ),
  )
  expect(response.status, await response.clone().text()).toBe(200)
  expect(await response.json()).toMatchObject({
    baseRef: worktree.baseCommit,
    mergeBase: worktree.baseCommit,
    files: [
      {
        path: `${worktree.path}/tracked.txt`,
        hunks: [
          {
            changes: [
              { type: 'deleted', text: 'initial' },
              { type: 'added', text: 'isolated change' },
            ],
          },
        ],
      },
    ],
  })
})
