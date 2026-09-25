import type { WorktreeId } from './chat-ids'
/**
 * Git request/response DTOs that cross the server↔web boundary. Both
 * apps/server and apps/web consume these shared definitions rather than
 * maintaining parallel copies.
 */

export type GitTreeStatus = 'added' | 'deleted' | 'ignored' | 'modified' | 'renamed' | 'untracked'

export type GitLineStat = {
  additions: number
  deletions: number
}

export type GitFileStatus = {
  path: string
  oldPath?: string
  index: GitTreeStatus | 'unmodified' | 'conflicted'
  worktree: GitTreeStatus | 'unmodified' | 'conflicted'
  status: GitTreeStatus | 'conflicted'
  /** Absent for a binary file, or a side with no change. */
  lines?: { staged?: GitLineStat; worktree?: GitLineStat }
}

export type GitRepositoryInfo = {
  branch: string | null
  commit: string | null
  ahead: number
  behind: number
  path: string
}

export type GitStatusResult = {
  repository: GitRepositoryInfo | null
  files: GitFileStatus[]
  /** Submodules this repository declares that have no checkout yet. */
  uninitializedSubmodules: number
  /** Null when automatic pull is off for this checkout. */
  autoPull: GitAutoPullState | null
}

export type GitAutoPullSkipReason =
  | 'changes'
  | 'ahead'
  | 'diverged'
  | 'detached'
  | 'no-upstream'
  | 'no-default-branch'
  | 'other-branch'

/** Whether a checkout can fast-forward to its upstream on its own, and why not. */
export type GitAutoPullState =
  | { state: 'current' }
  | { state: 'pulling' }
  | { state: 'skipped'; reason: GitAutoPullSkipReason; defaultBranch: string | null }
  | { state: 'failed'; message: string }

/** How a new worktree populates submodules: every nested level, declared ones only, or none. */
export const WORKTREE_SUBMODULE_MODES = ['recursive', 'top-level', 'none'] as const
export type WorktreeSubmoduleMode = (typeof WORKTREE_SUBMODULE_MODES)[number]

export type GitLineChange = {
  type: 'added' | 'deleted' | 'context'
  oldLine: number | null
  newLine: number | null
  text: string
}

export type GitDiffHunk = {
  header: string
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  patch: string
  changes: GitLineChange[]
}

export type GitFileDiff = {
  path: string
  oldPath?: string
  oldFileMissing?: boolean
  newFileMissing?: boolean
  oldObjectId?: string
  newObjectId?: string
  oldText?: string
  newText?: string
  staged: boolean
  patch: string
  hunks: GitDiffHunk[]
}

export type GitBranch = {
  current: boolean
  name: string
  upstream: string | null
  commit: string
}

export type GitBranchesResult = {
  repository: GitRepositoryInfo | null
  branches: GitBranch[]
}

export type GitHistoryCommit = {
  id: string
  parents: readonly string[]
  subject: string
  author: string
  authorEmail: string
  timestamp: number
}

export type GitHistoryRef = {
  name: string
  kind: 'branch' | 'remote' | 'tag' | 'head'
  commitId: string
}

export type GitHistoryCursor = { tips: string[]; skip: number }

export type GitHistoryPage = {
  commits: readonly GitHistoryCommit[]
  refs: readonly GitHistoryRef[]
  next: GitHistoryCursor | null
}

export type GitCommitFile = {
  path: string
  oldPath?: string
  status: 'added' | 'deleted' | 'modified' | 'renamed'
  oldObjectId?: string
  newObjectId?: string
  kind: 'file' | 'submodule'
}

export type GitCommitDetails = GitHistoryCommit & {
  message: string
  files: readonly GitCommitFile[]
}

export type GitCommitResult =
  | {
      kind: 'committed'
      output: string
      repository: GitRepositoryInfo
    }
  | {
      kind: 'message-file'
      path: string
      repository: GitRepositoryInfo
    }
  /** The message file held nothing but comments, which is how a commit is called off. */
  | {
      kind: 'aborted'
      repository: GitRepositoryInfo
    }

/**
 * A commit reported as it happens, because a commit runs the repository's
 * hooks: a forty-second pre-commit hook and a wedged one look identical while
 * the only signal is a button that has not come back yet.
 *
 * `progress` frames carry hook output verbatim, tagged with the pipe they came
 * from — hooks conventionally write status to stderr and that is not an error.
 */
export type GitCommitProgressEvent =
  | { kind: 'progress'; stream: 'stderr' | 'stdout'; text: string }
  | { kind: 'result'; result: GitCommitResult }
  | { kind: 'failed'; message: string }

/**
 * One entry of `git worktree list`. Both paths are carried because they answer
 * different questions: `path` is what every other git route speaks, while
 * `absolutePath` is what a session's agent process is spawned with.
 */
export type GitWorktree = {
  absolutePath: string
  branch: string | null
  commit: string | null
  detached: boolean
  locked: boolean
  /** The repository's own checkout. It backs every linked worktree, so it is never removable. */
  main: boolean
  /** Workspace-relative path, or null when the worktree sits outside the workspace. */
  path: string | null
  prunable: boolean
  /** An ID derived from a managed path, never proof of ownership. */
  worktreeId: WorktreeId | null
}

