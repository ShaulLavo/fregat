import { isString } from '@workspace/utils/objects'
import { elapsedMs } from '@workspace/utils/timing'
import { readFile, realpath, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { FsError } from '../fs/errors'
import type { WorkspacePath, WorkspacePaths } from '../fs/path'
import { toPosix } from '../fs/path'
import { limitText, recordGitCommand, recordRequestContext } from '../observability'
import type {
  GitBranchRemoteState,
  GitCommitProgressEvent,
  GitPullRequestCreateResult,
  GitPullRequestState,
  GitPublishRequest,
  GitPublishResult,
  GitPushResult,
  WorktreeSubmoduleMode,
} from '@workspace/contracts'
import { withGitRepositoryLane, withGitRepositoryLaneStream } from './repository-lane'
import { parseBranches } from './branches'
import { commandOutput, gitErrorMessage } from './command'
import { commitMessageTemplate, hasCommitMessageText } from './commit-message'
import type {
  GitApplyPatchBody,
  GitBlobDiffQuery,
  GitCheckoutBody,
  GitCommitBody,
  GitCreatePullRequestBody,
  GitCreateBranchBody,
  GitPathsBody,
} from './contracts'
import { parseDiff, rewriteBlobPatchPaths } from './diff'
import {
  createForgeRepository,
  createPullRequest,
  readPullRequest,
  type ForgeBoundaries,
} from './pull-request'
import {
  mutationPaths,
  pathspecArgs,
  relativeInsideRoot,
  repositoryRelativePath,
} from './path-utils'
import { gitCwdForPath, lexicalRepositoryRoot } from './repository'
import { parseNumstat, untrackedLineStats, withLineStats } from './numstat'
import { parseRepositoryInfo, parseStatus, statusMatchesPathspec } from './status'
import { UpstreamFetchScheduler } from './upstream-fetch'
import { AutoPull, type AutoPullPolicy } from './auto-pull'
import { cloneRepository } from './clone'
import {
  hasSubmodules,
  SUBMODULE_UPDATE_OPTIONS,
  submoduleUpdateArgs,
  uninitializedSubmoduleCount,
} from './submodules'
import { BoundedTtlCache } from './utils/bounded-cache'
import { gitPullRequestErrors } from './utils/pull-request-errors'
import { conflictSummary, pullFailureReason } from './utils/pull-failure'
import {
  MAX_OUTPUT_BYTES,
  processLimitError,
  runProcess,
  streamProcess,
  type GitProcessResult,
} from './utils/process'
import type {
  GitBranchesResult,
  GitCommandResult,
  GitCommitResult,
  GitFileDiff,
  GitFileStatus,
  GitLineStat,
  GitRepository,
  GitRepositoryInfo,
  GitStatusResult,
} from './types'

export type {
  GitBranchesResult,
  GitCommitResult,
  GitFileDiff,
  GitRepositoryInfo,
  GitStatusResult,
} from './types'

type GitRepositoryLocation = Omit<GitRepository, 'info'>

/** The part of a repository's identity that costs a `git` process to learn. */
type GitRepositoryRoot = {
  rootAbsolutePath: string
  rootDisplayAbsolutePath: string
}

type GitServiceOptions = {
  autoPullPolicy?: AutoPullPolicy
  /** The forge CLIs and HTTP APIs; tests replace them, production spawns and fetches. */
  forgeBoundaries?: ForgeBoundaries
  diffConcurrency?: number
  maxCommandOutputBytes?: number
  maxTextFileBytes: number
  now?: () => number
  repositoryCacheTtlMs?: number
  statusCacheTtlMs?: number
}

type GitCommandOptions = {
  allowFailure?: boolean
  env?: Readonly<Record<string, string>>
  input?: string
  maxOutputBytes?: number
  timeoutMs?: number
}

type GitRunOptions = Pick<GitCommandOptions, 'allowFailure' | 'env' | 'input'>

/**
 * A git command runner already bound to one resolved repository root. It is the
 * seam the checkpoint store and the worktree service need: both drive plumbing
 * (`read-tree`, `commit-tree`, `worktree list`) that has no business being a
 * public verb on `GitService`, yet must run through the same bounded process
 * wrapper and the same workspace-containment checks as every other git call.
 */
export type GitRepositoryRunner = {
  readonly rootAbsolutePath: string
  /** The lexical root — the one workspace-relative paths are anchored on. */
  readonly rootDisplayAbsolutePath: string
  readonly rootPath: string
  resolveWorkspacePath: (input: string) => WorkspacePath
  run: (args: readonly string[], options?: GitRunOptions) => Promise<GitCommandResult>
  /** Workspace-relative form of an absolute path, or null when it is outside. */
  toWorkspacePath: (absolutePath: string) => string | null
}

const DEFAULT_DIFF_CONCURRENCY = 4

/**
 * Status is polled by every open pane and re-read after every mutation, so the
 * window only has to be wide enough to collapse one burst of callers into one
 * `git status`. A second of staleness is invisible; a longer one would outlive
 * the edit that caused the poll.
 */
const STATUS_CACHE_TTL_MS = 1_000
const STATUS_CACHE_CAPACITY = 2_048

/**
 * Where a path's repository root is barely changes, and the answers are tiny.
 * A miss is cached for the same minute as a hit so a workspace full of
 * non-repository folders cannot turn every poll into a `rev-parse`.
 */
const REPOSITORY_CACHE_TTL_MS = 60_000
const REPOSITORY_CACHE_CAPACITY = 512

/**
 * Verbs that cannot change what `git status` reports. `hash-object -w` is in
 * here because it only adds a loose object; the index and the worktree are
 * untouched. Everything absent from this set invalidates.
 */
const READ_ONLY_GIT_ACTIONS = new Set([
  'cat-file',
  'check-ref-format',
  'merge-base',
  'diff',
  'diff-tree',
  'for-each-ref',
  'hash-object',
  'log',
  'ls-files',
  'rev-parse',
  'show',
  'status',
])

type CommitPlan =
  | { readonly kind: 'run'; readonly args: readonly string[] }
  | { readonly kind: 'settled'; readonly result: GitCommitResult }

export class GitService {
  private readonly mutationListeners = new Set<(path: string) => Promise<void>>()
  private readonly paths: WorkspacePaths
  private readonly diffConcurrency: number
  private readonly maxCommandOutputBytes: number
  private readonly maxTextFileBytes: number
  private readonly repositoryRoots: BoundedTtlCache<GitRepositoryRoot | null>
  private readonly statuses: BoundedTtlCache<GitStatusResult>
  private readonly upstreamFetch: UpstreamFetchScheduler
  private readonly autoPull: AutoPull | null
  private readonly forgeBoundaries: ForgeBoundaries

  constructor(paths: WorkspacePaths, options: GitServiceOptions) {
    this.paths = paths
    this.diffConcurrency = positiveInteger(options.diffConcurrency, DEFAULT_DIFF_CONCURRENCY)
    this.maxCommandOutputBytes = positiveInteger(options.maxCommandOutputBytes, MAX_OUTPUT_BYTES)
    this.maxTextFileBytes = options.maxTextFileBytes
    this.repositoryRoots = new BoundedTtlCache({
      capacity: REPOSITORY_CACHE_CAPACITY,
      now: options.now,
      ttlMs: options.repositoryCacheTtlMs ?? REPOSITORY_CACHE_TTL_MS,
    })
    this.statuses = new BoundedTtlCache({
      capacity: STATUS_CACHE_CAPACITY,
      now: options.now,
      ttlMs: options.statusCacheTtlMs ?? STATUS_CACHE_TTL_MS,
    })
    this.upstreamFetch = new UpstreamFetchScheduler({
      resolveCommonDir: async (rootAbsolutePath) => {
        const result = await this.git(rootAbsolutePath, ['rev-parse', '--git-common-dir'])
        return path.resolve(rootAbsolutePath, result.stdout.trim())
      },
      runFetch: async (rootAbsolutePath, remote) => {
        await this.git(rootAbsolutePath, ['fetch', remote])
      },
    })
    this.forgeBoundaries = options.forgeBoundaries ?? {}
    this.autoPull = options.autoPullPolicy
      ? new AutoPull({
          policy: options.autoPullPolicy,
          run: (root, args, runOptions) => this.git(root, args, runOptions),
          onSettled: (root) => this.invalidateStatus(root),
        })
      : null
  }

  subscribeMutations(listener: (path: string) => Promise<void>) {
    this.mutationListeners.add(listener)
    return () => this.mutationListeners.delete(listener)
  }

  private async notifyMutation(cwd: string) {
    await Promise.all([...this.mutationListeners].map((listener) => listener(cwd)))
  }

  private async commonDirectory(cwd: string) {
    const result = await this.git(cwd, ['rev-parse', '--git-common-dir'])
    return realpath(path.resolve(cwd, result.stdout.trim()))
  }

  async repo(input = '') {
    recordGitServiceOperation('repo', input)
    const repository = await this.resolveRepository(input)
    return { repository: repository?.info ?? null }
  }

  async remoteUrl(root: string, remote: 'origin') {
    const repository = await this.requiredRepositoryLocation(root)
    const result = await this.git(repository.rootAbsolutePath, ['remote', 'get-url', remote], {
      allowFailure: true,
    })
    if (result.exitCode !== 0) return null

    return result.stdout.trim() || null
  }

  async rootCommit(root: string) {
    const repository = await this.requiredRepositoryLocation(root)
    const result = await this.git(
      repository.rootAbsolutePath,
      ['rev-list', '--max-parents=0', 'HEAD'],
      {
        allowFailure: true,
      },
    )
    if (result.exitCode !== 0) return null

    return result.stdout.split(/\r?\n/, 1)[0]?.trim() || null
  }

  async status(input = '', fresh = false): Promise<GitStatusResult> {
    recordGitServiceOperation('status', input)
    const repository = await this.resolveRepositoryLocation(input, fresh)
    if (!repository)
      return { repository: null, files: [], uninitializedSubmodules: 0, autoPull: null }

    if (fresh) this.invalidateStatus(repository.rootAbsolutePath)
    const cacheKey = statusCacheKey(repository)
    const cacheHit = this.statuses.read(cacheKey) !== undefined
    const status = await this.statuses.load(cacheKey, () => this.readStatus(repository))
    recordRequestContext({
      git: { fileCount: status.files.length, statusCacheHit: cacheHit },
    })
    return status
  }

  async diff(input = '', staged = false): Promise<GitFileDiff[]> {
    recordGitServiceOperation('diff', input, { staged })
    const repository = await this.resolveRepositoryLocation(input)
    if (!repository) return []

    const pathspecs = await this.diffPathspecArgs(repository, staged)
    const args = [
      'diff',
      '--no-color',
      '--no-ext-diff',
      '--src-prefix=a/',
      '--dst-prefix=b/',
      '--find-renames',
      '--unified=3',
      ...(staged ? ['--cached'] : []),
      ...pathspecs,
    ]
    const result = await this.git(repository.rootAbsolutePath, args)
    const tracked = parseDiff(result.stdout, repository.rootPath, staged)
    const untracked = staged ? [] : await this.untrackedDiffs(repository)
    const diffs = tracked.concat(untracked)
    const results = await mapWithConcurrency(diffs, this.diffConcurrency, async (diff) =>
      this.withDiffSnapshotRefs(repository, diff),
    )
    recordRequestContext({ git: { diffCount: results.length } })
    return results
  }

  async diffBlob(query: GitBlobDiffQuery): Promise<GitFileDiff[]> {
    recordGitServiceOperation('diff_blob', query.path || query.oldPath || '')
    const repository = await this.requiredRepositoryLocation(query.path || query.oldPath || '')
    const oldPath = query.oldPath ?? query.path
    const rawPatch = await this.blobPatch(repository, query)
    const patch = rewriteBlobPatchPaths(rawPatch, {
      newObjectId: query.newObjectId,
      oldObjectId: query.oldObjectId,
      oldPath,
      path: query.path,
    })
    const diffs = parseDiff(patch, repository.rootPath, false)

    const results =
      diffs.length === 0
        ? await this.unchangedBlobDiff(repository, query, oldPath)
        : await mapWithConcurrency(diffs, this.diffConcurrency, async (diff) =>
            this.withBlobDiffContent(repository, diff, query),
          )
    recordRequestContext({ git: { diffCount: results.length } })
    return results
  }

  async diffRefs(input: {
    path: string
    oldRef: string
    newRef: string
    /**
     * Whitespace-only hunks are noise when a human reads a turn diff and are
     * real changes when we count them, so the split is the caller's call. Off
     * by default: git's own behaviour, and the honest one for stat counting.
     */
    ignoreWhitespace?: boolean
  }): Promise<GitFileDiff[]> {
    recordGitServiceOperation('diff_refs', input.path, {
      ignoreWhitespace: input.ignoreWhitespace ?? false,
    })
    const repository = await this.requiredRepositoryLocation(input.path)
    const result = await this.git(repository.rootAbsolutePath, [
      'diff',
      '--no-color',
      '--no-ext-diff',
      '--no-textconv',
      '--src-prefix=a/',
      '--dst-prefix=b/',
      '--find-renames',
      '--unified=3',
      ...(input.ignoreWhitespace ? ['--ignore-all-space'] : []),
      // Peel to a commit and close the revision list, exactly like the `hasRef`
      // gate does. Without both, a checkpoint ref that `hasRef` accepts can
      // still be read as a pathspec here and resolve to a different thing.
      `${input.oldRef}^{commit}`,
      `${input.newRef}^{commit}`,
      '--',
    ])
    const diffs = parseDiff(result.stdout, repository.rootPath, false)
    const results = await mapWithConcurrency(diffs, this.diffConcurrency, async (diff) =>
      this.withRefDiffSnapshotRefs(repository, diff, input),
    )

    recordRequestContext({ git: { diffCount: results.length } })
    return results
  }

  async hasRef(input: { path: string; ref: string }) {
    recordGitServiceOperation('has_ref', input.path, { ref: input.ref })
    const repository = await this.requiredRepositoryLocation(input.path)

    return (await this.resolveRefCommit(repository, input.ref)) !== null
  }

  async restoreRef(input: { fallbackToHead?: boolean; path: string; ref: string }) {
    recordGitServiceOperation('restore_ref', input.path, {
      fallbackToHead: input.fallbackToHead,
      ref: input.ref,
    })
    const repository = await this.requiredRepositoryLocation(input.path)
    const commit =
      (await this.resolveRefCommit(repository, input.ref)) ??
      (input.fallbackToHead ? await this.resolveRefCommit(repository, 'HEAD') : null)
    if (!commit) return false

    await this.git(repository.rootAbsolutePath, [
      'restore',
      '--source',
      commit,
      '--worktree',
      '--staged',
      '--',
      '.',
    ])
    await this.git(repository.rootAbsolutePath, ['clean', '-fd', '--', '.'])
    // `restore --staged` left the index pointing at the restored commit, so
    // every reverted file reads as staged. Resetting the index back to HEAD
    // (worktree untouched) is what makes a revert look like an edit rather
    // than a commit someone already prepared. Skipped before the first commit,
    // where there is no HEAD to reset to.
    const head = await this.resolveRefCommit(repository, 'HEAD')
    if (head) await this.git(repository.rootAbsolutePath, ['reset', '--quiet', '--', '.'])

    return true
  }

  async deleteRefs(input: { path: string; refs: readonly string[] }) {
    const refs = Array.from(new Set(input.refs)).filter(Boolean)
    recordGitServiceOperation('delete_refs', input.path, { refCount: refs.length })
    if (refs.length === 0) return

    const repository = await this.requiredRepositoryLocation(input.path)
    for (const ref of refs) {
      await this.git(repository.rootAbsolutePath, ['update-ref', '-d', ref], {
        allowFailure: true,
      })
    }
  }

  async repositoryRunner(input = ''): Promise<GitRepositoryRunner> {
    const repository = await this.requiredRepositoryLocation(input)

    return {
      resolveWorkspacePath: (target) => this.resolveServicePath(target),
      rootAbsolutePath: repository.rootAbsolutePath,
      rootDisplayAbsolutePath: repository.rootDisplayAbsolutePath,
      rootPath: repository.rootPath,
      run: (args, options = {}) => this.git(repository.rootAbsolutePath, args, options),
      toWorkspacePath: (absolutePath) => this.workspacePath(repository, absolutePath),
    }
  }

  async file(input: string, ref: string) {
    recordGitServiceOperation('file', input)
    const repository = await this.resolveRepositoryLocation(input)
    if (!repository?.pathspec) throw new FsError('GIT_REPOSITORY_NOT_FOUND')

    const revisionPath = `${ref}:${repository.pathspec}`
    const result = await this.git(repository.rootAbsolutePath, ['show', revisionPath], {
      maxOutputBytes: this.maxTextFileBytes,
    })
    return { content: result.stdout, path: input, ref }
  }

  async stage(body: GitPathsBody) {
    recordGitServiceOperation('stage', body.paths[0] ?? '', {
      pathCount: mutationPaths(body).length,
    })
    const target = await this.resolveMutationTarget(body)
    await this.git(target.repository.rootAbsolutePath, ['add', '--all', '--', ...target.pathspecs])
    return this.status(target.repository.rootPath)
  }

  async unstage(body: GitPathsBody) {
    recordGitServiceOperation('unstage', body.paths[0] ?? '', {
      pathCount: mutationPaths(body).length,
    })
    const target = await this.resolveMutationTarget(body)
    await this.git(target.repository.rootAbsolutePath, [
      'restore',
      '--staged',
      '--',
      ...target.pathspecs,
    ])
    return this.status(target.repository.rootPath)
  }

  async discard(body: GitPathsBody) {
    recordGitServiceOperation('discard', body.paths[0] ?? '', {
      pathCount: mutationPaths(body).length,
    })
    const target = await this.resolveMutationTarget(body)
    const restore = await this.git(
      target.repository.rootAbsolutePath,
      ['restore', '--worktree', '--'].concat(target.pathspecs),
      { allowFailure: true },
    )
    const clean = await this.git(
      target.repository.rootAbsolutePath,
      ['clean', '-f', '--'].concat(target.pathspecs),
      { allowFailure: true },
    )
    if (restore.exitCode !== 0 && clean.exitCode !== 0) {
      throw new FsError('GIT_COMMAND_FAILED', gitErrorMessage(restore))
    }

    return this.status(target.repository.rootPath)
  }

  async applyPatch(body: GitApplyPatchBody) {
    recordGitServiceOperation('apply_patch', body.path, {
      patchBytes: Buffer.byteLength(body.patch, 'utf8'),
      reverse: body.reverse,
      target: body.target,
    })
    const repository = await this.requiredRepository(body.path)
    const args = ['apply', '--whitespace=nowarn']
    if (body.target === 'index') args.push('--cached')
    if (body.reverse) args.push('--reverse')

    await this.git(repository.rootAbsolutePath, args, { input: body.patch })
    return this.status(repository.rootPath)
  }

  async commit(body: GitCommitBody) {
    recordGitServiceOperation('commit', body.path, {
      messageBytes: Buffer.byteLength(body.message, 'utf8'),
    })
    const repository = await this.requiredRepository(body.path)
    const plan = await this.commitPlan(repository, body)
    if (plan.kind === 'settled') return plan.result

    const result = await this.git(repository.rootAbsolutePath, plan.args)
    return {
      kind: 'committed' as const,
      output: result.stdout.trim(),
      repository: repository.info,
    }
  }

  /**
   * The same commit, reported while it runs. Hooks are the reason: they can take
   * tens of seconds and they write as they go, so the difference between "slow"
   * and "stuck" only exists if their output reaches the user before the process
   * exits.
   *
   * Yields its own failures as a `failed` frame rather than throwing. The
   * response has already begun by the time a hook rejects, so there is no status
   * code left to carry the error — the stream is the only channel there is.
   */
  async *commitProgress(body: GitCommitBody): AsyncGenerator<GitCommitProgressEvent> {
    const runner = await this.repositoryRunner(body.path)
    yield* withGitRepositoryLaneStream(await this.commonDirectory(runner.rootAbsolutePath), () =>
      this.commitProgressInLane(body),
    )
  }

  private async *commitProgressInLane(body: GitCommitBody): AsyncGenerator<GitCommitProgressEvent> {
    recordGitServiceOperation('commit_progress', body.path, {
      messageBytes: Buffer.byteLength(body.message, 'utf8'),
    })
    const repository = await this.requiredRepository(body.path)
    const plan = await this.commitPlan(repository, body)
    if (plan.kind === 'settled') {
      yield { kind: 'result', result: plan.result }
      return
    }

    let lineCount = 0
    for await (const event of streamProcess({
      args: plan.args,
      cwd: repository.rootAbsolutePath,
    })) {
      if (event.kind === 'line') {
        lineCount += 1
        // SGR colors pass through for the panel to paint; a CRLF's `\r` is only noise.
        const text = event.line.text.replace(/\r$/, '')
        yield { kind: 'progress', stream: event.line.stream, text }
        continue
      }

      // Counted, never echoed: hook output is repository content and belongs in
      // the response, not in the server's logs.
      recordRequestContext({ git: { commitOutputLines: lineCount } })
      this.invalidateStatus(repository.rootAbsolutePath)
      await this.notifyMutation(repository.rootAbsolutePath)
      if (event.limit) {
        yield { kind: 'failed', message: processLimitError(event.limit, 'commit').message }
        return
      }
      if (event.exitCode !== 0) {
        // A non-zero commit is the ordinary "hook rejected this" path, and the
        // lines above already said why.
        yield { kind: 'failed', message: `git commit exited with code ${event.exitCode}` }
        return
      }

      yield {
        kind: 'result',
        result: { kind: 'committed', output: '', repository: repository.info },
      }
    }
  }

  async branches(input = ''): Promise<GitBranchesResult> {
    recordGitServiceOperation('branches', input)
    const repository = await this.resolveRepository(input)
    if (!repository) return { repository: null, branches: [] }

    const format = '%(refname:short)%00%(HEAD)%00%(upstream:short)%00%(objectname:short)%00'
    const result = await this.git(repository.rootAbsolutePath, ['branch', '--format', format])
    const branches = {
      repository: repository.info,
      branches: parseBranches(result.stdout),
    }
    recordRequestContext({ git: { branchCount: branches.branches.length } })
    return branches
  }

  async checkout(body: GitCheckoutBody) {
    recordGitServiceOperation('checkout', body.path)
    const repository = await this.requiredRepositoryLocation(body.path)
    await this.git(repository.rootAbsolutePath, ['checkout', body.branch])
    return this.status(repository.rootPath)
  }

  async createBranch(body: GitCreateBranchBody) {
    recordGitServiceOperation('create_branch', body.path, {
      checkout: body.checkout,
    })
    const repository = await this.requiredRepositoryLocation(body.path)
    // `git branch` ends option parsing at `--`; `git checkout` does not — there
    // `--` introduces pathspecs, so the ref schema is the whole defense.
    const args = ['branch', '--', body.branch]
    if (body.startPoint) args.push(body.startPoint)

    await this.git(repository.rootAbsolutePath, args)
    if (body.checkout) {
      await this.git(repository.rootAbsolutePath, ['checkout', body.branch])
    }
    return this.branches(repository.rootPath)
  }

  async fetch(input = '') {
    recordGitServiceOperation('fetch', input)
    const repository = await this.requiredRepository(input)
    const result = await this.git(repository.rootAbsolutePath, ['fetch'])
    return { output: commandOutput(result), repository: repository.info }
  }

  async initializeSubmodules(input: string, mode: WorktreeSubmoduleMode) {
    recordGitServiceOperation('submodules_init', input, { mode })
    const repository = await this.requiredRepositoryLocation(input)
    await this.updateSubmodules(repository.rootAbsolutePath, mode)
    return this.status(repository.rootPath)
  }

  /**
   * Outside the repository lane on purpose: each worktree clones its submodules
   * over the network into its own admin directory, and holding the lane for that
   * would block every commit in every checkout of the repository.
   */
  async updateSubmodules(root: string, mode: WorktreeSubmoduleMode) {
    if (mode === 'none' || !(await hasSubmodules(root))) return false
    try {
      await this.runGit(root, submoduleUpdateArgs(mode), SUBMODULE_UPDATE_OPTIONS)
    } finally {
      await this.notifyMutation(root)
    }
    return true
  }

  /**
   * Clones into a folder inside the workspace. Not in the repository lane: there is no
   * repository yet, and the new checkout is registered only once it is complete.
   */
  cloneProgress(
    body: { source: string; destination: string },
    register: (absolutePath: string) => Promise<string | null>,
  ) {
    recordGitServiceOperation('clone', body.destination)
    const destination = this.resolveServicePath(body.destination)
    return cloneRepository({
      source: body.source,
      destination: destination.absolutePath,
      displayPath: destination.relativePath,
      register,
    })
  }

  /**
   * Creates the repository on a forge, adds it as a remote (reusing one with the same URL), and
   * pushes the current branch when there is a commit to push. A push that fails after the
   * repository exists is reported as such, never as a failed publish.
   */
  async publish(body: GitPublishRequest): Promise<GitPublishResult> {
    recordGitServiceOperation('publish', body.path, { forge: body.forge })
    const repository = await this.requiredRepository(body.path)
    const root = repository.rootAbsolutePath
    const created = await createForgeRepository(body, root, this.forgeBoundaries)
    const remoteUrl = body.protocol === 'ssh' ? created.sshUrl : created.httpsUrl
    const remoteName = await this.ensureRemote(root, remoteUrl)
    const branch = repository.info.branch
    const head = await this.git(root, ['rev-parse', '--verify', '--quiet', 'HEAD'], {
      allowFailure: true,
    })
    const result = { url: created.url, remoteName, remoteUrl, branch, pushError: null }
    if (head.exitCode !== 0) return { ...result, status: 'remote-added' }
    const target = branch ?? 'main'
    const push = await this.git(
      root,
      ['push', '--set-upstream', remoteName, `HEAD:refs/heads/${target}`],
      {
        allowFailure: true,
        env: { GIT_TERMINAL_PROMPT: '0' },
      },
    )
    if (push.exitCode === 0) return { ...result, status: 'pushed' }
    return { ...result, status: 'push-failed', pushError: gitErrorMessage(push) }
  }

  /** `origin` unless another remote already has that name for a different URL. */
  private async ensureRemote(root: string, url: string) {
    const listed = await this.git(root, ['remote', '-v'], { allowFailure: true })
    const remotes = new Map<string, string>()
    for (const line of listed.stdout.split('\n')) {
      const [name, remoteUrl] = line.trim().split(/\s+/)
      if (name && remoteUrl) remotes.set(name, remoteUrl)
    }
    for (const [name, remoteUrl] of remotes) if (remoteUrl === url) return name
    let name = 'origin'
    for (let suffix = 1; remotes.has(name); suffix += 1) name = `origin-${suffix}`
    await this.git(root, ['remote', 'add', name, url])
    return name
  }

  async pull(input = '') {
    recordGitServiceOperation('pull', input)
    const repository = await this.requiredRepository(input)
    const result = await this.git(repository.rootAbsolutePath, ['pull'], { allowFailure: true })
    if (result.exitCode !== 0) throw await this.pullError(repository.rootAbsolutePath, result)
    return { output: commandOutput(result), repository: repository.info }
  }

  /** A pull that stops on conflicts leaves the checkout mid-rebase or mid-merge; say which. */
  private async pullError(root: string, result: GitCommandResult) {
    const unmerged = await this.git(root, ['diff', '--name-only', '--diff-filter=U', '-z'], {
      allowFailure: true,
    })
    const files = unmerged.stdout.split('\0').filter(Boolean)
    const internal = { conflictCount: files.length, exitCode: result.exitCode }
    if (files.length === 0)
      return gitPullRequestErrors.PULL_FAILED({ internal, reason: pullFailureReason(result) })

    const rebase = await this.git(root, ['rev-parse', '-q', '--verify', 'REBASE_HEAD'], {
      allowFailure: true,
    })
    const conflict = { files: conflictSummary(files), internal }
    if (rebase.exitCode === 0) return gitPullRequestErrors.PULL_REBASE_CONFLICT(conflict)
    return gitPullRequestErrors.PULL_MERGE_CONFLICT(conflict)
  }

  /**
   * A plain `git push` fails on a branch nobody has published, which is the
   * only kind of branch a session ever creates. The upstream is set on that
   * first push instead of making the user drop to a terminal for it.
   */
  async push(input = ''): Promise<GitPushResult> {
    recordGitServiceOperation('push', input)
    const repository = await this.requiredRepository(input)
    const branch = repository.info.branch
    if (!branch) throw gitPullRequestErrors.PUSH_DETACHED_HEAD({ path: repository.info.path })

    const setUpstream = !(await this.upstreamRef(repository.rootAbsolutePath))
    const args = setUpstream ? ['push', '--set-upstream', 'origin', branch] : ['push']
    const result = await this.git(repository.rootAbsolutePath, args)

    return { branch, output: commandOutput(result), repository: repository.info, setUpstream }
  }

  /**
   * Local only, and fast on purpose. The pull request half lives in its own
   * route because it shells out to `gh`: a header that cannot offer Publish
   * until GitHub answers is blank exactly when the network is worst.
   */
  async branchRemoteState(input = ''): Promise<GitBranchRemoteState> {
    recordGitServiceOperation('branch_remote_state', input)
    // `requiredRepository` already ran `status --porcelain=v2 --branch`, which
    // is where the branch name and the ahead/behind counts come from — reading
    // them again through `rev-list` would be two more processes for the answer
    // already in hand. Only the upstream's existence is missing, because 0/0
    // means both "in sync" and "no upstream to be behind".
    const repository = await this.requiredRepository(input)
    const branch = repository.info.branch
    const upstream = branch ? await this.upstreamRef(repository.rootAbsolutePath) : null

    const remotes = upstream
      ? null
      : await this.git(repository.rootAbsolutePath, ['remote'], { allowFailure: true })

    return {
      ahead: repository.info.ahead,
      behind: repository.info.behind,
      branch,
      hasUpstream: Boolean(upstream),
      hasRemote: upstream !== null || Boolean(remotes?.stdout.trim()),
    }
  }

  async pullRequestState(input = ''): Promise<GitPullRequestState> {
    recordGitServiceOperation('pull_request_state', input)
    const repository = await this.requiredRepository(input)
    const branch = repository.info.branch
    if (!branch) return { branch: null, pullRequest: null, support: 'no-forge', forge: null }

    const read = await readPullRequest(
      { branch, cwd: repository.rootAbsolutePath },
      this.forgeBoundaries,
    )

    return { branch, ...read }
  }

  async createPullRequest(body: GitCreatePullRequestBody): Promise<GitPullRequestCreateResult> {
    recordGitServiceOperation('create_pull_request', body.path)
    const repository = await this.requiredRepository(body.path)
    const branch = repository.info.branch
    if (!branch) throw gitPullRequestErrors.PUSH_DETACHED_HEAD({ path: repository.info.path })

    return createPullRequest(
      {
        base: body.base,
        body: body.body,
        branch,
        cwd: repository.rootAbsolutePath,
        draft: body.draft,
        title: body.title,
      },
      this.forgeBoundaries,
    )
  }

  private async upstreamRef(cwd: string) {
    const result = await this.git(
      cwd,
      ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'],
      {
        allowFailure: true,
      },
    )
    if (result.exitCode !== 0) return null

    return result.stdout.trim() || null
  }

  private async resolveMutationTarget(body: GitPathsBody) {
    const paths = mutationPaths(body)
    const repository = await this.requiredRepositoryLocation(paths[0])
    const pathspecs = paths.map(
      (input) => this.pathspecForRepository(repository.rootDisplayAbsolutePath, input) ?? '.',
    )

    return { pathspecs, repository }
  }

  private async requiredRepository(input = '') {
    const repository = await this.resolveRepository(input)
    if (!repository) throw new FsError('GIT_REPOSITORY_NOT_FOUND')

    return repository
  }

  private async requiredRepositoryLocation(input = '') {
    const repository = await this.resolveRepositoryLocation(input)
    if (!repository) throw new FsError('GIT_REPOSITORY_NOT_FOUND')

    return repository
  }

  private async resolveRepository(input = ''): Promise<GitRepository | null> {
    const location = await this.resolveRepositoryLocation(input)
    if (!location) return null

    const info = await this.repositoryInfo(location.rootAbsolutePath, location.rootPath)

    return { ...location, info }
  }

  private async resolveRepositoryLocation(
    input = '',
    fresh = false,
  ): Promise<GitRepositoryLocation | null> {
    const resolved = this.resolveServicePath(input)
    const cwd = await gitCwdForPath(resolved.absolutePath)
    if (fresh) this.repositoryRoots.invalidate(cwd)
    const root = await this.repositoryRoots.load(cwd, () => this.readRepositoryRoot(cwd))
    if (!root) return null

    // Containment is re-checked per call, never cached: the cache stores where
    // the repository is, not permission to reach it.
    this.paths.assertRealInside(root.rootAbsolutePath)
    this.paths.assertInside(root.rootDisplayAbsolutePath)

    return {
      pathspec: this.pathspecForRepository(root.rootDisplayAbsolutePath, input),
      rootAbsolutePath: root.rootAbsolutePath,
      rootDisplayAbsolutePath: root.rootDisplayAbsolutePath,
      rootPath: this.paths.toRelative(root.rootDisplayAbsolutePath),
    }
  }

  private async readRepositoryRoot(cwd: string): Promise<GitRepositoryRoot | null> {
    const root = await this.git(cwd, ['rev-parse', '--show-toplevel', '--show-prefix'], {
      allowFailure: true,
    })
    if (root.exitCode !== 0) return null

    const [rootOutput = '', prefix = ''] = root.stdout.split(/\r?\n/)

    return {
      rootAbsolutePath: path.resolve(rootOutput),
      rootDisplayAbsolutePath: lexicalRepositoryRoot(cwd, prefix),
    }
  }

  private async readStatus(repository: GitRepositoryLocation): Promise<GitStatusResult> {
    const result = await this.git(repository.rootAbsolutePath, [
      'status',
      '--porcelain=v2',
      '--branch',
      '-z',
      '--untracked-files=all',
      ...pathspecArgs(repository.pathspec),
    ])
    void this.upstreamFetch.schedule(repository.rootAbsolutePath, result.stdout)
    const files = parseStatus(result.stdout, repository.rootPath)
    const [withLines, uninitializedSubmodules, autoPull] = await Promise.all([
      files.length > 0 ? this.withLineStats(repository, files) : files,
      uninitializedSubmoduleCount(repository.rootAbsolutePath, (args, options) =>
        this.git(repository.rootAbsolutePath, args, options),
      ),
      this.autoPull?.evaluate(repository.rootAbsolutePath, result.stdout, () =>
        repository.pathspec ? this.changedFileCount(repository) : Promise.resolve(files.length),
      ) ?? null,
    ])

    return {
      repository: parseRepositoryInfo(result.stdout, repository.rootPath),
      files: withLines,
      uninitializedSubmodules,
      autoPull,
    }
  }

  /** The whole checkout's change count, for a status read that was limited to a folder. */
  private async changedFileCount(repository: GitRepositoryLocation) {
    const result = await this.git(repository.rootAbsolutePath, [
      'status',
      '--porcelain=v2',
      '-z',
      '--untracked-files=all',
    ])
    return parseStatus(result.stdout, repository.rootPath).length
  }

  private async withLineStats(repository: GitRepositoryLocation, files: GitFileStatus[]) {
    const [staged, worktree, untracked] = await Promise.all([
      this.numstat(repository, true),
      this.numstat(repository, false),
      untrackedLineStats(files, repository.rootPath, repository.rootAbsolutePath),
    ])
    for (const [filePath, stat] of untracked) worktree.set(filePath, stat)

    return withLineStats(files, staged, worktree)
  }

  // Counts decorate the rows; a failed or oversized numstat must not fail status.
  private async numstat(repository: GitRepositoryLocation, staged: boolean) {
    const args = ['diff', '--numstat', '-z', '--no-ext-diff']
    if (staged) args.push('--cached')
    const result = await this.git(
      repository.rootAbsolutePath,
      args.concat(pathspecArgs(repository.pathspec)),
      { allowFailure: true },
    ).catch(() => null)
    if (!result || result.exitCode !== 0) return new Map<string, GitLineStat>()

    return parseNumstat(result.stdout, repository.rootPath)
  }

  /**
   * The explicit invalidation path. Every write verb calls it before reporting
   * the new status, so a mutation is never answered out of the pre-mutation
   * window — a cache that can outlive the edit that invalidated it is a bug,
   * not a stale read.
   */
  private invalidateStatus(rootAbsolutePath: string) {
    this.statuses.invalidatePrefix(`${rootAbsolutePath}\u0000`)
  }

  /**
   * Git answers with resolved paths while workspace paths stay lexical, so on
   * macOS a worktree git prints as /private/var/... has to be re-anchored on the
   * repository's display root before it can come back as the path the client
   * asked with. Paths outside the repository skip the anchor and are checked
   * against the workspace directly — a hand-made worktree is still reportable.
   */
  private workspacePath(repository: GitRepositoryLocation, absolutePath: string) {
    const insideRepository = relativeInsideRoot(repository.rootAbsolutePath, absolutePath)
    const anchored =
      insideRepository === null
        ? absolutePath
        : path.resolve(repository.rootDisplayAbsolutePath, insideRepository)

    return (
      relativeInsideRoot(this.paths.workspaceRoot, anchored) ??
      relativeInsideRoot(this.paths.workspaceRootReal, anchored)
    )
  }

  private pathspecForRepository(rootAbsolutePath: string, input = '') {
    const absolutePath = this.resolveServicePath(input).absolutePath
    const relative = path.relative(rootAbsolutePath, absolutePath)
    if (relative === '') return null
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new FsError('GIT_REPOSITORY_NOT_FOUND')
    }

    return toPosix(relative)
  }

  private resolveServicePath(input = '') {
    if (!path.isAbsolute(input)) return this.paths.resolve(input)

    const absolutePath = path.resolve(input)
    this.paths.assertInside(absolutePath)

    return {
      absolutePath,
      relativePath: this.paths.toRelative(absolutePath),
    }
  }

  private async repositoryInfo(
    rootAbsolutePath: string,
    rootPath: string,
  ): Promise<GitRepositoryInfo> {
    const result = await this.git(rootAbsolutePath, [
      'status',
      '--porcelain=v2',
      '--branch',
      '-z',
      '--untracked-files=no',
    ])
    return parseRepositoryInfo(result.stdout, rootPath)
  }

  private async diffPathspecArgs(
    repository: GitRepositoryLocation,
    staged: boolean,
  ): Promise<string[]> {
    if (!repository.pathspec) return []

    const related = await this.relatedDiffPathspecs(repository, staged)
    return ['--'].concat(related)
  }

  private async relatedDiffPathspecs(repository: GitRepositoryLocation, staged: boolean) {
    const pathspec = repository.pathspec
    if (!pathspec) return []

    const result = await this.git(repository.rootAbsolutePath, [
      'status',
      '--porcelain=v2',
      '-z',
      '--untracked-files=all',
    ])
    const files = parseStatus(result.stdout, repository.rootPath)
    const matched = files.find((file) => statusMatchesPathspec(file, repository, staged))
    if (!matched?.oldPath) return [pathspec]

    return [
      repositoryRelativePath(repository.rootPath, matched.oldPath),
      repositoryRelativePath(repository.rootPath, matched.path),
    ].filter((pathspec) => pathspec.length > 0)
  }

  private async withDiffSnapshotRefs(
    repository: GitRepositoryLocation,
    diff: GitFileDiff,
  ): Promise<GitFileDiff> {
    if (isBinaryDiff(diff)) return diff
    if (await this.isDiffTooLarge(repository, diff)) return diff

    const [oldObjectId, newObjectId] = await Promise.all([
      this.diffSideObjectId(repository, diff, 'old'),
      this.diffSideObjectId(repository, diff, 'new'),
    ])

    return {
      ...diff,
      newObjectId: newObjectId ?? undefined,
      oldObjectId: oldObjectId ?? undefined,
    }
  }

  private async withBlobDiffContent(
    repository: GitRepositoryLocation,
    diff: GitFileDiff,
    query: GitBlobDiffQuery,
  ): Promise<GitFileDiff> {
    if (isBinaryDiff(diff)) return this.withBlobObjectIds(diff, query)
    if (await this.isBlobDiffTooLarge(repository, query)) {
      return this.withBlobObjectIds(diff, query)
    }

    const [oldText, newText] = await Promise.all([
      query.oldObjectId ? this.gitObjectText(repository, query.oldObjectId) : '',
      query.newObjectId ? this.gitObjectText(repository, query.newObjectId) : '',
    ])

    return {
      ...diff,
      newObjectId: query.newObjectId,
      newText,
      oldObjectId: query.oldObjectId,
      oldText,
    }
  }

  /**
   * Two identical blobs produce an empty patch, so `parseDiff` has no entry to make — which is what
   * a pure rename, a mode change, or a file staged and then reverted looks like from here. The
   * reader still opened a file, so send the file: both sides carry the same text and the viewer
   * draws it as unchanged, the way every other diff viewer answers this state. Binary content and
   * anything past the text limit have nothing to draw and keep the notice.
   */
  private async unchangedBlobDiff(
    repository: GitRepositoryLocation,
    query: GitBlobDiffQuery,
    oldPath: string,
  ): Promise<GitFileDiff[]> {
    const objectId = query.newObjectId ?? query.oldObjectId
    if (!objectId) return []
    if (await this.isBlobDiffTooLarge(repository, query)) return []

    const text = await this.gitObjectText(repository, objectId)
    if (!text || isBinaryText(text)) return []

    return [
      {
        hunks: [],
        newObjectId: query.newObjectId,
        newText: text,
        oldObjectId: query.oldObjectId,
        oldPath: oldPath === query.path ? undefined : oldPath,
        oldText: text,
        patch: '',
        path: query.path,
        staged: false,
      },
    ]
  }

  private withBlobObjectIds(diff: GitFileDiff, query: GitBlobDiffQuery): GitFileDiff {
    return {
      ...diff,
      newObjectId: query.newObjectId,
      oldObjectId: query.oldObjectId,
    }
  }

  private async withRefDiffSnapshotRefs(
    repository: GitRepositoryLocation,
    diff: GitFileDiff,
    input: { oldRef: string; newRef: string },
  ): Promise<GitFileDiff> {
    const [oldObjectId, newObjectId] = await Promise.all([
      this.refDiffObjectId(
        repository,
        input.oldRef,
        diff.oldPath ?? diff.path,
        diff.oldFileMissing,
      ),
      this.refDiffObjectId(repository, input.newRef, diff.path, diff.newFileMissing),
    ])

    return this.withUnchangedRefDiffText(repository, {
      ...diff,
      newObjectId: newObjectId ?? undefined,
      oldObjectId: oldObjectId ?? undefined,
    })
  }

  /**
   * A ref diff carries only its patch — whole-file text is the blob route's job, and one turn diff
   * can touch every file in the repository. A file whose two sides are the same object is the
   * exception: it is a rename or a mode change, its patch holds nothing to render, and its text is
   * one `cat-file` away. Without it the viewer can only print a sentence where the file should be.
   *
   * Gated on the two object ids being equal rather than on the entry having no hunks: a binary
   * change is also hunkless, and its two sides are genuinely different content that no text diff
   * should pretend to render.
   */
  private async withUnchangedRefDiffText(
    repository: GitRepositoryLocation,
    diff: GitFileDiff,
  ): Promise<GitFileDiff> {
    const objectId = diff.newObjectId
    if (!objectId || objectId !== diff.oldObjectId) return diff

    const size = await this.gitObjectSize(repository, objectId)
    if (isTooLarge(size, this.maxTextFileBytes)) return diff

    const text = await this.gitObjectText(repository, objectId)
    if (!text || isBinaryText(text)) return diff

    return { ...diff, newText: text, oldText: text }
  }

  private async refDiffObjectId(
    repository: GitRepositoryLocation,
    ref: string,
    pathValue: string,
    missing: boolean | undefined,
  ) {
    if (missing) return null

    const relativePath = repositoryRelativePath(repository.rootPath, pathValue)
    if (!relativePath) return null

    return this.gitObjectId(repository, `${ref}:${relativePath}`)
  }

  private async untrackedDiffs(repository: GitRepositoryLocation): Promise<GitFileDiff[]> {
    const files = await this.untrackedFiles(repository)
    const diffableFiles = await mapWithConcurrency(files, this.diffConcurrency, async (file) =>
      this.diffableUntrackedFile(repository, file),
    )
    const outputs = await mapWithConcurrency(
      diffableFiles.filter(isString),
      this.diffConcurrency,
      async (file) => this.noIndexDiff(repository, file),
    )

    return outputs.flatMap((output) => parseDiff(output, repository.rootPath, false))
  }

  private async untrackedFiles(repository: GitRepositoryLocation) {
    const pathspec = repository.pathspec ? ['--', repository.pathspec] : []
    const result = await this.git(repository.rootAbsolutePath, [
      'ls-files',
      '--others',
      '--exclude-standard',
      '-z',
      ...pathspec,
    ])

    return result.stdout.split('\0').filter(Boolean)
  }

  private async diffableUntrackedFile(repository: GitRepositoryLocation, pathspec: string) {
    const size = await this.workingTreeSize(repository, pathspec)
    if (size === null) return null
    if (size > this.maxTextFileBytes) return null

    return pathspec
  }

  private async noIndexDiff(repository: GitRepositoryLocation, pathspec: string) {
    const result = await this.git(
      repository.rootAbsolutePath,
      [
        'diff',
        '--no-color',
        '--no-ext-diff',
        '--src-prefix=a/',
        '--dst-prefix=b/',
        '--unified=3',
        '--no-index',
        '--',
        '/dev/null',
        pathspec,
      ],
      { allowFailure: true },
    )
    if (result.exitCode <= 1) return result.stdout

    throw new FsError('GIT_COMMAND_FAILED', gitErrorMessage(result))
  }

  private async diffSideObjectId(
    repository: GitRepositoryLocation,
    diff: GitFileDiff,
    side: 'old' | 'new',
  ) {
    if (side === 'old') return this.oldDiffObjectId(repository, diff)

    return this.newDiffObjectId(repository, diff)
  }

  private async oldDiffObjectId(repository: GitRepositoryLocation, diff: GitFileDiff) {
    const path = repositoryRelativePath(repository.rootPath, diff.oldPath ?? diff.path)
    if (!path) return null
    if (diff.oldFileMissing) return null
    if (diff.staged) return this.gitObjectId(repository, `HEAD:${path}`)

    return this.gitObjectId(repository, `:${path}`)
  }

  private async newDiffObjectId(repository: GitRepositoryLocation, diff: GitFileDiff) {
    const path = repositoryRelativePath(repository.rootPath, diff.path)
    if (!path) return null
    if (diff.newFileMissing) return null
    if (diff.staged) return this.gitObjectId(repository, `:${path}`)

    return this.writeWorkingTreeObject(repository, path)
  }

  private async isDiffTooLarge(
    repository: GitRepositoryLocation,
    diff: GitFileDiff,
  ): Promise<boolean> {
    const [oldSize, newSize] = await Promise.all([
      this.diffSideSize(repository, diff, 'old'),
      this.diffSideSize(repository, diff, 'new'),
    ])

    return isTooLarge(oldSize, this.maxTextFileBytes) || isTooLarge(newSize, this.maxTextFileBytes)
  }

  private async gitObjectId(repository: GitRepositoryLocation, revisionPath: string) {
    const result = await this.git(repository.rootAbsolutePath, ['rev-parse', revisionPath], {
      allowFailure: true,
    })
    if (result.exitCode !== 0) return null

    return result.stdout.trim() || null
  }

  private async resolveRefCommit(repository: GitRepositoryLocation, ref: string) {
    const result = await this.git(
      repository.rootAbsolutePath,
      ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`],
      { allowFailure: true },
    )
    if (result.exitCode !== 0) return null

    return result.stdout.trim() || null
  }

  private async diffSideSize(
    repository: GitRepositoryLocation,
    diff: GitFileDiff,
    side: 'old' | 'new',
  ) {
    if (side === 'old') return this.oldDiffSize(repository, diff)

    return this.newDiffSize(repository, diff)
  }

  private async oldDiffSize(repository: GitRepositoryLocation, diff: GitFileDiff) {
    const path = repositoryRelativePath(repository.rootPath, diff.oldPath ?? diff.path)
    if (!path) return null
    if (diff.oldFileMissing) return null
    if (diff.staged) return this.gitObjectSize(repository, `HEAD:${path}`)

    return this.gitObjectSize(repository, `:${path}`)
  }

  private async newDiffSize(repository: GitRepositoryLocation, diff: GitFileDiff) {
    const path = repositoryRelativePath(repository.rootPath, diff.path)
    if (!path) return null
    if (diff.newFileMissing) return null
    if (diff.staged) return this.gitObjectSize(repository, `:${path}`)

    return this.workingTreeSize(repository, path)
  }

  private async gitObjectSize(repository: GitRepositoryLocation, revisionPath: string) {
    const result = await this.git(repository.rootAbsolutePath, ['cat-file', '-s', revisionPath], {
      allowFailure: true,
    })
    if (result.exitCode !== 0) return null

    const size = Number(result.stdout.trim())
    return Number.isSafeInteger(size) ? size : null
  }

  private async workingTreeSize(repository: GitRepositoryLocation, relativePath: string) {
    const absolutePath = path.join(repository.rootDisplayAbsolutePath, relativePath)
    this.paths.assertInside(absolutePath)

    try {
      const stats = await stat(absolutePath)
      return stats.isFile() ? stats.size : null
    } catch {
      return null
    }
  }

  // File content, not command output: the caller already gated on the blob
  // size, so the budget here is the workspace's text-file limit.
  private async gitObjectText(repository: GitRepositoryLocation, objectId: string) {
    const result = await this.git(repository.rootAbsolutePath, ['cat-file', '-p', objectId], {
      maxOutputBytes: this.maxTextFileBytes,
    })
    return result.stdout
  }

  private async isBlobDiffTooLarge(repository: GitRepositoryLocation, query: GitBlobDiffQuery) {
    const [oldSize, newSize] = await Promise.all([
      query.oldObjectId ? this.gitObjectSize(repository, query.oldObjectId) : null,
      query.newObjectId ? this.gitObjectSize(repository, query.newObjectId) : null,
    ])

    return isTooLarge(oldSize, this.maxTextFileBytes) || isTooLarge(newSize, this.maxTextFileBytes)
  }

  private async blobPatch(repository: GitRepositoryLocation, query: GitBlobDiffQuery) {
    const [oldObjectId, newObjectId] = await Promise.all([
      query.oldObjectId ?? this.emptyBlobObjectId(repository),
      query.newObjectId ?? this.emptyBlobObjectId(repository),
    ])
    if (oldObjectId === newObjectId) return ''

    const result = await this.git(
      repository.rootAbsolutePath,
      ['diff', '--no-color', '--no-ext-diff', '--unified=3', oldObjectId, newObjectId],
      { allowFailure: true },
    )
    if (result.exitCode <= 1) return result.stdout

    throw new FsError('GIT_COMMAND_FAILED', gitErrorMessage(result))
  }

  private async emptyBlobObjectId(repository: GitRepositoryLocation) {
    const result = await this.git(repository.rootAbsolutePath, ['hash-object', '-w', '--stdin'], {
      input: '',
    })
    return result.stdout.trim()
  }

  private async writeWorkingTreeObject(repository: GitRepositoryLocation, relativePath: string) {
    const result = await this.git(repository.rootAbsolutePath, [
      'hash-object',
      '-w',
      '--',
      relativePath,
    ])
    return result.stdout.trim() || null
  }

  /** Either the `git commit` to run, or the result when there is nothing to run. */
  private async commitPlan(repository: GitRepository, body: GitCommitBody): Promise<CommitPlan> {
    if (body.source === 'message-file') return this.messageFileCommitPlan(repository)

    const message = body.message.trim()
    if (!message) return { kind: 'settled', result: await this.openCommitMessage(repository) }

    return { args: ['commit', '-m', message], kind: 'run' }
  }

  private async messageFileCommitPlan(repository: GitRepository): Promise<CommitPlan> {
    const target = await this.commitMessageTarget(repository)
    const written = await readFile(target.absolutePath, 'utf8').catch(() => '')
    if (!hasCommitMessageText(written))
      return { kind: 'settled', result: { kind: 'aborted', repository: repository.info } }

    // `strip` is git's editor default; `-F` alone would keep the `#` lines.
    return { args: ['commit', '-F', target.absolutePath, '--cleanup=strip'], kind: 'run' }
  }

  private async openCommitMessage(repository: GitRepository): Promise<GitCommitResult> {
    const target = await this.commitMessageTarget(repository)
    const template = await this.commitMessageTemplate(repository)
    await writeFile(target.absolutePath, template, 'utf8')
    return {
      kind: 'message-file',
      path: target.path,
      repository: repository.info,
    }
  }

  private async commitMessageTarget(repository: GitRepositoryLocation) {
    const result = await this.git(repository.rootAbsolutePath, [
      'rev-parse',
      '--git-path',
      'COMMIT_EDITMSG',
    ])
    const gitPath = result.stdout.trim()
    const absolutePath = path.isAbsolute(gitPath)
      ? gitPath
      : path.resolve(repository.rootDisplayAbsolutePath, gitPath)
    this.paths.assertInside(absolutePath)
    return { absolutePath, path: this.paths.toRelative(absolutePath) }
  }

  private async commitMessageTemplate(repository: GitRepositoryLocation) {
    const result = await this.git(repository.rootAbsolutePath, [
      'status',
      '--short',
      '--branch',
      '--untracked-files=all',
    ])
    return commitMessageTemplate(result.stdout)
  }

  private async git(
    cwd: string,
    args: readonly string[],
    options: GitCommandOptions = {},
  ): Promise<GitCommandResult> {
    if (isReadOnlyGit(args)) return this.runGit(cwd, args, options)
    const common = await this.commonDirectory(cwd)
    return withGitRepositoryLane(common, async () => {
      try {
        return await this.runGit(cwd, args, options)
      } finally {
        await this.notifyMutation(cwd)
      }
    })
  }

  private async runGit(
    cwd: string,
    args: readonly string[],
    options: GitCommandOptions,
  ): Promise<GitCommandResult> {
    const startedAt = performance.now()
    const action = gitAction(args)
    const outcome = await runProcess({
      args,
      cwd,
      env: options.env,
      input: options.input,
      maxOutputBytes: options.maxOutputBytes ?? this.maxCommandOutputBytes,
      timeoutMs: options.timeoutMs,
    })
    // Invalidation lives at the chokepoint every git call already goes through,
    // including the checkpoint runner's plumbing. Unknown verbs count as writers,
    // so forgetting one costs an extra `git status` rather than leaving a cache
    // that outlives the change it should have seen. A failed write still
    // invalidates: a half-applied patch changed the tree too.
    if (!isReadOnlyGit(args)) this.invalidateStatus(cwd)
    // A limit violation is not an "allowed failure": the command produced no
    // usable output, so every caller has to hear about it.
    const limitError = outcome.limit ? processLimitError(outcome.limit, action) : null
    recordGitCommand({
      action,
      allowFailure: options.allowFailure ?? false,
      durationMs: elapsedMs(startedAt),
      exitCode: outcome.exitCode,
      stderrTail: commandFailureTail(outcome, limitError),
    })
    if (limitError) throw limitError

    const result = { exitCode: outcome.exitCode, stderr: outcome.stderr, stdout: outcome.stdout }
    if (options.allowFailure || outcome.exitCode === 0) return result

    throw new FsError('GIT_COMMAND_FAILED', gitErrorMessage(result))
  }
}

async function mapWithConcurrency<T, U>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<U>,
) {
  const results: U[] = []
  let nextIndex = 0
  const workerCount = Math.min(concurrency, items.length)
  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1
      results[index] = await mapper(items[index], index)
    }
  })

  await Promise.all(workers)
  return results
}

