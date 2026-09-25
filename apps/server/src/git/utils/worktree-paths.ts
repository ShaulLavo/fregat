import { lstat, readFile, realpath, readdir } from 'node:fs/promises'
import path from 'node:path'
import { nodeErrorCode, worktreeIdSchema } from '@workspace/contracts'
import * as v from 'valibot'
import { relativeInsideRoot } from '../path-utils'
import { gitCommonDirectory } from '../repository-lane'
import type { GitRepositoryRunner } from '../service'
import { gitWorktreeErrors } from './worktree-errors'

export async function managedWorktreesRoot(runner: GitRepositoryRunner) {
  const root = path.join(await gitCommonDirectory(runner), 'platform-worktrees')
  const entry = await maybeStat(root)
  if (!entry) return root
  if (!entry.isDirectory() || entry.isSymbolicLink() || (await realpath(root)) !== root) {
    throw gitWorktreeErrors.WORKTREE_IDENTITY_MISMATCH({
      internal: {
        check: 'managed-root',
        isDirectory: entry.isDirectory(),
        isSymbolicLink: entry.isSymbolicLink(),
        realpathMatches: (await realpath(root)) === root,
      },
    })
  }
  return root
}

export async function managedWorktreePath(runner: GitRepositoryRunner, worktreeId: string) {
  const id = v.parse(worktreeIdSchema, worktreeId)
  return path.join(await managedWorktreesRoot(runner), id)
}

export function worktreeIdForPath(absolutePath: string, root: string) {
  const relative = relativeInsideRoot(root, absolutePath)
  const parsed = v.safeParse(worktreeIdSchema, relative)
  return parsed.success ? parsed.output : null
}

export async function assertManagedPath(runner: GitRepositoryRunner, absolutePath: string) {
  const root = await managedWorktreesRoot(runner)
  const relative = relativeInsideRoot(root, absolutePath)
  if (!relative || relative.includes('/')) {
    throw gitWorktreeErrors.WORKTREE_OUTSIDE_REPOSITORY({
      path: absolutePath,
      internal: { check: 'managed-path', relative: relative ?? null },
    })
  }
  const entry = await maybeStat(absolutePath)
  if (!entry) return
  if (
    !entry.isDirectory() ||
    entry.isSymbolicLink() ||
    (await realpath(absolutePath)) !== absolutePath
  ) {
    throw gitWorktreeErrors.WORKTREE_IDENTITY_MISMATCH({
      internal: {
        check: 'managed-path-entry',
        isDirectory: entry.isDirectory(),
        isSymbolicLink: entry.isSymbolicLink(),
        realpathMatches: (await realpath(absolutePath)) === absolutePath,
      },
    })
  }
}

export async function verifyWorktreeAdministration(runner: GitRepositoryRunner, checkout: string) {
  const common = await gitCommonDirectory(runner)
  const pointer = path.join(checkout, '.git')
  const pointerStat = await lstat(pointer)
  if (!pointerStat.isFile() || pointerStat.isSymbolicLink()) {
    throw gitWorktreeErrors.WORKTREE_IDENTITY_MISMATCH({
      internal: {
        check: 'git-pointer',
        isFile: pointerStat.isFile(),
        isSymbolicLink: pointerStat.isSymbolicLink(),
      },
    })
  }
  const contents = await readFile(pointer, 'utf8')
  const match = /^gitdir: ([^\n]+)\n?$/.exec(contents)
  if (!match?.[1])
    throw gitWorktreeErrors.WORKTREE_IDENTITY_MISMATCH({
      internal: { check: 'gitdir-line', contentLength: contents.length },
    })
  const admin = await realpath(path.resolve(checkout, match[1]))
  const relative = relativeInsideRoot(path.join(common, 'worktrees'), admin)
  if (!relative || relative.includes('/'))
    throw gitWorktreeErrors.WORKTREE_IDENTITY_MISMATCH({
      internal: { check: 'admin-inside-common', relative: relative ?? null },
    })
  const backlink = await readFile(path.join(admin, 'gitdir'), 'utf8')
  const adminCommon = await readFile(path.join(admin, 'commondir'), 'utf8')
  if (
    path.resolve(admin, backlink.trimEnd()) !== pointer ||
    (await realpath(path.resolve(admin, adminCommon.trim()))) !== common
  ) {
    throw gitWorktreeErrors.WORKTREE_IDENTITY_MISMATCH({
      internal: {
        check: 'admin-backlink',
        backlinkMatches: path.resolve(admin, backlink.trimEnd()) === pointer,
        commonMatches: (await realpath(path.resolve(admin, adminCommon.trim()))) === common,
      },
    })
  }
  const observed = await gitCommonDirectory({
    rootAbsolutePath: checkout,
    run: (args) => runner.run(['-C', checkout, ...args]),
  })
  if (observed !== common) {
    throw gitWorktreeErrors.WORKTREE_IDENTITY_MISMATCH({
      internal: { check: 'observed-common-dir' },
    })
  }
}

export async function hasWorktreeAdministration(runner: GitRepositoryRunner, checkout: string) {
  const root = path.join(await gitCommonDirectory(runner), 'worktrees')
  const administration = await maybeStat(root)
  if (!administration) return false
  if (
    !administration.isDirectory() ||
    administration.isSymbolicLink() ||
    (await realpath(root)) !== root
  ) {
    throw gitWorktreeErrors.WORKTREE_IDENTITY_MISMATCH({
      internal: {
        check: 'admin-root',
        isDirectory: administration.isDirectory(),
        isSymbolicLink: administration.isSymbolicLink(),
        realpathMatches: (await realpath(root)) === root,
      },
    })
  }
  const entries = await readdir(root, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory())
      throw gitWorktreeErrors.WORKTREE_IDENTITY_MISMATCH({
        internal: { check: 'admin-entry', entryName: entry.name },
      })
    const admin = path.join(root, entry.name)
    const pointer = await readFile(path.join(admin, 'gitdir'), 'utf8')
    if (path.resolve(admin, pointer.trimEnd()) === path.join(checkout, '.git')) return true
  }
  return false
}

export async function maybeStat(target: string) {
  try {
    return await lstat(target)
  } catch (error) {
    if (nodeErrorCode(error) === 'ENOENT') return null
    throw error
  }
}
