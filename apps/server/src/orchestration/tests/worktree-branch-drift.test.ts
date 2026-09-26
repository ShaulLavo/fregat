import path from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { closeTestApps } from '../../../test/server'
import { runGit } from '../../testing/git'
import {
  lifecycleWorktreeId,
  worktreeLifecycleFixture,
} from '../../../test/factories/worktree-lifecycle'

const fixtures: Awaited<ReturnType<typeof worktreeLifecycleFixture>>[] = []
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.dispose()))
  await closeTestApps()
})

test("an agent's branch checkout in its dedicated worktree becomes the worktree branch at turn end", async () => {
  let worktreePath = ''
  const fixture = await worktreeLifecycleFixture({
    adapter: {
      beforeComplete: async () => {
        await runGit(worktreePath, ['checkout', '-q', '-b', 'agent/feature'], { cwdMode: 'option' })
      },
    },
  })
  fixtures.push(fixture)
  worktreePath = path.join(fixture.root, '.git', 'platform-worktrees', lifecycleWorktreeId)
  const worktree = await fixture.create()
  await fixture.engine.providerRuntimeIdle()
  expect(
    (await fixture.engine.readModelSnapshot()).worktrees.get(lifecycleWorktreeId)?.branch,
  ).toBe('agent/feature')
  expect(worktree.branch).not.toBe(null)
})

test('the shared checkout records a branch switch as checkout metadata only', async () => {
  const fixture = await worktreeLifecycleFixture()
  fixtures.push(fixture)
  await runGit(fixture.root, ['checkout', '-q', '-b', 'elsewhere'], { cwdMode: 'option' })
  await fixture.engine.refreshWorktreeMetadata('')
  const model = await fixture.engine.readModelSnapshot()
  expect(model.worktrees.get(fixture.registration.worktreeId)?.branch).toBe('elsewhere')
})
