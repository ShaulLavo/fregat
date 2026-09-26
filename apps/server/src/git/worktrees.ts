import path from 'node:path'
import * as v from 'valibot'
import type { WorktreeSubmoduleMode } from '@workspace/contracts'
import { recordRequestContext } from '../observability'
import {
  gitWorktreeCreateBodySchema,
  gitWorktreePrepareBodySchema,
  gitWorktreeRemoveBodySchema,
  gitWorktreeTargetSchema,
  type GitBranchDiffQuery,
  type GitWorktreeCreateBody,
  type GitWorktreePrepareBody,
  type GitWorktreeRemoveBody,
  type GitWorktreeTarget,
} from './contracts'
import type { GitRepositoryRunner, GitService } from './service'
import type {
  GitBaseRefChoicesResult,
  GitBranchDiffResult,
  GitWorktree,
  GitWorktreeCreateResult,
  GitWorktreeRemoveResult,
} from './types'
import { baseRefCandidates, baseRefChoiceId, buildBaseRefChoices } from './utils/base-refs'
import { gitWorktreeErrors } from './utils/worktree-errors'
import { removalPreview } from './utils/worktree-fingerprint'
import {
  assertManagedPath,
  hasWorktreeAdministration,
  managedWorktreePath,
  managedWorktreesRoot,
  maybeStat,
  verifyWorktreeAdministration,
  worktreeIdForPath,
} from './utils/worktree-paths'
import { gitCommonDirectory, withGitRepositoryLane } from './repository-lane'
import { parseWorktreeList } from './worktree-list'

export class GitWorktreeService {
  private readonly git: GitService

  constructor(git: GitService) {
    this.git = git
  }

  async withRepositoryLane<T>(input: string, action: () => Promise<T>): Promise<T> {
    const runner = await this.git.repositoryRunner(input)
    return withGitRepositoryLane(await gitCommonDirectory(runner), action)
  }

  async commonDirectory(input: string) {
    return gitCommonDirectory(await this.git.repositoryRunner(input))
  }

  async managedRoot(input: string) {
    return managedWorktreesRoot(await this.git.repositoryRunner(input))
  }

  async metadata(input: { path: string }) {
    const runner = await this.git.repositoryRunner(input.path)
    const head = await runner.run(['rev-parse', '--verify', 'HEAD'], { allowFailure: true })
    return {
      branch: await this.headBranch(runner),
      headCommit: head.exitCode === 0 ? head.stdout.trim() : null,
    }
  }

  async list(input = ''): Promise<GitWorktree[]> {
    recordWorktreeOperation('worktree_list', input)
    const worktrees = await this.entries(input)
    recordRequestContext({ git: { worktreeCount: worktrees.length } })
    return worktrees
  }

  /** `list` without request logging: reactors call this inside other requests' wide events. */
  async entries(input = ''): Promise<GitWorktree[]> {
    return this.worktrees(await this.git.repositoryRunner(input))
  }

  async prepareCreate(input: GitWorktreePrepareBody) {
    const body = v.parse(gitWorktreePrepareBodySchema, input)
    return this.withRepositoryLane(body.path, async () => {
      const runner = await this.git.repositoryRunner(body.path)
      const branch = `worktree/${body.worktreeId}`
      await runner.run(['check-ref-format', '--branch', branch])
      if (await this.refExists(runner, `refs/heads/${branch}`))
        throw gitWorktreeErrors.WORKTREE_BRANCH_EXISTS({
          internal: { at: 'prepare', branch, worktreeId: body.worktreeId },
        })
      const baseBranch = body.baseBranch ?? (await this.headBranch(runner))
      const head = await this.baseCommit(runner, { ...body, baseBranch: baseBranch ?? undefined })
      const absolutePath = await managedWorktreePath(runner, body.worktreeId)
      if (
        (await maybeStat(absolutePath)) ||
        (await hasWorktreeAdministration(runner, absolutePath))
      ) {
        throw gitWorktreeErrors.WORKTREE_IDENTITY_MISMATCH({
          internal: { at: 'prepare', reason: 'path-occupied', worktreeId: body.worktreeId },
        })
      }
      return { worktreeId: body.worktreeId, absolutePath, branch, baseBranch, baseCommit: head }
    })
  }

