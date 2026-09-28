import { stat } from 'node:fs/promises'
import { afterEach, expect, test } from 'vitest'
import { closeTestApps } from '../../../test/server'
import {
  lifecycleSessionId,
  lifecycleWorktreeId,
  worktreeLifecycleFixture,
} from '../../../test/factories/worktree-lifecycle'
import { GitService } from '../../git/service'
import { GitWorktreeService } from '../../git/worktrees'
import { createWorkspacePaths } from '../../fs/path'

const fixtures: Awaited<ReturnType<typeof worktreeLifecycleFixture>>[] = []
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.dispose()))
  await closeTestApps()
})

test('the final ProviderService check blocks a real adapter runtime appearing after cleanup acceptance', async () => {
  const fixture = await worktreeLifecycleFixture()
  fixtures.push(fixture)
  const worktree = await fixture.create()
  const launch = fixture.adapter.startedSessions[0]
  if (!launch) throw new TypeError('Missing initial provider launch')
  await fixture.command({ type: 'session.delete', sessionId: lifecycleSessionId })
  await fixture.engine.providerRuntimeIdle()
  expect(await fixture.adapter.hasRuntime({ sessionId: lifecycleSessionId })).toBe(false)
  const git = new GitWorktreeService(new GitService(createWorkspacePaths(fixture.root)))
  await git.withRepositoryLane(fixture.root, async () => {
    await fixture.command({ type: 'worktree.cleanup', worktreeId: lifecycleWorktreeId })
    expect(
      (await fixture.engine.readModelSnapshot()).worktrees.get(lifecycleWorktreeId)?.lifecycle
        .state,
    ).toBe('cleanup-requested')
    await fixture.adapter.startRuntime(launch)
    const gate = fixture.engine.worktreeExecutionGate.tryAcquireExclusive(lifecycleWorktreeId)
    expect(gate.acquired).toBe(true)
    if (gate.acquired) gate.release()
  })
  await fixture.engine.providerRuntimeIdle()
  expect(
    (await fixture.engine.readModelSnapshot()).worktrees.get(lifecycleWorktreeId)?.lifecycle,
  ).toMatchObject({ state: 'cleanup-blocked', reason: 'active-runtime', changedFileCount: null })
  expect((await stat(worktree.canonicalPath)).isDirectory()).toBe(true)
  await fixture.adapter.stopRuntime({ sessionId: lifecycleSessionId })
  await fixture.command({ type: 'worktree.cleanup', worktreeId: lifecycleWorktreeId })
  await fixture.engine.providerRuntimeIdle()
  expect(
    (await fixture.engine.readModelSnapshot()).worktrees.get(lifecycleWorktreeId)?.lifecycle.state,
  ).toBe('removed')
})
