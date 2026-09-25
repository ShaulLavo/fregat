import path from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { closeTestApps } from '../../../test/server'
import {
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

test('startup exposes an unprojected checkout whose directory name begins with two dots', async () => {
  const fixture = await worktreeLifecycleFixture()
  fixtures.push(fixture)
  const stopped = await stopLifecycleEffects(fixture)
  const prepared = await stopped.git.prepareCreate({
    path: fixture.root,
    worktreeId: lifecycleWorktreeId,
  })
  await stopped.git.create({ ...prepared, path: fixture.root })
  const target = path.join(path.dirname(prepared.absolutePath), '..dotted-checkout')
  await runGit(fixture.root, ['worktree', 'move', prepared.absolutePath, target], {
    cwdMode: 'option',
  })
  await stopped.engine.close()
  await fixture.restart()

  const orphan = (await fixture.engine.shellSnapshot()).worktrees.find(
    (row) => row.canonicalPath === target,
  )
  expect(orphan).toMatchObject({
    ownership: 'unclaimed',
    lifecycle: { state: 'orphaned', pathKind: 'legacy' },
  })
})