  private async baseCommit(
    runner: GitRepositoryRunner,
    body: v.InferOutput<typeof gitWorktreePrepareBodySchema>,
  ) {
    if (!body.baseBranch) return (await runner.run(['rev-parse', '--verify', 'HEAD'])).stdout.trim()
    const ref = `refs/heads/${body.baseBranch}`
    await runner.run(['check-ref-format', ref])
    const resolved = await runner.run(
      ['rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`],
      { allowFailure: true },
    )
    if (resolved.exitCode !== 0)
      throw gitWorktreeErrors.WORKTREE_BASE_BRANCH_MISSING({
        branch: body.baseBranch,
        internal: { at: 'prepare', worktreeId: body.worktreeId, exitCode: resolved.exitCode },
      })
    return resolved.stdout.trim()
  }

  async create(input: GitWorktreeCreateBody): Promise<GitWorktreeCreateResult> {
    const body = v.parse(gitWorktreeCreateBodySchema, input)
    return this.withRepositoryLane(body.path, () => this.createCheckout(body))
  }

  updateSubmodules(worktreePath: string, mode: WorktreeSubmoduleMode) {
    return this.git.updateSubmodules(worktreePath, mode)
  }

  async previewRemoval(input: GitWorktreeTarget) {
    const body = v.parse(gitWorktreeTargetSchema, input)
    return this.withRepositoryLane(body.path, async () => {
      const runner = await this.git.repositoryRunner(body.path)
      const target = await this.removableWorktree(runner, body)
      return removalPreview(runner, target.absolutePath)
    })
  }

  async remove(input: GitWorktreeRemoveBody): Promise<GitWorktreeRemoveResult> {
    const body = v.parse(gitWorktreeRemoveBodySchema, input)
    return this.withRepositoryLane(body.path, () => this.removeCheckout(body))
  }

  async inspect(input: GitWorktreeTarget) {
    const body = v.parse(gitWorktreeTargetSchema, input)
    return this.withRepositoryLane(body.path, async () => {
      const runner = await this.git.repositoryRunner(body.path)
      const absolutePath = this.targetPath(runner, body.worktreePath)
      await assertManagedPath(runner, absolutePath)
      const worktree =
        (await this.worktrees(runner)).find((entry) => entry.absolutePath === absolutePath) ?? null
      const pathExists = (await maybeStat(absolutePath)) !== null
      const adminExists =
        worktree !== null || (await hasWorktreeAdministration(runner, absolutePath))
      if (pathExists && worktree) await verifyWorktreeAdministration(runner, absolutePath)
      this.verifyTargetIdentity(body, worktree)
      return { pathExists, adminExists, worktree }
    })
  }

  async branchDiff(query: GitBranchDiffQuery): Promise<GitBranchDiffResult> {
    recordWorktreeOperation('branch_diff', query.path, { base: query.baseCommit ?? query.base })
    const runner = await this.git.repositoryRunner(query.path)
    const headBranch = await this.headBranch(runner)
    const baseRef = await this.requiredBaseRef(runner, headBranch, query.baseCommit ?? query.base)
    const mergeBase = query.baseCommit ? baseRef : await this.mergeBase(runner, baseRef)
    const files = await this.git.diffRefs({
      newRef: 'HEAD',
      oldRef: mergeBase ?? baseRef,
      path: runner.rootPath,
    })
    recordRequestContext({ git: { baseRef, diffCount: files.length, mergeBase } })
    return { baseRef, files, headRef: headBranch ?? 'HEAD', mergeBase }
  }

  async baseRefs(input = ''): Promise<GitBaseRefChoicesResult> {
    recordWorktreeOperation('base_refs', input)
    const runner = await this.git.repositoryRunner(input)
    const remoteNames = await this.remoteNames(runner)
    const [localBranches, remoteBranches] = await Promise.all([
      this.refNames(runner, 'refs/heads'),
      this.refNames(runner, 'refs/remotes'),
    ])
    const choices = buildBaseRefChoices(
      localBranches,
      // `<remote>/HEAD` is a symref onto another entry in the same list, so
      // offering it would put the default branch in the picker twice.
      remoteBranches.filter((branch) => !branch.endsWith('/HEAD')),
      remoteNames,
    )
    const defaultRef = await this.findBaseRef(runner, await this.headBranch(runner))
    recordRequestContext({ git: { branchCount: choices.length } })

    return { choices, defaultChoiceId: baseRefChoiceId(choices, defaultRef) }
  }

  private async createCheckout(body: GitWorktreeCreateBody): Promise<GitWorktreeCreateResult> {
    recordWorktreeOperation('worktree_create', body.path, { worktreeId: body.worktreeId })
    const runner = await this.git.repositoryRunner(body.path)
    if (body.branch !== `worktree/${body.worktreeId}`)
      throw gitWorktreeErrors.WORKTREE_IDENTITY_MISMATCH({
        internal: {
          at: 'create',
          reason: 'branch-name',
          observed: body.branch,
          expected: `worktree/${body.worktreeId}`,
        },
      })
    const absolutePath = await managedWorktreePath(runner, body.worktreeId)
    await assertManagedPath(runner, absolutePath)
    await this.assertRefExists(runner, body.baseCommit)
    const existing = (await this.worktrees(runner)).find(
      (entry) => entry.absolutePath === absolutePath,
    )
    if (existing) {
      await this.verifyCreated(runner, existing, body)
      return { created: false, worktree: existing }
    }
    if (
      (await maybeStat(absolutePath)) ||
      (await hasWorktreeAdministration(runner, absolutePath))
    ) {
      throw gitWorktreeErrors.WORKTREE_IDENTITY_MISMATCH({
        internal: { at: 'create', reason: 'path-occupied', worktreeId: body.worktreeId },
      })
    }
    await this.createBranch(runner, body)
    await runner.run(['worktree', 'add', '--', absolutePath, body.branch])
    const worktree = (await this.worktrees(runner)).find(
      (entry) => entry.absolutePath === absolutePath,
    )
    if (!worktree)
      throw gitWorktreeErrors.WORKTREE_NOT_FOUND({
        path: absolutePath,
        internal: { at: 'create', reason: 'absent-after-add', worktreeId: body.worktreeId },
      })
    await this.verifyCreated(runner, worktree, body)
    return { created: true, worktree }
  }

  private async createBranch(runner: GitRepositoryRunner, body: GitWorktreeCreateBody) {
    const ref = `refs/heads/${body.branch}`
    await runner.run(['check-ref-format', ref])
    const created = await runner.run(
      ['update-ref', ref, body.baseCommit, '0'.repeat(body.baseCommit.length)],
      { allowFailure: true },
    )
    if (created.exitCode === 0) return
    const current = await runner.run(['rev-parse', '--verify', ref], { allowFailure: true })
    if (current.exitCode !== 0 || current.stdout.trim() !== body.baseCommit) {
      throw gitWorktreeErrors.WORKTREE_BRANCH_EXISTS({
        internal: {
          at: 'create-branch',
          ref,
          exitCode: current.exitCode,
          observedCommit: current.stdout.trim(),
          expectedCommit: body.baseCommit,
        },
      })
    }
  }

  private async verifyCreated(
    runner: GitRepositoryRunner,
    worktree: GitWorktree,
    body: GitWorktreeCreateBody,
  ) {
    if (
      worktree.main ||
      worktree.branch !== body.branch ||
      worktree.commit !== body.baseCommit ||
      worktree.prunable
    ) {
      throw gitWorktreeErrors.WORKTREE_IDENTITY_MISMATCH({
        internal: {
          at: 'verify-created',
          observed: {
            branch: worktree.branch,
            commit: worktree.commit,
            prunable: worktree.prunable,
            worktreeId: worktree.worktreeId,
          },
          expected: { branch: body.branch, commit: body.baseCommit, prunable: false },
        },
      })
    }
    await verifyWorktreeAdministration(runner, worktree.absolutePath)
  }

  private async removeCheckout(body: GitWorktreeRemoveBody): Promise<GitWorktreeRemoveResult> {
    recordWorktreeOperation('worktree_remove', body.path, {
      worktreeId: body.worktreeId,
      mode: body.mode,
    })
    const source = await this.git.repositoryRunner(body.path)
    const target = await this.removableWorktree(source, body)
    const runner = await this.survivingRemovalRunner(source, target)
    const preview = await removalPreview(runner, target.absolutePath)
    recordRequestContext({ git: { changedFileCount: preview.changedFileCount } })
    if (body.mode === 'safe' && preview.changedFileCount > 0) {
      throw gitWorktreeErrors.WORKTREE_DIRTY({
        fileCount: preview.changedFileCount,
        path: target.absolutePath,
        internal: { mode: body.mode, expectedHead: preview.expectedHead },
      })
    }
    if (
      body.mode === 'discard-changes' &&
      (body.expectedHead !== preview.expectedHead ||
        body.expectedStatusFingerprint !== preview.expectedStatusFingerprint)
    ) {
      throw gitWorktreeErrors.WORKTREE_NEEDS_RECONFIRMATION({
        internal: {
          headMoved: body.expectedHead !== preview.expectedHead,
          statusMoved: body.expectedStatusFingerprint !== preview.expectedStatusFingerprint,
          observedHead: preview.expectedHead,
          confirmedHead: body.expectedHead,
        },
      })
    }
    const force = body.mode === 'discard-changes' ? ['--force'] : []
    await runner.run(['worktree', 'remove', ...force, '--', target.absolutePath])
    return { removed: target, worktrees: await this.worktrees(runner) }
  }

  private async survivingRemovalRunner(source: GitRepositoryRunner, target: GitWorktree) {
    if (source.rootAbsolutePath !== target.absolutePath) return source
    for (const candidate of await this.worktrees(source)) {
      if (
        candidate.absolutePath === target.absolutePath ||
        !(await maybeStat(candidate.absolutePath))
      )
        continue
      return this.git.repositoryRunner(candidate.absolutePath)
    }
    throw gitWorktreeErrors.WORKTREE_IDENTITY_MISMATCH({
      internal: { at: 'surviving-removal-runner', reason: 'no-surviving-checkout' },
    })
  }

  private async removableWorktree(runner: GitRepositoryRunner, body: GitWorktreeTarget) {
    const absolutePath = this.targetPath(runner, body.worktreePath)
    const target = (await this.worktrees(runner)).find(
      (entry) => entry.absolutePath === absolutePath,
    )
    if (!target)
      throw gitWorktreeErrors.WORKTREE_NOT_FOUND({
        path: absolutePath,
        internal: { at: 'removable', worktreeId: body.worktreeId, pathKind: body.pathKind },
      })
    if (target.main)
      throw gitWorktreeErrors.WORKTREE_MAIN_PROTECTED({
        path: absolutePath,
        internal: { at: 'removable', worktreeId: body.worktreeId },
      })
    await assertManagedPath(runner, absolutePath)
    this.verifyTargetIdentity(body, target)
    if (!(await maybeStat(absolutePath)) || target.prunable)
      throw gitWorktreeErrors.WORKTREE_ADMIN_STALE({
        internal: { at: 'removable', prunable: target.prunable, worktreeId: body.worktreeId },
      })
    await verifyWorktreeAdministration(runner, absolutePath)
    return target
  }

  private verifyTargetIdentity(body: GitWorktreeTarget, target: GitWorktree | null) {
    if (!target || body.pathKind === 'legacy') return
    if (target.worktreeId !== body.worktreeId)
      throw gitWorktreeErrors.WORKTREE_IDENTITY_MISMATCH({
        internal: {
          at: 'verify-target',
          reason: 'worktree-id',
          observed: target.worktreeId,
          expected: body.worktreeId,
        },
      })
  }

  private targetPath(runner: GitRepositoryRunner, input: string) {
    if (path.isAbsolute(input)) return path.normalize(input)
    return runner.resolveWorkspacePath(input).absolutePath
  }

  private async worktrees(runner: GitRepositoryRunner): Promise<GitWorktree[]> {
    const result = await runner.run(['worktree', 'list', '--porcelain', '-z'])
    const managedRoot = await managedWorktreesRoot(runner)
    return parseWorktreeList(result.stdout).map((parsed, index) => ({
      absolutePath: parsed.absolutePath,
      branch: parsed.branch,
      commit: parsed.commit,
      detached: parsed.detached,
      locked: parsed.locked,
      main: index === 0,
      path: runner.toWorkspacePath(parsed.absolutePath),
      prunable: parsed.prunable,
      worktreeId: worktreeIdForPath(parsed.absolutePath, managedRoot),
    }))
  }

  private async requiredBaseRef(
    runner: GitRepositoryRunner,
    headBranch: string | null,
    base?: string,
  ) {
    if (base) {
      await this.assertRefExists(runner, base)
      return base
    }

    const resolved = await this.findBaseRef(runner, headBranch)
    if (resolved) return resolved

    throw gitWorktreeErrors.WORKTREE_BASE_UNRESOLVED({
      headBranch: headBranch ?? 'HEAD',
      internal: { remotes: await this.remoteNames(runner) },
    })
  }

  private async findBaseRef(runner: GitRepositoryRunner, headBranch: string | null) {
    const remoteNames = await this.remoteNames(runner)
    const primaryRemote = remoteNames[0] ?? null
    const candidates = baseRefCandidates({
      defaultBranch: await this.remoteDefaultBranch(runner, primaryRemote),
      headBranch,
      remoteNames,
    })

    for (const candidate of candidates) {
      const remoteRef = primaryRemote ? `${primaryRemote}/${candidate}` : null
      if (remoteRef && (await this.refExists(runner, remoteRef))) return remoteRef
      if (await this.refExists(runner, candidate)) return candidate
    }

    return null
  }

  private async remoteDefaultBranch(runner: GitRepositoryRunner, remote: string | null) {
    if (!remote) return null

    const result = await runner.run(['rev-parse', '--abbrev-ref', `${remote}/HEAD`], {
      allowFailure: true,
    })
    if (result.exitCode !== 0) return null

    return result.stdout.trim() || null
  }

  /** `origin` first when it exists — the branch's eventual destination. */
  private async remoteNames(runner: GitRepositoryRunner) {
    const result = await runner.run(['remote'], { allowFailure: true })
    const names = result.stdout.split(/\r?\n/).filter(Boolean)

    return names.sort((left, right) => Number(right === 'origin') - Number(left === 'origin'))
  }

  private async refNames(runner: GitRepositoryRunner, namespace: string) {
    const result = await runner.run(['for-each-ref', '--format=%(refname:short)', namespace])

    return result.stdout.split(/\r?\n/).filter(Boolean)
  }

  private async headBranch(runner: GitRepositoryRunner) {
    const result = await runner.run(['rev-parse', '--symbolic-full-name', 'HEAD'], {
      allowFailure: true,
    })
    const ref = result.stdout.trim()
    if (result.exitCode !== 0 || !ref.startsWith('refs/heads/')) return null

    return ref.slice('refs/heads/'.length)
  }

  private async mergeBase(runner: GitRepositoryRunner, baseRef: string) {
    const result = await runner.run(['merge-base', baseRef, 'HEAD'], { allowFailure: true })
    if (result.exitCode !== 0) return null

    return result.stdout.trim() || null
  }

  private async assertRefExists(runner: GitRepositoryRunner, ref: string) {
    if (await this.refExists(runner, ref)) return

    throw gitWorktreeErrors.WORKTREE_BASE_NOT_FOUND({ base: ref, internal: { ref } })
  }

  private async refExists(runner: GitRepositoryRunner, ref: string) {
    // Peeling to a commit closes the same hole `diffRefs` closes: without it a
    // ref-shaped string can be accepted here and read as a pathspec later.
    const result = await runner.run(
      ['rev-parse', '--verify', '--quiet', '--end-of-options', `${ref}^{commit}`],
      {
        allowFailure: true,
      },
    )

    return result.exitCode === 0
  }
}

function recordWorktreeOperation(
  operation: string,
  worktreePath = '',
  fields: Record<string, unknown> = {},
) {
  recordRequestContext({
    area: 'git',
    git: { operation, path: worktreePath, ...fields },
    operation,
  })
}
