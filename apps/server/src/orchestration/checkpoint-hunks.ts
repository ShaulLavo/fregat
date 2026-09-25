import * as v from 'valibot'
import {
  orchestrationCheckpointHunksInputSchema,
  orchestrationRevertCheckpointHunkInputSchema,
  type OrchestrationCheckpointHunk,
  type OrchestrationCheckpointHunksInput,
  type OrchestrationCheckpointHunkState,
  type OrchestrationRevertCheckpointHunkInput,
} from '@workspace/contracts'

import type { GitFileDiff, GitService } from '../git/service'
import type { ProviderRuntimeBindingWithMetadata } from '../provider/provider-session-directory'
import type { OrchestrationCheckpointDiffQuery } from './checkpoint-diff-query'
import { requireSettleable } from './command-invariants'
import type { OrchestrationReadModel } from './read-model'
import { requireNoPendingRewind } from './rewind-admission'
import { otherRuntimeOverlaps } from './rewind-isolation'
import { resolveSessionOwner } from './session-owner'
import { checkpointErrors } from './structured-errors'

type CheckpointHunksDependencies = {
  readonly runWorkspaceOperation: <T>(
    sessionId: OrchestrationCheckpointHunksInput['sessionId'],
    operation: () => Promise<T>,
  ) => Promise<T>
  readonly activeRuntimes: () => Promise<readonly ProviderRuntimeBindingWithMetadata[]>
  readonly diffs: Pick<OrchestrationCheckpointDiffQuery, 'turnDiff'>
  readonly git: Pick<GitService, 'applyPatch' | 'patchApplies'>
  readonly readModel: () => Promise<OrchestrationReadModel>
}

/**
 * One turn's changes, taken back or put back one at a time. The server builds every patch
 * from the turn's own refs and whitespace-exact diff; a client names a change only by id.
 */
export class OrchestrationCheckpointHunks {
  private readonly dependencies: CheckpointHunksDependencies

  constructor(dependencies: CheckpointHunksDependencies) {
    this.dependencies = dependencies
  }

  /** Each change of the turn and whether the worktree still has it, checked with `git apply`. */
  async states(input: OrchestrationCheckpointHunksInput): Promise<OrchestrationCheckpointHunk[]> {
    const query = v.parse(orchestrationCheckpointHunksInputSchema, input)
    const { files, workspacePath } = await this.turnFiles(query.sessionId, query.turnCount)
    const hunks: OrchestrationCheckpointHunk[] = []
    for (const file of files) {
      for (const hunk of file.hunks) {
        const patch = hunkPatch(file, hunk.patch)
        const state = await this.hunkState(workspacePath, patch)
        hunks.push({ hunkId: hunk.id, path: file.path, state })
      }
    }
    return hunks
  }

  /**
   * Undoes (or reapplies) one change, or the whole file, in the session's worktree. Refused
   * while the session's turn runs, while a rewind is pending, while another session's agent
   * works in the same checkout, and when the lines have changed since.
   */
  async revert(input: OrchestrationRevertCheckpointHunkInput) {
    const command = v.parse(orchestrationRevertCheckpointHunkInputSchema, input)
    return this.dependencies.runWorkspaceOperation(command.sessionId, () =>
      this.revertReserved(command),
    )
  }

  private async revertReserved(command: OrchestrationRevertCheckpointHunkInput) {
    const model = await this.dependencies.readModel()
    const { session, worktree } = resolveSessionOwner(model, command.sessionId)
    requireSettleable(session, 'session.checkpoint.hunk-revert', new Date().toISOString())
    requireNoPendingRewind(session)
    const runtimes = await this.dependencies.activeRuntimes()
    if (await otherRuntimeOverlaps(session.id, worktree.canonicalPath, runtimes))
      throw checkpointErrors.WORKSPACE_NOT_ISOLATED({
        internal: { check: 'overlapping-runtime', operation: 'hunk-revert' },
      })

    const { files, workspacePath } = await this.turnFiles(command.sessionId, command.turnCount)
    const patch = revertPatch(files, command)
    const reverse = command.reapply !== true
    if (!(await this.dependencies.git.patchApplies({ path: workspacePath, patch, reverse })))
      throw checkpointErrors.HUNK_CONFLICT({
        path: command.path,
        internal: { reverse, whole: command.hunkId === null },
      })

    return this.dependencies.git.applyPatch({
      path: workspacePath,
      patch,
      reverse,
      target: 'worktree',
    })
  }

  private async turnFiles(sessionId: OrchestrationCheckpointHunksInput['sessionId'], turn: number) {
    const model = await this.dependencies.readModel()
    const { worktree } = resolveSessionOwner(model, sessionId)
    const files = await this.dependencies.diffs.turnDiff({
      fromTurnCount: turn - 1,
      ignoreWhitespace: false,
      sessionId,
      toTurnCount: turn,
    })
    return { files, workspacePath: worktree.canonicalPath }
  }

  private async hunkState(
    workspacePath: string,
    patch: string,
  ): Promise<OrchestrationCheckpointHunkState> {
    const { git } = this.dependencies
    if (await git.patchApplies({ path: workspacePath, patch, reverse: true })) return 'applied'
    if (await git.patchApplies({ path: workspacePath, patch, reverse: false })) return 'reverted'
    return 'changed'
  }
}

function revertPatch(
  files: readonly GitFileDiff[],
  command: OrchestrationRevertCheckpointHunkInput,
) {
  const file = files.find((candidate) => candidate.path === command.path)
  if (!file)
    throw checkpointErrors.HUNK_NOT_FOUND({ path: command.path, internal: { whole: true } })
  // The whole file keeps git's own header, so a rename or a new file is taken back too.
  if (command.hunkId === null) return file.patch

  const hunk = file.hunks.find((candidate) => candidate.id === command.hunkId)
  if (!hunk)
    throw checkpointErrors.HUNK_NOT_FOUND({
      path: command.path,
      internal: { hunkCount: file.hunks.length },
    })
  return hunkPatch(file, hunk.patch)
}

/**
 * One hunk against the file as it now stands. Content only: rename and mode lines belong to
 * the whole-file undo, so both sides name the file's current git path. A file the turn created
 * or deleted keeps git's header, so taking its hunk back removes or restores the file.
 */
function hunkPatch(file: GitFileDiff, hunk: string) {
  const header = fileHeader(file.patch)
  if (file.oldFileMissing || file.newFileMissing) return `${header}${hunk}`
  const target = header.split('\n').find((line) => line.startsWith('+++ b/'))
  if (!target) return `${header}${hunk}`
  const path = target.slice('+++ b/'.length)
  return `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n${hunk}`
}

function fileHeader(patch: string) {
  const start = patch.search(/^@@/m)
  return start < 0 ? patch : patch.slice(0, start)
}
