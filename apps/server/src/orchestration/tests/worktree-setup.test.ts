import * as v from 'valibot'
import { orchestrationCommandSchema } from '@workspace/contracts'
import { SetupRunner } from '../setup-runner'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { closeTestApps } from '../../../test/server'
import {
  lifecycleWorktreeId,
  stopLifecycleEffects,
  worktreeLifecycleFixture,
} from '../../../test/factories/worktree-lifecycle'

const fixtures: Awaited<ReturnType<typeof worktreeLifecycleFixture>>[] = []
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.dispose()))
  await closeTestApps()
})

async function withSetup(command: string, waitForSetup: boolean) {
  const fixture = await worktreeLifecycleFixture()
  fixtures.push(fixture)
  await fixture.command({
    type: 'project.meta.update',
    projectId: fixture.registration.projectId,
    scripts: [
      { name: 'Test', command: 'true' },
      { name: 'Install', command, runOnWorktreeCreate: true, waitForSetup },
    ],
  })
  return fixture
}

async function worktree(fixture: Awaited<ReturnType<typeof withSetup>>) {
  return (await fixture.engine.readModelSnapshot()).worktrees.get(lifecycleWorktreeId)
}

async function settled(fixture: Awaited<ReturnType<typeof withSetup>>) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const state = (await worktree(fixture))?.setup?.state
    if (state === 'done' || state === 'failed' || state === 'cancelled') return worktree(fixture)
    await Bun.sleep(20)
  }
  throw new TypeError('setup never settled')
}

test('a foreground setup runs in the new worktree before the first turn', async () => {
  const fixture = await withSetup(
    'echo "$PLATFORM_WORKTREE_PATH" > where.txt && echo installed',
    true,
  )
  const created = await fixture.create()
  expect(created.lifecycle.state).toBe('ready')
  expect(created.setup).toMatchObject({
    name: 'Install',
    foreground: true,
    state: 'done',
    exitCode: 0,
    output: ['installed'],
  })
  expect((await readFile(path.join(created.canonicalPath, 'where.txt'), 'utf8')).trim()).toBe(
    created.canonicalPath,
  )
  expect(fixture.adapter.startedTurns).toHaveLength(1)
})

test('a failed foreground setup holds the first turn and retry runs it once more', async () => {
  const fixture = await withSetup('echo run >> ../setup-runs.txt; echo broken >&2; exit 3', true)
  const failed = await fixture.create()
  expect(failed.lifecycle).toMatchObject({
    state: 'creation-failed',
    errorCode: 'worktree.SETUP_FAILED',
  })
  expect(failed.setup).toMatchObject({ state: 'failed', exitCode: 3, output: ['broken'] })
  expect(fixture.adapter.startedTurns).toHaveLength(0)
  await fixture.command({ type: 'worktree.retry', worktreeId: lifecycleWorktreeId })
  await fixture.engine.providerRuntimeIdle()
  const runs = await readFile(
    path.join(path.dirname(failed.canonicalPath), 'setup-runs.txt'),
    'utf8',
  )
  expect(runs.trim().split('\n')).toHaveLength(2)
  expect(fixture.adapter.startedTurns).toHaveLength(0)
})

test('a background setup lets the turn start, and can be stopped and run again', async () => {
  const fixture = await withSetup('sleep 30', false)
  await fixture.create()
  expect(fixture.adapter.startedTurns).toHaveLength(1)
  expect((await worktree(fixture))?.setup).toMatchObject({ foreground: false, state: 'running' })
  await fixture.command({ type: 'worktree.setup.cancel', worktreeId: lifecycleWorktreeId })
  expect((await settled(fixture))?.setup?.state).toBe('cancelled')

  await fixture.command({
    type: 'project.meta.update',
    projectId: fixture.registration.projectId,
    scripts: [{ name: 'Install', command: 'echo again', runOnWorktreeCreate: true }],
  })
  await fixture.command({ type: 'worktree.setup.run', worktreeId: lifecycleWorktreeId })
  expect((await settled(fixture))?.setup).toMatchObject({ state: 'done', output: ['again'] })
})

test('a project with no setup script runs nothing and refuses a rerun', async () => {
  const fixture = await worktreeLifecycleFixture()
  fixtures.push(fixture)
  const created = await fixture.create()
  expect(created.setup).toBeNull()
  await expect(
    fixture.command({ type: 'worktree.setup.run', worktreeId: lifecycleWorktreeId }),
  ).rejects.toThrow('no setup script')
})

