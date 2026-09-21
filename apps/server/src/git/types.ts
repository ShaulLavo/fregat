import type { GitRepositoryInfo } from '@workspace/contracts'

export type {
  GitBaseRefChoicesResult,
  GitBranch,
  GitBranchDiffResult,
  GitBranchesResult,
  GitCommitResult,
  GitDiffHunk,
  GitFileDiff,
  GitFileStatus,
  GitLineChange,
  GitLineStat,
  GitRepositoryInfo,
  GitStatusResult,
  GitWorktree,
  GitWorktreeCreateResult,
  GitWorktreeRemoveResult,
} from '@workspace/contracts'

export type GitCommandResult = {
  stdout: string
  stderr: string
  exitCode: number
}

export type GitRepository = {
  rootAbsolutePath: string
  rootDisplayAbsolutePath: string
  rootPath: string
  pathspec: string | null
  info: GitRepositoryInfo
}
