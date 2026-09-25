import { chmod, mkdir, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  gitWorktreeFixture,
  provisionWorktree,
  runGit,
  worktreeA,
  worktreeB,
} from '../../../test/factories/git-worktree'
import { gitWorktreeCreateBodySchema } from '../contracts'
import { gitWorktreeErrors } from '../utils/worktree-errors'
import * as v from 'valibot'

const fixtures: Awaited<ReturnType<typeof gitWorktreeFixture>>[] = []
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.dispose()))
})
async function fixtureRepo() {
  const fixture = await gitWorktreeFixture()
  fixtures.push(fixture)
  return fixture
}

describe('worktree provisioning', () => {
  it('records the local source branch when a tag has the same name', async () => {
    const fixture = await fixtureRepo()
    await runGit(fixture.root, ['tag', 'main'])
    const prepared = await fixture.worktrees.prepareCreate({
      path: fixture.root,
      worktreeId: worktreeA,
    })
    expect(prepared.baseBranch).toBe('main')
    const created = await fixture.worktrees.create({ ...prepared, path: fixture.root })
    expect(created.worktree.commit).toBe(prepared.baseCommit)
  })

  it('uses the full UUID and persisted base even when the base branch moves', async () => {
    const fixture = await fixtureRepo()
    const prepared = await fixture.worktrees.prepareCreate({
      path: fixture.root,
      worktreeId: worktreeA,
    })
    expect(prepared.baseBranch).toBe('main')
    await writeFile(path.join(fixture.root, 'tracked.txt'), 'later\n')
    await runGit(fixture.root, ['commit', '-am', 'base moved'])
    const created = await fixture.worktrees.create({ ...prepared, path: fixture.root })
    expect(created.worktree.absolutePath).toBe(
      path.join(fixture.root, '.git/platform-worktrees', worktreeA),
    )
    expect(created.worktree.branch).toBe(`worktree/${worktreeA}`)
    expect(created.worktree.worktreeId).toBe(worktreeA)
    expect(created.worktree.commit).toBe(prepared.baseCommit)
    expect(await readFile(path.join(created.worktree.absolutePath, 'tracked.txt'), 'utf8')).toBe(
      'one\n',
    )
    expect((await fixture.worktrees.create({ ...prepared, path: fixture.root })).created).toBe(
      false,
    )
  })
  it('starts from a named local branch instead of HEAD, and refuses one that does not exist', async () => {
    const fixture = await fixtureRepo()
    const start = await runGit(fixture.root, ['rev-parse', 'HEAD'])
    await runGit(fixture.root, ['branch', 'release'])
    await writeFile(path.join(fixture.root, 'tracked.txt'), 'later\n')
    await runGit(fixture.root, ['commit', '-am', 'head moved'])
    const prepared = await fixture.worktrees.prepareCreate({
      path: fixture.root,
      worktreeId: worktreeA,
      baseBranch: 'release',
    })
    expect(prepared.baseCommit).toBe(start)
    expect(prepared.baseBranch).toBe('release')
    const created = await fixture.worktrees.create({ ...prepared, path: fixture.root })
    expect(await readFile(path.join(created.worktree.absolutePath, 'tracked.txt'), 'utf8')).toBe(
      'one\n',
    )
    await expect(
      fixture.worktrees.prepareCreate({
        path: fixture.root,
        worktreeId: worktreeB,
        baseBranch: 'absent',
      }),
    ).rejects.toMatchObject({ code: gitWorktreeErrors.WORKTREE_BASE_BRANCH_MISSING.code })
  })
  it('recovers an expected branch and refuses a changed branch without moving it', async () => {
    const fixture = await fixtureRepo()
    const prepared = await fixture.worktrees.prepareCreate({
      path: fixture.root,
      worktreeId: worktreeA,
    })
    await runGit(fixture.root, [
      'update-ref',
      `refs/heads/${prepared.branch}`,
      prepared.baseCommit,
      '0'.repeat(40),
    ])
    expect((await fixture.worktrees.create({ ...prepared, path: fixture.root })).created).toBe(true)
    await expect(
      fixture.worktrees.prepareCreate({ path: fixture.root, worktreeId: worktreeA }),
    ).rejects.toMatchObject({ code: gitWorktreeErrors.WORKTREE_BRANCH_EXISTS.code })
    const other = await fixture.worktrees.prepareCreate({
      path: fixture.root,
      worktreeId: worktreeB,
    })
    await writeFile(path.join(fixture.root, 'tracked.txt'), 'later\n')
    await runGit(fixture.root, ['commit', '-am', 'base moved'])
    await runGit(fixture.root, ['branch', other.branch])
    const collision = await runGit(fixture.root, ['rev-parse', other.branch])
    await expect(fixture.worktrees.create({ ...other, path: fixture.root })).rejects.toMatchObject({
      code: gitWorktreeErrors.WORKTREE_BRANCH_EXISTS.code,
    })
    expect(await runGit(fixture.root, ['rev-parse', other.branch])).toBe(collision)
  })
  it('creates from a linked base through the canonical common directory', async () => {
    const fixture = await fixtureRepo()
    const first = await provisionWorktree(fixture)
    const prepared = await fixture.worktrees.prepareCreate({
      path: first.worktree.absolutePath,
      worktreeId: worktreeB,
    })
    expect(prepared.baseBranch).toBe(first.worktree.branch)
    const second = await fixture.worktrees.create({
      ...prepared,
      path: first.worktree.absolutePath,
    })
    expect(path.dirname(second.worktree.absolutePath)).toBe(
      path.dirname(first.worktree.absolutePath),
    )
    await writeFile(path.join(first.worktree.absolutePath, 'only-a'), 'a')
    expect(await Bun.file(path.join(second.worktree.absolutePath, 'only-a')).exists()).toBe(false)
  })
  it('rejects invalid identifiers before filesystem access', () => {
    expect(
      v.safeParse(gitWorktreeCreateBodySchema, {
        path: '',
        worktreeId: '../../escape',
        branch: 'worktree/a',
        baseCommit: '1'.repeat(40),
      }).success,
    ).toBe(false)
  })
  it('uses the projected immutable base and ignores old branch config', async () => {
    const fixture = await fixtureRepo()
    const created = await provisionWorktree(fixture)
    await writeFile(path.join(created.worktree.absolutePath, 'feature.txt'), 'feature')
    await runGit(created.worktree.absolutePath, ['add', '--all'])
    await runGit(created.worktree.absolutePath, ['commit', '-m', 'feature'])
    await runGit(fixture.root, [
      'config',
      `branch.${created.prepared.branch}.platform-base`,
      'missing',
    ])
    const diff = await fixture.worktrees.branchDiff({
      path: created.worktree.absolutePath,
      baseCommit: created.prepared.baseCommit,
    })
    expect(diff.baseRef).toBe(created.prepared.baseCommit)
    expect(diff.files).toHaveLength(1)
    expect(diff.files[0]?.path).toContain('feature.txt')
    expect(
      (await fixture.worktrees.branchDiff({ path: created.worktree.absolutePath })).baseRef,
    ).toBe('main')
  })
})

