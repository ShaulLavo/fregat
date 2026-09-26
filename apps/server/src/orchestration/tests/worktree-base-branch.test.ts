import path from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { closeTestApps } from '../../../test/server'
import { runGit } from '../../testing/git'
import {
  lifecycleSessionId,
  lifecycleWorktreeId,
  worktreeLifecycleFixture,
} from '../../../test/factories/worktree-lifecycle'

const fixtures: Awaited<ReturnType<typeof worktreeLifecycleFixture>>[] = []
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.dispose()))
  await closeTestApps()
})

test.each(['release', undefined])(
  'persists the creation source %s through metadata changes and reload',
  async (baseBranch) => {
    const fixture = await worktreeLifecycleFixture({ baseBranch })
    fixtures.push(fixture)
    await runGit(fixture.root, ['branch', 'release'], { cwdMode: 'option' })
    await runGit(fixture.root, ['checkout', '-b', 'active-source'], { cwdMode: 'option' })
    const created = await fixture.create()
    expect(created).toMatchObject({ baseBranch: baseBranch ?? 'active-source' })
    await expectBaseBranch(fixture, baseBranch ?? 'active-source')

    await runGit(fixture.root, ['checkout', '-b', 'later-source'], { cwdMode: 'option' })
    await fixture.engine.refreshWorktreeMetadata(created.path)
    await fixture.restart()
    await expectBaseBranch(fixture, baseBranch ?? 'active-source')
  },
)

test('a detached creation source stays unknown after a branch is checked out', async () => {
  const fixture = await worktreeLifecycleFixture()
  fixtures.push(fixture)
  await runGit(fixture.root, ['checkout', '--detach'], { cwdMode: 'option' })
  expect(await fixture.create()).toMatchObject({ baseBranch: null })
  await runGit(fixture.root, ['checkout', 'main'], { cwdMode: 'option' })
  await fixture.restart()
  await expectBaseBranch(fixture, null)
})

test('registered external worktrees never acquire an inferred parent', async () => {
  const fixture = await worktreeLifecycleFixture()
  fixtures.push(fixture)
  const external = path.join(fixture.root, 'external')
  await runGit(fixture.root, ['worktree', 'add', '-b', 'external-child', external, 'main'], {
    cwdMode: 'option',
  })
  await fixture.command({
    type: 'project.create',
    title: 'External checkout',
    workspaceRoot: external,
    defaultModelSelection: null,
  })
  await fixture.restart()
  expect((await fixture.engine.shellSnapshot()).worktrees).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ canonicalPath: external, ownership: 'external', baseBranch: null }),
    ]),
  )
  expect(await listedWorktrees(fixture)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ absolutePath: external, baseBranch: null }),
      expect.objectContaining({ absolutePath: fixture.root, baseBranch: null }),
    ]),
  )
})

test('a different branch in a managed checkout never inherits its creation parent', async () => {
  const fixture = await worktreeLifecycleFixture()
  fixtures.push(fixture)
  const created = await fixture.create()
  await expectBaseBranch(fixture, 'main')

  await runGit(created.canonicalPath, ['switch', '-c', 'feature'], { cwdMode: 'option' })
  await fixture.engine.refreshWorktreeMetadata(created.path)
  await fixture.restart()
  expect(await listedWorktrees(fixture)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        worktreeId: lifecycleWorktreeId,
        branch: 'feature',
        baseBranch: null,
      }),
    ]),
  )

  await runGit(created.canonicalPath, ['switch', `worktree/${lifecycleWorktreeId}`], {
    cwdMode: 'option',
  })
  await expectBaseBranch(fixture, 'main')
})

test('released worktrees have no parent before or after reload', async () => {
  const fixture = await worktreeLifecycleFixture()
  fixtures.push(fixture)
  await fixture.create()
  await expectBaseBranch(fixture, 'main')
  await fixture.command({ type: 'session.delete', sessionId: lifecycleSessionId })
  await fixture.engine.providerRuntimeIdle()

  await fixture.command({ type: 'worktree.release', worktreeId: lifecycleWorktreeId })

  await expectBaseBranch(fixture, null)
  await fixture.restart()
  await expectBaseBranch(fixture, null)
})

async function expectBaseBranch(
  fixture: Awaited<ReturnType<typeof worktreeLifecycleFixture>>,
  baseBranch: string | null,
) {
  expect(
    (await fixture.engine.readModelSnapshot()).worktrees.get(lifecycleWorktreeId),
  ).toMatchObject({ baseBranch })
  expect((await fixture.engine.shellSnapshot()).worktrees).toEqual(
    expect.arrayContaining([expect.objectContaining({ id: lifecycleWorktreeId, baseBranch })]),
  )
  expect(await listedWorktrees(fixture)).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ worktreeId: lifecycleWorktreeId, baseBranch }),
    ]),
  )
}

async function listedWorktrees(fixture: Awaited<ReturnType<typeof worktreeLifecycleFixture>>) {
  const response = await fixture.app.handle(
    new Request('http://localhost/git/worktrees?path=', {
      headers: { origin: 'http://localhost:5173' },
    }),
  )
  expect(response.status, await response.clone().text()).toBe(200)
  return response.json()
}
