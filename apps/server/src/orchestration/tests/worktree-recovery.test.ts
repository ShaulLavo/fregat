import { stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import * as v from 'valibot'
import { orchestrationCommandSchema } from '@workspace/contracts'
import { afterEach, expect, test } from 'vitest'
import { closeTestApps } from '../../../test/server'
import { FIXTURE_MODEL } from '../../../test/factories/orchestration'
import {
  lifecycleSessionId,
  lifecycleWorktreeId,
  stopLifecycleEffects,
  worktreeLifecycleFixture,
} from '../../../test/factories/worktree-lifecycle'
import { runGit } from '../../testing/git'

const fixtures: Awaited<ReturnType<typeof worktreeLifecycleFixture>>[] = []
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.dispose()))
  await closeTestApps()
})

test.each(['intent', 'branch', 'checkout', 'ready'] as const)(
  'restart recovers the %s crash window and releases the original turn once',
  async (window) => {
    const fixture = await worktreeLifecycleFixture()
    fixtures.push(fixture)
    const stopped = await stopLifecycleEffects(fixture)
    const prepared = await stopped.git.prepareCreate({
      path: fixture.root,
      worktreeId: lifecycleWorktreeId,
    })
    await stopped.engine.dispatch(
      v.parse(orchestrationCommandSchema, {
        type: 'session.turn.start',
        commandId: 'crash-bootstrap',
        sessionId: lifecycleSessionId,
        turnId: 'crash-turn',
        message: { messageId: 'crash-message', role: 'user', text: 'Run once', attachments: [] },
        bootstrap: {
          createSession: {
            worktreeTarget: {
              kind: 'new',
              worktreeId: lifecycleWorktreeId,
              baseWorktreeId: fixture.registration.worktreeId,
            },
            title: 'Crash recovery',
            modelSelection: FIXTURE_MODEL,
          },
        },
        worktreeProvisioning: {
          worktreeId: lifecycleWorktreeId,
          baseWorktreeId: fixture.registration.worktreeId,
          projectId: fixture.registration.projectId,
          baseCommit: prepared.baseCommit,
          branch: prepared.branch,
          path: prepared.absolutePath,
          canonicalPath: prepared.absolutePath,
        },
      }),
    )
    if (window === 'branch')
      await runGit(
        fixture.root,
        ['update-ref', `refs/heads/${prepared.branch}`, prepared.baseCommit, '0'.repeat(40)],
        { cwdMode: 'option' },
      )
    if (window === 'checkout' || window === 'ready')
      await stopped.git.create({ ...prepared, path: fixture.root })
    if (window === 'ready')
      await stopped.engine.dispatch(
        v.parse(orchestrationCommandSchema, {
          type: 'worktree.create.complete',
          commandId: 'crash-created',
          worktreeId: lifecycleWorktreeId,
          operationId: 'crash-bootstrap',
          headCommit: prepared.baseCommit,
        }),
      )
    await stopped.engine.close()
    await fixture.restart()
    expect(
      (await fixture.engine.readModelSnapshot()).worktrees.get(lifecycleWorktreeId)?.lifecycle
        .state,
    ).toBe('ready')
    expect(fixture.adapter.startedTurns).toHaveLength(1)
    expect(fixture.adapter.startedTurns[0]?.cwd).toBe(prepared.absolutePath)
    expect(
      (await fixture.engine.sessionDetailSnapshot(lifecycleSessionId)).session.messages.filter(
        (message) => message.role === 'user',
      ),
    ).toHaveLength(1)
    await fixture.restart()
    expect(fixture.adapter.startedTurns).toHaveLength(0)
  },
)

test.each(['accepted', 'removed'] as const)(
  'safe cleanup recovers after %s and retains its branch',
  async (window) => {
    const fixture = await worktreeLifecycleFixture()
    fixtures.push(fixture)
    const worktree = await fixture.create()
    await fixture.command({ type: 'session.delete', sessionId: lifecycleSessionId })
    await fixture.engine.providerRuntimeIdle()
    const stopped = await stopLifecycleEffects(fixture)
    await stopped.engine.dispatch(
      v.parse(orchestrationCommandSchema, {
        type: 'worktree.cleanup',
        worktreeId: lifecycleWorktreeId,
        commandId: 'cleanup-crash',
      }),
    )
    if (window === 'removed')
      await stopped.git.remove({
        path: fixture.root,
        worktreeId: lifecycleWorktreeId,
        worktreePath: worktree.canonicalPath,
        mode: 'safe',
      })
    await stopped.engine.close()
    await fixture.restart()
    expect(
      (await fixture.engine.readModelSnapshot()).worktrees.get(lifecycleWorktreeId)?.lifecycle
        .state,
    ).toBe('removed')
    await expect(stat(worktree.canonicalPath)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(
      (
        await runGit(fixture.root, ['rev-parse', `refs/heads/${worktree.branch}`], {
          cwdMode: 'option',
        })
      ).stdout.trim(),
    ).toBe(worktree.baseCommit)
  },
)

test('force recovery rechecks ignored content changed after durable authorization', async () => {
  const fixture = await worktreeLifecycleFixture()
  fixtures.push(fixture)
  const worktree = await fixture.create()
  await fixture.command({ type: 'session.delete', sessionId: lifecycleSessionId })
  await fixture.engine.providerRuntimeIdle()
  await writeFile(path.join(worktree.canonicalPath, 'ignored.txt'), 'authorized bytes')
  const preview = await fixture.engine.worktreeCleanupPreview(lifecycleWorktreeId)
  const stopped = await stopLifecycleEffects(fixture)
  await stopped.engine.dispatch(
    v.parse(orchestrationCommandSchema, {
      type: 'worktree.force-cleanup',
      worktreeId: lifecycleWorktreeId,
      commandId: 'force-crash',
      authorization: preview.authorization,
    }),
  )
  await stopped.engine.close()
  await writeFile(path.join(worktree.canonicalPath, 'ignored.txt'), 'new bytes')
  await fixture.restart()
  expect(
    (await fixture.engine.readModelSnapshot()).worktrees.get(lifecycleWorktreeId)?.lifecycle,
  ).toMatchObject({ state: 'cleanup-blocked', reason: 'needs-reconfirmation' })
  expect((await stat(worktree.canonicalPath)).isDirectory()).toBe(true)
})
