import { tmpdir } from 'node:os'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { worktreeIdSchema } from '@workspace/contracts'
import * as v from 'valibot'
import { DEFAULT_MAX_TEXT_FILE_BYTES } from '../../src/fs/limits'
import { createWorkspacePaths } from '../../src/fs/path'
import { GitService } from '../../src/git/service'
import { GitWorktreeService } from '../../src/git/worktrees'
import { runGit } from '../../src/testing/git'

export const worktreeA = v.parse(worktreeIdSchema, '10000000-0000-4000-8000-000000000001')
export const worktreeB = v.parse(worktreeIdSchema, '10000000-0000-4000-8000-000000000002')

export async function gitWorktreeFixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'platform-git-worktree-'))
  await runGit(root, ['init', '-b', 'main'])
  await writeFile(path.join(root, 'tracked.txt'), 'one\n')
  await writeFile(path.join(root, '.gitignore'), 'ignored.txt\nignored-directory/\n')
  await runGit(root, ['add', '--all'])
  await runGit(root, ['commit', '-m', 'initial'])
  const git = new GitService(createWorkspacePaths(root), {
    maxTextFileBytes: DEFAULT_MAX_TEXT_FILE_BYTES,
  })
  const worktrees = new GitWorktreeService(git)
  return { root, git, worktrees, dispose: () => rm(root, { recursive: true, force: true }) }
}

export async function provisionWorktree(
  fixture: Awaited<ReturnType<typeof gitWorktreeFixture>>,
  worktreeId = worktreeA,
) {
  const prepared = await fixture.worktrees.prepareCreate({ path: fixture.root, worktreeId })
  const created = await fixture.worktrees.create({ ...prepared, path: fixture.root })
  return {
    prepared,
    ...created,
    target: { path: fixture.root, worktreeId, worktreePath: created.worktree.absolutePath },
  }
}