describe('guarded worktree removal', () => {
  it('preserves branch and commits after clean removal', async () => {
    const fixture = await fixtureRepo()
    const created = await provisionWorktree(fixture)
    expect(
      (await fixture.worktrees.remove({ ...created.target, mode: 'safe' })).worktrees,
    ).toHaveLength(1)
    expect(await runGit(fixture.root, ['rev-parse', created.prepared.branch])).toBe(
      created.prepared.baseCommit,
    )
    expect(await fixture.worktrees.inspect(created.target)).toEqual({
      pathExists: false,
      adminExists: false,
      worktree: null,
    })
  })
  it('can remove through the target checkout without querying its deleted cwd afterwards', async () => {
    const fixture = await fixtureRepo()
    const created = await provisionWorktree(fixture)
    const removed = await fixture.worktrees.remove({
      ...created.target,
      path: created.worktree.absolutePath,
      mode: 'safe',
    })
    expect(removed.worktrees).toHaveLength(1)
    expect(removed.worktrees[0]?.absolutePath).toBe(fixture.root)
  })

  it('refuses ignored files under safe cleanup and requires fresh force authorization after edits', async () => {
    const fixture = await fixtureRepo()
    const created = await provisionWorktree(fixture)
    await writeFile(path.join(created.worktree.absolutePath, 'ignored.txt'), 'first')
    await expect(
      fixture.worktrees.remove({ ...created.target, mode: 'safe' }),
    ).rejects.toMatchObject({ code: gitWorktreeErrors.WORKTREE_DIRTY.code })
    const preview = await fixture.worktrees.previewRemoval(created.target)
    await writeFile(path.join(created.worktree.absolutePath, 'ignored.txt'), 'other')
    await expect(
      fixture.worktrees.remove({ ...created.target, ...preview, mode: 'discard-changes' }),
    ).rejects.toMatchObject({ code: gitWorktreeErrors.WORKTREE_NEEDS_RECONFIRMATION.code })
    const renewed = await fixture.worktrees.previewRemoval(created.target)
    expect(renewed.expectedStatusFingerprint).not.toBe(preview.expectedStatusFingerprint)
    expect(
      (await fixture.worktrees.remove({ ...created.target, ...renewed, mode: 'discard-changes' }))
        .worktrees,
    ).toHaveLength(1)
  })
  it('fingerprints ignored bytes, modes, symlinks, HEAD, and index', async () => {
    const fixture = await fixtureRepo()
    const created = await provisionWorktree(fixture)
    const checkout = created.worktree.absolutePath
    await mkdir(path.join(checkout, 'ignored-directory'))
    await writeFile(path.join(checkout, 'ignored-directory/file'), 'one')
    await symlink('tracked.txt', path.join(checkout, 'link'))
    const fingerprints = new Set<string>()
    async function remember() {
      fingerprints.add(
        (await fixture.worktrees.previewRemoval(created.target)).expectedStatusFingerprint,
      )
    }
    await remember()
    await writeFile(path.join(checkout, 'ignored-directory/file'), 'two')
    await remember()
    await chmod(path.join(checkout, 'ignored-directory/file'), 0o755)
    await remember()
    await unlink(path.join(checkout, 'link'))
    await symlink('missing.txt', path.join(checkout, 'link'))
    await remember()
    await runGit(checkout, ['add', 'link'])
    await remember()
    await runGit(checkout, ['commit', '-m', 'link'])
    await remember()
    expect(fingerprints.size).toBe(6)
  })
  it('rejects FIFO and unreadable entries instead of approving force', async () => {
    const fixture = await fixtureRepo()
    const created = await provisionWorktree(fixture)
    const entry = path.join(created.worktree.absolutePath, 'special')
    expect(await Bun.spawn(['mkfifo', entry]).exited).toBe(0)
    await expect(fixture.worktrees.previewRemoval(created.target)).rejects.toMatchObject({
      code: gitWorktreeErrors.WORKTREE_UNSAFE_ENTRY.code,
    })
    await unlink(entry)
    await writeFile(entry, 'private')
    await chmod(entry, 0)
    await expect(fixture.worktrees.previewRemoval(created.target)).rejects.toMatchObject({
      code: gitWorktreeErrors.WORKTREE_UNSAFE_ENTRY.code,
    })
    await chmod(entry, 0o600)
  })
  it('protects main, outside paths, mismatched IDs, and unlisted paths', async () => {
    const fixture = await fixtureRepo()
    const created = await provisionWorktree(fixture)
    await expect(
      fixture.worktrees.remove({ ...created.target, worktreePath: fixture.root, mode: 'safe' }),
    ).rejects.toMatchObject({ code: gitWorktreeErrors.WORKTREE_MAIN_PROTECTED.code })
    await expect(
      fixture.worktrees.remove({ ...created.target, worktreeId: worktreeB, mode: 'safe' }),
    ).rejects.toMatchObject({ code: gitWorktreeErrors.WORKTREE_IDENTITY_MISMATCH.code })
    await expect(
      fixture.worktrees.remove({
        ...created.target,
        worktreePath: path.join(fixture.root, 'tracked.txt'),
        mode: 'safe',
      }),
    ).rejects.toMatchObject({ code: gitWorktreeErrors.WORKTREE_NOT_FOUND.code })
    const outside = path.join(fixture.root, 'manual')
    await runGit(fixture.root, ['worktree', 'add', '-b', 'manual', outside])
    await expect(
      fixture.worktrees.remove({ ...created.target, worktreePath: outside, mode: 'safe' }),
    ).rejects.toMatchObject({ code: gitWorktreeErrors.WORKTREE_OUTSIDE_REPOSITORY.code })
  })
  it('requires an explicit legacy target for an adopted basename that differs from its ID', async () => {
    const fixture = await fixtureRepo()
    const created = await provisionWorktree(fixture)
    const legacy = { ...created.target, worktreeId: worktreeB, pathKind: 'legacy' as const }
    expect((await fixture.worktrees.inspect(legacy)).pathExists).toBe(true)
    expect((await fixture.worktrees.remove({ ...legacy, mode: 'safe' })).worktrees).toHaveLength(1)
  })

  it('refuses a managed root replaced by a symlink and a target belonging to another repository', async () => {
    const fixture = await fixtureRepo()
    const foreign = await fixtureRepo()
    const other = await provisionWorktree(foreign)
    await expect(
      fixture.worktrees.inspect({ ...other.target, path: fixture.root }),
    ).rejects.toMatchObject({ code: gitWorktreeErrors.WORKTREE_OUTSIDE_REPOSITORY.code })
    await symlink(
      await foreign.worktrees.managedRoot(foreign.root),
      path.join(fixture.root, '.git/platform-worktrees'),
    )
    await expect(
      fixture.worktrees.prepareCreate({ path: fixture.root, worktreeId: worktreeA }),
    ).rejects.toMatchObject({ code: gitWorktreeErrors.WORKTREE_IDENTITY_MISMATCH.code })
  })

  it('reports missing/prunable administration without pruning other entries', async () => {
    const fixture = await fixtureRepo()
    const created = await provisionWorktree(fixture)
    const other = await provisionWorktree(fixture, worktreeB)
    await rm(created.worktree.absolutePath, { recursive: true })
    const inspected = await fixture.worktrees.inspect(created.target)
    expect(inspected.pathExists).toBe(false)
    expect(inspected.adminExists).toBe(true)
    expect(inspected.worktree?.prunable).toBe(true)
    await expect(
      fixture.worktrees.remove({ ...created.target, mode: 'safe' }),
    ).rejects.toMatchObject({ code: gitWorktreeErrors.WORKTREE_ADMIN_STALE.code })
    expect((await fixture.worktrees.inspect(other.target)).pathExists).toBe(true)
    expect(await runGit(fixture.root, ['worktree', 'list', '--porcelain'])).toContain(
      created.worktree.absolutePath,
    )
  })
  it('never excludes forged Git administration from its fingerprint', async () => {
    const fixture = await fixtureRepo()
    const created = await provisionWorktree(fixture)
    await writeFile(
      path.join(created.worktree.absolutePath, '.git'),
      `gitdir: ${fixture.root}/.git\n`,
    )
    await expect(fixture.worktrees.previewRemoval(created.target)).rejects.toMatchObject({
      code: gitWorktreeErrors.WORKTREE_IDENTITY_MISMATCH.code,
    })
  })
})
