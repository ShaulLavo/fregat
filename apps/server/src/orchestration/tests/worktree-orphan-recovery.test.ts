import { readFile, stat } from 'node:fs/promises'
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

test.each(['id-derived', 'legacy'] as const)(
  'startup exposes %s unprojected checkout and requires adoption before cleanup',
  async (pathKind) => {
    const fixture = await worktreeLifecycleFixture()
    fixtures.push(fixture)
    const stopped = await stopLifecycleEffects(fixture)
    const prepared = await stopped.git.prepareCreate({
      path: fixture.root,
      worktreeId: lifecycleWorktreeId,
    })
    await stopped.git.create({ ...prepared, path: fixture.root })
    const target =
      pathKind === 'legacy'
        ? path.join(path.dirname(prepared.absolutePath), 'legacy-checkout')
        : prepared.absolutePath
    if (pathKind === 'legacy')
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
      lifecycle: { state: 'orphaned', pathKind },
    })
    if (!orphan) throw new TypeError('Missing orphan')
    await expect(
      fixture.command({ type: 'worktree.cleanup', worktreeId: orphan.id }),
    ).rejects.toThrow()
    expect(await readFile(path.join(target, 'tracked.txt'), 'utf8')).toBe('initial\n')
    await fixture.command({ type: 'worktree.adopt', worktreeId: orphan.id })
    expect((await fixture.engine.readModelSnapshot()).worktrees.get(orphan.id)).toMatchObject({
      ownership: 'platform',
      baseCommit: prepared.baseCommit,
      lifecycle: { state: 'ready' },
    })
    await fixture.command({ type: 'worktree.cleanup', worktreeId: orphan.id })
    await fixture.engine.providerRuntimeIdle()
    await expect(stat(target)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(
      (
        await runGit(fixture.root, ['rev-parse', `refs/heads/${prepared.branch}`], {
          cwdMode: 'option',
        })
      ).stdout.trim(),
    ).toBe(prepared.baseCommit)
  },
)