function positiveInteger(value: number | undefined, fallback: number) {
  if (value === undefined) return fallback
  if (!Number.isInteger(value) || value < 1) return fallback

  return value
}

/**
 * Only ever asked of text git already handed us as a string, so a NUL is the whole test: git's own
 * binary detection reads the first 8k for one, and a decoded blob that holds one is not something a
 * text editor can draw.
 */
function isBinaryText(text: string) {
  return text.includes('\u0000')
}

function isBinaryDiff(diff: GitFileDiff) {
  return diff.patch.includes('\nBinary files ') || diff.patch.includes('\nGIT binary patch')
}

function isTooLarge(size: number | null, maxBytes: number) {
  return size !== null && size > maxBytes
}

function recordGitServiceOperation(
  operation: string,
  path = '',
  fields: Record<string, unknown> = {},
) {
  recordRequestContext({
    area: 'git',
    git: {
      operation,
      path,
      ...fields,
    },
    operation,
  })
}

function gitAction(args: readonly string[]) {
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (!argument) continue
    if (['-C', '-c', '--git-dir', '--work-tree'].includes(argument)) {
      index += 1
      continue
    }
    if (!argument.startsWith('-')) return argument
  }
  return 'unknown'
}

function isReadOnlyGit(args: readonly string[]) {
  const action = gitAction(args)
  if (READ_ONLY_GIT_ACTIONS.has(action)) return true
  const actionIndex = args.indexOf(action)
  if (action === 'config') return args.includes('--get-regexp')
  // Listing remotes reads config; `remote add` and friends write it.
  if (action === 'remote') return [undefined, '-v', 'get-url'].includes(args[actionIndex + 1])
  return action === 'worktree' && args[actionIndex + 1] === 'list'
}

/** NUL-joined so the root prefix can never be forged by a pathspec. */
function statusCacheKey(repository: GitRepositoryLocation) {
  return `${repository.rootAbsolutePath}\u0000${repository.pathspec ?? ''}`
}

function commandFailureTail(outcome: GitProcessResult, limitError: Error | null) {
  if (limitError) return limitError.message
  if (outcome.exitCode === 0) return undefined

  return limitText(outcome.stderr, 500)
}
