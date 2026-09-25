import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import path from 'node:path'

import { recordRequestContext } from '../observability'
import { gitCommonDirectory } from './repository-lane'
import type { GitFileDiff, GitRepositoryRunner, GitService } from './service'
import { gitCheckpointErrors } from './utils/checkpoint-errors'

export type CheckpointCaptureInput = {
  path: string
  ref: string
}

export type CheckpointRefInput = {
  path: string
  ref: string
}

export type CheckpointRestoreInput = {
  fallbackToHead?: boolean
  path: string
  ref: string
}

export type CheckpointDiffInput = {
  /** Treat a missing `fromRef` as HEAD instead of failing (turn-zero fallback). */
  fallbackFromToHead?: boolean
  fromRef: string
  ignoreWhitespace: boolean
  path: string
  toRef: string
}

export type CheckpointDeleteInput = {
  path: string
  refs: readonly string[]
}

/**
 * Checkpoint commits are not the user's commits: they never appear in `git log`,
 * they are attributed to the app, and reusing the user's configured identity
 * would make a hidden ref look like work they authored.
 */
const CHECKPOINT_IDENTITY = {
  GIT_AUTHOR_EMAIL: 'checkpoint@platform.local',
  GIT_AUTHOR_NAME: 'Platform Checkpoint',
  GIT_COMMITTER_EMAIL: 'checkpoint@platform.local',
  GIT_COMMITTER_NAME: 'Platform Checkpoint',
} as const

/**
 * Captures the worktree as a hidden git ref without disturbing the user.
 *
 * Every staging step runs against a throwaway `GIT_INDEX_FILE` inside the git
 * common dir, so `git add -A` never touches the real index: whatever the user
 * had staged when a turn started is still staged when the checkpoint lands.
 * Seeding that temp index from HEAD first keeps the capture cheap (git can
 * reuse the stat cache) and makes deletions show up as deletions rather than
 * as an index that simply never knew about the file.
 */
export class GitCheckpointStore {
  private readonly git: GitService

  constructor(git: GitService) {
    this.git = git
  }

  /** Writes the current worktree to `ref` and returns the checkpoint commit. */
  async capture(input: CheckpointCaptureInput): Promise<string> {
    recordCheckpointOperation('checkpoint_capture', input.path, { ref: input.ref })
    const runner = await this.git.repositoryRunner(input.path)
    const indexFile = await temporaryIndexPath(runner)

    try {
      const commit = await writeCheckpointCommit(runner, input.ref, indexFile)
      recordCheckpointOperation('checkpoint_capture', input.path, { commit })
      return commit
    } finally {
      await rm(indexFile, { force: true })
    }
  }

  has(input: CheckpointRefInput): Promise<boolean> {
    return this.git.hasRef(input)
  }

  restore(input: CheckpointRestoreInput): Promise<boolean> {
    return this.git.restoreRef(input)
  }

  deleteRefs(input: CheckpointDeleteInput): Promise<void> {
    return this.git.deleteRefs(input)
  }

  async diff(input: CheckpointDiffInput): Promise<GitFileDiff[]> {
    const oldRef = await this.diffBaseRef(input)

    return this.git.diffRefs({
      ignoreWhitespace: input.ignoreWhitespace,
      newRef: input.toRef,
      oldRef,
      path: input.path,
    })
  }

  private async diffBaseRef(input: CheckpointDiffInput) {
    if (await this.git.hasRef({ path: input.path, ref: input.fromRef })) return input.fromRef
    if (!input.fallbackFromToHead) {
      throw gitCheckpointErrors.CHECKPOINT_REF_UNAVAILABLE({ ref: input.fromRef })
    }
    if (await this.git.hasRef({ path: input.path, ref: 'HEAD' })) return 'HEAD'

    throw gitCheckpointErrors.CHECKPOINT_REF_UNAVAILABLE({ ref: input.fromRef })
  }
}

async function writeCheckpointCommit(
  runner: GitRepositoryRunner,
  ref: string,
  indexFile: string,
): Promise<string> {
  const env = { ...CHECKPOINT_IDENTITY, GIT_INDEX_FILE: indexFile }
  if (await hasHeadCommit(runner)) await runner.run(['read-tree', 'HEAD'], { env })
  // `--all` respects .gitignore, so a checkpoint carries the untracked files an
  // agent just wrote without dragging node_modules or build output along.
  await runner.run(['add', '--all', '--', '.'], { env })

  const tree = (await runner.run(['write-tree'], { env })).stdout.trim()
  if (!tree) throw gitCheckpointErrors.CHECKPOINT_TREE_EMPTY({ ref })

  const message = `platform checkpoint ref=${ref}`
  const commit = (await runner.run(['commit-tree', tree, '-m', message], { env })).stdout.trim()
  if (!commit) throw gitCheckpointErrors.CHECKPOINT_COMMIT_EMPTY({ ref })

  await runner.run(['update-ref', ref, commit])

  return commit
}

async function hasHeadCommit(runner: GitRepositoryRunner) {
  const result = await runner.run(['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'], {
    allowFailure: true,
  })

  return result.exitCode === 0
}

/**
 * The temp index lives in the git common dir rather than the OS temp dir: git
 * only accepts an index on a filesystem it can lock, and a worktree shares its
 * object store (and therefore its common dir) with the main checkout.
 */
async function temporaryIndexPath(runner: GitRepositoryRunner) {
  return path.join(await gitCommonDirectory(runner), `checkpoint-index-${randomUUID()}`)
}

function recordCheckpointOperation(
  operation: string,
  checkpointPath: string,
  fields: Record<string, unknown>,
) {
  recordRequestContext({
    area: 'git',
    git: { operation, path: checkpointPath, ...fields },
    operation,
  })
}
