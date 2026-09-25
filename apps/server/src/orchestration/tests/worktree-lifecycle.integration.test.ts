import { readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { closeTestApps } from '../../../test/server'
import { FIXTURE_MODEL } from '../../../test/factories/orchestration'
import {
  lifecycleSessionId,
  lifecycleWorktreeId,
  sharedSessionId,
  worktreeLifecycleFixture,
} from '../../../test/factories/worktree-lifecycle'
import { runGit } from '../../testing/git'

const fixtures: Awaited<ReturnType<typeof worktreeLifecycleFixture>>[] = []
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.dispose()))
  await closeTestApps()
})

test('real app provisions one checkout, shares it, preserves dirty work across restart, and binds force to a fresh preview', async () => {
  const fixture = await worktreeLifecycleFixture()
  fixtures.push(fixture)
  const worktree = await fixture.create()
  expect(worktree.lifecycle.state).toBe('ready')
  expect(path.isAbsolute(worktree.path)).toBe(false)
  const file = await fixture.app.handle(
    new Request(
      `http://localhost/fs/read?path=${encodeURIComponent(`${worktree.path}/tracked.txt`)}`,
      { headers: { origin: 'http://localhost:5173' } },
    ),
  )
  expect(file.status, await file.clone().text()).toBe(200)
  expect(worktree.branch).toBe(`worktree/${lifecycleWorktreeId}`)
  expect(fixture.adapter.startedTurns).toHaveLength(1)
  expect(fixture.adapter.startedTurns[0]?.cwd).toBe(worktree.canonicalPath)
  await fixture.command({
    type: 'session.create',
    sessionId: sharedSessionId,
    worktreeTarget: { kind: 'current', worktreeId: lifecycleWorktreeId },
    title: 'Shared',
    modelSelection: FIXTURE_MODEL,
  })
  await expect(
    fixture.command({ type: 'worktree.cleanup', worktreeId: lifecycleWorktreeId }),
  ).rejects.toThrow()
  expect(
    (await fixture.engine.readModelSnapshot()).worktrees.get(lifecycleWorktreeId)?.lifecycle.state,
  ).toBe('ready')
  await fixture.command({ type: 'session.delete', sessionId: lifecycleSessionId })
  await fixture.engine.providerRuntimeIdle()
  expect(await readFile(path.join(worktree.canonicalPath, 'tracked.txt'), 'utf8')).toBe('initial\n')
  await expect(
    fixture.command({ type: 'worktree.cleanup', worktreeId: lifecycleWorktreeId }),
  ).rejects.toThrow()
  await fixture.command({ type: 'session.delete', sessionId: sharedSessionId })
  await fixture.engine.providerRuntimeIdle()
  await writeFile(path.join(worktree.canonicalPath, 'tracked.txt'), 'keep my edit\n')
  await writeFile(path.join(worktree.canonicalPath, 'ignored.txt'), 'ignored work\n')
  await fixture.command({ type: 'worktree.cleanup', worktreeId: lifecycleWorktreeId })
  await fixture.engine.providerRuntimeIdle()
  expect(
    (await fixture.engine.shellSnapshot()).worktrees.find((row) => row.id === lifecycleWorktreeId)
      ?.lifecycle,
  ).toMatchObject({ state: 'cleanup-blocked', reason: 'dirty' })
  await fixture.restart()
  expect(
    (await fixture.engine.shellSnapshot()).worktrees.find((row) => row.id === lifecycleWorktreeId)
      ?.lifecycle,
  ).toMatchObject({ state: 'cleanup-blocked', reason: 'dirty' })
  await fixture.command({ type: 'worktree.retain', worktreeId: lifecycleWorktreeId })
  const preview = await fixture.engine.worktreeCleanupPreview(lifecycleWorktreeId)
  await writeFile(path.join(worktree.canonicalPath, 'ignored.txt'), 'changed after confirmation\n')
  await fixture.command({
    type: 'worktree.force-cleanup',
    worktreeId: lifecycleWorktreeId,
    authorization: preview.authorization,
  })
  await fixture.engine.providerRuntimeIdle()
  expect(
    (await fixture.engine.readModelSnapshot()).worktrees.get(lifecycleWorktreeId)?.lifecycle,
  ).toMatchObject({ state: 'cleanup-blocked', reason: 'needs-reconfirmation' })
  expect(await readFile(path.join(worktree.canonicalPath, 'tracked.txt'), 'utf8')).toBe(
    'keep my edit\n',
  )
  const fresh = await fixture.engine.worktreeCleanupPreview(lifecycleWorktreeId)
  await fixture.command({
    type: 'worktree.force-cleanup',
    worktreeId: lifecycleWorktreeId,
    authorization: fresh.authorization,
  })
  await fixture.engine.providerRuntimeIdle()
  expect(
    (await fixture.engine.readModelSnapshot()).worktrees.get(lifecycleWorktreeId)?.lifecycle.state,
  ).toBe('removed')
  await expect(stat(worktree.canonicalPath)).rejects.toMatchObject({ code: 'ENOENT' })
  expect(
    (
      await runGit(fixture.root, ['rev-parse', `refs/heads/worktree/${lifecycleWorktreeId}`], {
        cwdMode: 'option',
      })
    ).stdout.trim(),
  ).toBe(worktree.baseCommit)
})

test('managed mutations have no public Git route and an explicit release preserves the checkout through project deletion', async () => {
  const fixture = await worktreeLifecycleFixture()
  fixtures.push(fixture)
  const worktree = await fixture.create()
  for (const endpoint of ['create', 'remove']) {
    const response = await fixture.app.handle(
      new Request(`http://localhost/git/worktrees/${endpoint}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }),
    )
    expect(response.status, await response.text()).toBe(404)
  }
  await fixture.command({ type: 'session.delete', sessionId: lifecycleSessionId })
  await fixture.engine.providerRuntimeIdle()
  await expect(
    fixture.command({
      type: 'project.delete',
      projectId: fixture.registration.projectId,
      force: true,
    }),
  ).rejects.toThrow()
  await fixture.command({ type: 'worktree.release', worktreeId: lifecycleWorktreeId })
  await fixture.command({
    type: 'project.delete',
    projectId: fixture.registration.projectId,
    force: true,
  })
  expect(await readFile(path.join(worktree.canonicalPath, 'tracked.txt'), 'utf8')).toBe('initial\n')
})