export type GitWorktreeCreateResult = {
  /** False when the requested worktree already exists. */
  created: boolean
  worktree: GitWorktree
}

export type GitWorktreeRemoveResult = {
  removed: GitWorktree
  worktrees: GitWorktree[]
}

/**
 * A base a branch can be compared against. Local and remote are paired so the
 * picker offers `main` once instead of twice, while still remembering that the
 * comparison should run against `origin/main` when the remote is ahead.
 */
export type GitBaseRefChoice = {
  id: string
  label: string
  local: string | null
  remote: string | null
}

export type GitBaseRefChoicesResult = {
  choices: GitBaseRefChoice[]
  /** The choice a branch diff picks when the caller names no base. */
  defaultChoiceId: string | null
}

export type GitBranchDiffResult = {
  /** The base after the selection rules ran — never the raw request. */
  baseRef: string
  files: GitFileDiff[]
  headRef: string
  /** Where the branch left the base; null when the two share no history. */
  mergeBase: string | null
}

/**
 * A branch's standing against its remote. Local git only — reading it costs one
 * `rev-parse` on top of the status the caller already ran.
 *
 * Deliberately separate from `GitPullRequestState`: that one shells out to `gh`
 * and waits on GitHub, and a header that cannot say "Publish" until a network
 * round-trip returns is a header that is blank whenever the network is slow.
 */
export type GitBranchRemoteState = {
  /** Commits on the branch the upstream does not have. Zero when there is no upstream. */
  ahead: number
  behind: number
  branch: string | null
  /** False on a fresh branch, which is what makes a push need `--set-upstream`. */
  hasUpstream: boolean
  /** False when the repository has no remote at all: there is nowhere to push until one is published. */
  hasRemote: boolean
}

/**
 * What the GitHub CLI could tell us about a branch's pull request.
 *
 * `pullRequest` being null means "there is no pull request"; a `support` other
 * than `ready` means "we could not ask". They are different answers and the
 * caller must never render the second as the first — offering "Create pull
 * request" to someone who already has one open is the exact failure.
 */
export type GitPullRequestState = {
  branch: string | null
  pullRequest: GitPullRequest | null
  support: GitPullRequestSupport
  /** The hosting service the remote points at; null when no remote names a known one. */
  forge: GitForge | null
}

/** Hosting services with pull (merge) requests, as upstream T3 Code registers them. */
export const GIT_FORGE_KINDS = ['github', 'gitlab', 'forgejo', 'azure-devops', 'bitbucket'] as const
export type GitForgeKind = (typeof GIT_FORGE_KINDS)[number]

export type GitForge = {
  kind: GitForgeKind
  /** "GitHub", "GitLab Self-Hosted", … */
  name: string
  host: string
}

/**
 * Why a pull request could not be read or created. Every non-`ready` value is
 * actionable by the user, so each one is a distinct case rather than a message.
 */
export type GitPullRequestSupport =
  | 'ready'
  /** The forge's CLI (`gh`, `glab`, `tea`, `az`) is not on PATH. */
  | 'cli-missing'
  /** The CLI is installed, or the API reachable, but nobody has signed in. */
  | 'unauthenticated'
  /** No remote points at a known forge, so there is nothing to ask. */
  | 'no-forge'

export type GitPullRequest = {
  /** Merge or close time, when the lookup asked for it. */
  closedAt?: string | null
  draft: boolean
  number: number
  state: 'closed' | 'merged' | 'open'
  title: string
  url: string
}

export type GitPushResult = {
  branch: string
  output: string
  repository: GitRepositoryInfo
  /** True when the push had to create the upstream ref, not just update it. */
  setUpstream: boolean
}

export type GitPullRequestCreateResult =
  | { kind: 'created'; pullRequest: GitPullRequest }
  /** A branch can only have one open pull request, so a second attempt is a no-op. */
  | { kind: 'exists'; pullRequest: GitPullRequest }
  | { kind: 'unsupported'; support: GitPullRequestSupport }

/** Where a `git clone` is, from its progress lines. */
export type GitCloneStage = 'connecting' | 'counting' | 'receiving' | 'resolving' | 'checkout'

export type GitCloneProgressEvent =
  | { kind: 'progress'; stage: GitCloneStage; percent: number | null }
  /** The checkout is complete and registered as a project. */
  | { kind: 'result'; path: string; projectId: string | null }
  | { kind: 'failed'; message: string }

export type GitRepositoryVisibility = 'private' | 'public'

/** Create a repository on a forge for a checkout that has no remote, then push to it. */
export type GitPublishRequest = {
  path: string
  forge: GitForgeKind
  /** Defaults to the forge's public host. */
  host?: string
  /** `owner/name`; Azure DevOps takes `organization/project/name`. */
  repository: string
  visibility: GitRepositoryVisibility
  protocol: 'ssh' | 'https'
}

export type GitPublishResult = {
  url: string
  remoteName: string
  remoteUrl: string
  branch: string | null
  /** `remote-added`: nothing to push yet. `push-failed`: the repository exists, the push did not land. */
  status: 'pushed' | 'remote-added' | 'push-failed'
  pushError: string | null
}