test('cancellation kills a setup process group that ignores TERM', async () => {
  const fixture = await withSetup(
    "trap '' TERM; echo $$ > ready.pid; while :; do sleep 1; done",
    false,
  )
  const created = await fixture.create()
  const ready = path.join(created.canonicalPath, 'ready.pid')
  await expect.poll(() => readFile(ready, 'utf8')).toMatch(/\d+/)
  const pid = Number(await readFile(ready, 'utf8'))
  try {
    const cancellation = fixture.command({
      type: 'worktree.setup.cancel',
      worktreeId: lifecycleWorktreeId,
    })
    await Promise.race([cancellation, Bun.sleep(2000)])
    await expect
      .poll(async () => (await worktree(fixture))?.setup?.state, { timeout: 2500 })
      .toBe('cancelled')
    expect(() => process.kill(pid, 0)).toThrow()
  } finally {
    try {
      process.kill(-pid, 'SIGKILL')
    } catch {
      /* Already reaped. */
    }
  }
})

test.each(['queued', 'running', 'cancelling'] as const)(
  'restart settles an interrupted %s setup and permits retry',
  async (state) => {
    const fixture = await withSetup('echo ready', false)
    await fixture.create()
    await settled(fixture)
    const stopped = await stopLifecycleEffects(fixture)
    await stopped.engine.dispatch(
      v.parse(orchestrationCommandSchema, {
        type: 'worktree.setup.update',
        commandId: 'interrupted-setup',
        worktreeId: lifecycleWorktreeId,
        setup: {
          name: 'Install',
          foreground: false,
          state,
          output: ['partial'],
          exitCode: null,
          updatedAt: new Date().toISOString(),
        },
      }),
    )
    await stopped.engine.close()
    await fixture.restart()
    expect((await worktree(fixture))?.setup?.state).toBe(
      state === 'cancelling' ? 'cancelled' : 'failed',
    )
    await fixture.command({ type: 'worktree.setup.run', worktreeId: lifecycleWorktreeId })
    expect((await settled(fixture))?.setup).toMatchObject({ state: 'done', output: ['ready'] })
  },
)

test('restart fails an interrupted foreground creation instead of holding boot for its setup', async () => {
  const fixture = await withSetup('exit 1', true)
  expect((await fixture.create()).lifecycle.state).toBe('creation-failed')
  const stopped = await stopLifecycleEffects(fixture)
  await stopped.engine.dispatchClientCommand({
    type: 'project.meta.update',
    commandId: 'slow-setup',
    projectId: fixture.registration.projectId,
    scripts: [
      { name: 'Install', command: 'sleep 30', runOnWorktreeCreate: true, waitForSetup: true },
    ],
  })
  await stopped.engine.dispatchClientCommand({
    type: 'worktree.retry',
    commandId: 'interrupted-retry',
    worktreeId: lifecycleWorktreeId,
  })
  const pending = (await stopped.engine.readModelSnapshot()).worktrees.get(lifecycleWorktreeId)
  expect(pending?.lifecycle.state).toBe('provisioning')
  await stopped.engine.close()
  const startedAt = performance.now()
  await fixture.restart()
  expect(performance.now() - startedAt).toBeLessThan(10_000)
  expect((await worktree(fixture))?.lifecycle).toMatchObject({
    state: 'creation-failed',
    errorCode: 'worktree.SETUP_FAILED',
  })
  expect(fixture.adapter.startedTurns).toHaveLength(0)
})

test('cancellation owns the setup before the running report completes', async () => {
  const fixture = await worktreeLifecycleFixture()
  fixtures.push(fixture)
  const runner = new SetupRunner()
  const barrier = Promise.withResolvers<void>()
  const running = runner.run(
    lifecycleWorktreeId,
    {
      command: 'echo ran > cancelled-setup',
      worktreePath: fixture.root,
      projectRoot: fixture.root,
    },
    () => barrier.promise,
  )
  await Bun.sleep(30)
  const cancelling = runner.cancel(lifecycleWorktreeId)
  barrier.resolve()
  await cancelling
  expect((await running).state).toBe('cancelled')
  await expect(readFile(path.join(fixture.root, 'cancelled-setup'))).rejects.toThrow()
  await runner.close()
})
