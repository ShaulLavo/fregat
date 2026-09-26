import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { closeTestApps } from '../../../test/server'
import { createOrchestrationFixture, FIXTURE_MODEL } from '../../../test/factories/orchestration'
import {
  lifecycleSessionId,
  lifecycleWorktreeId,
  worktreeLifecycleFixture,
} from '../../../test/factories/worktree-lifecycle'
import { runGit } from '../../testing/git'

const fixtures: Awaited<ReturnType<typeof worktreeLifecycleFixture>>[] = []
const directoryFixtures: Awaited<ReturnType<typeof createOrchestrationFixture>>[] = []
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.dispose()))
  await Promise.all(directoryFixtures.splice(0).map((fixture) => fixture.close()))
  await closeTestApps()
})

test('accepted duplicate intent reuses its receipt before branch checks or HEAD resolution', async () => {
  const fixture = await worktreeLifecycleFixture()
  fixtures.push(fixture)
  const command = {
    type: 'session.create',
    commandId: 'duplicate-create',
    sessionId: lifecycleSessionId,
    worktreeTarget: {
      kind: 'new',
      worktreeId: lifecycleWorktreeId,
      baseWorktreeId: fixture.registration.worktreeId,
    },
    title: 'Duplicate',
    modelSelection: FIXTURE_MODEL,
  }
  const accepted = await Promise.all([
    fixture.engine.dispatchClientCommand(command),
    fixture.engine.dispatchClientCommand(command),
  ])
  expect(accepted.map((result) => result.deduped)).toEqual([false, true])
  await fixture.engine.providerRuntimeIdle()
  const baseCommit = (await fixture.engine.readModelSnapshot()).worktrees.get(
    lifecycleWorktreeId,
  )?.baseCommit
  await writeFile(path.join(fixture.root, 'tracked.txt'), 'new HEAD')
  await runGit(fixture.root, ['commit', '-am', 'move base after acceptance'], { cwdMode: 'option' })
  expect((await fixture.engine.dispatchClientCommand(command)).deduped).toBe(true)
  expect(
    (await fixture.engine.readModelSnapshot()).worktrees.get(lifecycleWorktreeId)?.baseCommit,
  ).toBe(baseCommit)
  await expect(
    fixture.engine.dispatchClientCommand({ ...command, title: 'different intent' }),
  ).rejects.toThrow()
})

test('non-Git new-worktree rejection is durable and leaves current-workspace creation available', async () => {
  const fixture = await createOrchestrationFixture()
  directoryFixtures.push(fixture)
  const registration = await fixture.register()
  if (!registration.result) throw new TypeError('Missing registration')
  const command = {
    type: 'session.create',
    commandId: 'unsupported-new',
    sessionId: lifecycleSessionId,
    worktreeTarget: {
      kind: 'new',
      worktreeId: lifecycleWorktreeId,
      baseWorktreeId: registration.result.worktreeId,
    },
    title: 'Unsupported',
    modelSelection: FIXTURE_MODEL,
  }
  await expect(fixture.engine.dispatchClientCommand(command)).rejects.toThrow()
  expect(
    fixture.sqlite
      .query('select status from orchestration_command_receipts where command_id = ?')
      .get('unsupported-new'),
  ).toEqual({ status: 'rejected' })
  expect((await fixture.engine.shellSnapshot()).sessions).toHaveLength(0)
  await expect(fixture.engine.dispatchClientCommand(command)).rejects.toThrow()
  await fixture.createSession(registration.result.worktreeId)
  expect((await fixture.engine.shellSnapshot()).sessions).toHaveLength(1)
})
