import { unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { closeTestApps } from '../../../test/server'
import { executeGit } from '../../../test/factories/orchestration'
import {
  interruptProvisioning,
  lifecycleSessionId,
  lifecycleWorktreeId,
  worktreeLifecycleFixture,
} from '../../../test/factories/worktree-lifecycle'

const fixtures: Awaited<ReturnType<typeof worktreeLifecycleFixture>>[] = []
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.dispose()))
  await closeTestApps()
})

test('failed creation blocks the original message and retry forks the saved commit after the base moves', async () => {
  const fixture = await worktreeLifecycleFixture()
  fixtures.push(fixture)
  const unsubscribe = interruptProvisioning(fixture)
  const failed = await fixture.create()
  unsubscribe()
  expect(failed.lifecycle.state).toBe('creation-failed')
  expect(failed).toMatchObject({ baseBranch: 'main' })
  expect(fixture.adapter.startedTurns).toHaveLength(0)
  expect((await fixture.engine.shellSnapshot()).sessions[0]).toMatchObject({
    attentionState: 'needs-input',
    attentionReason: 'worktree',
    hasError: true,
  })
  await unlink(failed.canonicalPath)
  await writeFile(path.join(fixture.root, 'tracked.txt'), 'base moved\n')
  await executeGit(fixture.root, 'commit', '-am', 'move base')
  await executeGit(fixture.root, 'checkout', '-b', 'later-base')
  await fixture.command({ type: 'worktree.retry', worktreeId: lifecycleWorktreeId })
  await fixture.engine.providerRuntimeIdle()
  const model = await fixture.engine.readModelSnapshot()
  expect(model.worktrees.get(lifecycleWorktreeId)?.lifecycle.state).toBe('ready')
  expect(model.worktrees.get(lifecycleWorktreeId)).toMatchObject({ baseBranch: 'main' })
  expect(await executeGit(failed.canonicalPath, 'rev-parse', 'HEAD')).toBe(failed.baseCommit)
  expect(fixture.adapter.startedTurns).toHaveLength(1)
  expect(fixture.adapter.startedTurns[0]?.cwd).toBe(failed.canonicalPath)
  expect(
    model.sessions.get(lifecycleSessionId)?.messages.filter((message) => message.role === 'user'),
  ).toHaveLength(1)
})

test('interrupting a blocked turn prevents retry from invoking the provider', async () => {
  const fixture = await worktreeLifecycleFixture()
  fixtures.push(fixture)
  const unsubscribe = interruptProvisioning(fixture)
  const failed = await fixture.create()
  unsubscribe()
  await fixture.command({ type: 'session.turn.interrupt', sessionId: lifecycleSessionId })
  await fixture.engine.providerRuntimeIdle()
  await unlink(failed.canonicalPath)
  await fixture.command({ type: 'worktree.retry', worktreeId: lifecycleWorktreeId })
  await fixture.engine.providerRuntimeIdle()
  expect(
    (await fixture.engine.readModelSnapshot()).worktrees.get(lifecycleWorktreeId)?.lifecycle.state,
  ).toBe('ready')
  expect(
    (await fixture.engine.readModelSnapshot()).sessions.get(lifecycleSessionId)?.latestTurn,
  ).toMatchObject({ state: 'interrupted', providerStartState: 'interrupted' })
  expect(fixture.adapter.startedTurns).toHaveLength(0)
})
