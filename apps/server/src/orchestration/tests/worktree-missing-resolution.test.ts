import { rm, unlink } from 'node:fs/promises'
import * as v from 'valibot'
import { orchestrationCommandSchema } from '@workspace/contracts'
import { afterEach, expect, test } from 'vitest'
import { closeTestApps } from '../../../test/server'
import { FIXTURE_MODEL } from '../../../test/factories/orchestration'
import {
  interruptProvisioning,
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

test('missing shared checkout fans attention to each session and confirmed absence unblocks project deletion', async () => {
  const fixture = await worktreeLifecycleFixture()
  fixtures.push(fixture)
  const worktree = await fixture.create()
  await fixture.command({
    type: 'session.create',
    sessionId: sharedSessionId,
    worktreeTarget: { kind: 'current', worktreeId: lifecycleWorktreeId },
    title: 'Shared',
    modelSelection: FIXTURE_MODEL,
  })
  await runGit(fixture.root, ['worktree', 'remove', worktree.canonicalPath], { cwdMode: 'option' })
  await fixture.restart()
  expect((await fixture.engine.shellSnapshot()).sessions).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: lifecycleSessionId,
        attentionState: 'needs-input',
        attentionReason: 'worktree',
      }),
      expect.objectContaining({
        id: sharedSessionId,
        attentionState: 'needs-input',
        attentionReason: 'worktree',
      }),
    ]),
  )
  const preview = await fixture.engine.worktreeMissingPreview(lifecycleWorktreeId)
  await expect(
    fixture.command({
      type: 'worktree.resolve-missing',
      worktreeId: lifecycleWorktreeId,
      authorization: preview.authorization,
    }),
  ).rejects.toThrow()
  await fixture.command({ type: 'session.delete', sessionId: lifecycleSessionId })
  await fixture.command({ type: 'session.delete', sessionId: sharedSessionId })
  await fixture.engine.providerRuntimeIdle()
  await fixture.command({
    type: 'worktree.resolve-missing',
    worktreeId: lifecycleWorktreeId,
    authorization: preview.authorization,
  })
  expect(
    (await fixture.engine.readModelSnapshot()).worktrees.get(lifecycleWorktreeId)?.lifecycle.state,
  ).toBe('removed')
  await fixture.command({ type: 'project.delete', projectId: fixture.registration.projectId })
  expect(
    (
      await runGit(fixture.root, ['rev-parse', `refs/heads/${worktree.branch}`], {
        cwdMode: 'option',
      })
    ).stdout.trim(),
  ).toBe(worktree.baseCommit)
})

test('a failed creation with no remaining path has a confirmed no-delete resolution', async () => {
  const fixture = await worktreeLifecycleFixture()
  fixtures.push(fixture)
  const unsubscribe = interruptProvisioning(fixture)
  const failed = await fixture.create()
  unsubscribe()
  await unlink(failed.canonicalPath)
  await fixture.command({ type: 'session.delete', sessionId: lifecycleSessionId })
  await fixture.engine.providerRuntimeIdle()
  const preview = await fixture.engine.worktreeMissingPreview(lifecycleWorktreeId)
  await fixture.command({
    type: 'worktree.resolve-missing',
    worktreeId: lifecycleWorktreeId,
    authorization: preview.authorization,
  })
  expect(
    (await fixture.engine.readModelSnapshot()).worktrees.get(lifecycleWorktreeId)?.lifecycle.state,
  ).toBe('removed')
})

test('explicit release permits project deletion after the entire repository disappears', async () => {
  const fixture = await worktreeLifecycleFixture()
  fixtures.push(fixture)
  await fixture.create()
  await fixture.command({ type: 'session.delete', sessionId: lifecycleSessionId })
  await fixture.engine.providerRuntimeIdle()
  await rm(fixture.root, { recursive: true, force: true })
  await fixture.command({ type: 'worktree.release', worktreeId: lifecycleWorktreeId })
  expect(
    (await fixture.engine.readModelSnapshot()).worktrees.get(lifecycleWorktreeId)?.ownership,
  ).toBe('external')
  await fixture.command({ type: 'project.delete', projectId: fixture.registration.projectId })
  expect((await fixture.engine.shellSnapshot()).projects).toHaveLength(0)
})

test('discovered driver history keeps safe and force cleanup blocked after its session is deleted', async () => {
  const fixture = await worktreeLifecycleFixture()
  fixtures.push(fixture)
  const worktree = await fixture.create()
  await fixture.engine.dispatch(
    v.parse(orchestrationCommandSchema, {
      type: 'session.discover',
      commandId: 'discover-external',
      sessionId: sharedSessionId,
      worktreeId: lifecycleWorktreeId,
      title: 'External driver',
      modelSelection: FIXTURE_MODEL,
      sourceUpdatedAt: new Date().toISOString(),
    }),
  )
  await fixture.command({ type: 'session.delete', sessionId: lifecycleSessionId })
  await fixture.command({ type: 'session.delete', sessionId: sharedSessionId })
  await fixture.engine.providerRuntimeIdle()
  await fixture.restart()
  expect(
    (await fixture.engine.readModelSnapshot()).worktrees.get(lifecycleWorktreeId),
  ).toMatchObject({
    externalDriverUnverified: true,
    cleanupEligibility: { reason: 'external-driver-unverified' },
  })
  await expect(
    fixture.command({ type: 'worktree.cleanup', worktreeId: lifecycleWorktreeId }),
  ).rejects.toThrow()
  const preview = await fixture.engine.worktreeCleanupPreview(lifecycleWorktreeId)
  await expect(
    fixture.command({
      type: 'worktree.force-cleanup',
      worktreeId: lifecycleWorktreeId,
      authorization: preview.authorization,
    }),
  ).rejects.toThrow()
  await fixture.command({ type: 'worktree.release', worktreeId: lifecycleWorktreeId })
  expect(
    (
      await runGit(worktree.canonicalPath, ['rev-parse', 'HEAD'], { cwdMode: 'option' })
    ).stdout.trim(),
  ).toBe(worktree.baseCommit)
})
