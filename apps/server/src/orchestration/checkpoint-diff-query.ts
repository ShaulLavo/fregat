import { maxCheckpointTurnCount } from './checkpoint-turn-count'
import { asc, eq } from 'drizzle-orm'
import * as v from 'valibot'

import type { GitFileDiff, GitService } from '../git/service'
import { projectionSessionCheckpoints, type ProjectionSessionCheckpointRow } from '../db/schema'
import type { OrchestrationDatabase } from './event-store'
import { checkpointRefForSessionTurn } from './checkpoint-refs'
import { checkpointErrors } from './structured-errors'
import { readSessionOwner } from './session-owner'
import {
  orchestrationGetFullSessionDiffInputSchema,
  orchestrationGetTurnDiffInputSchema,
  type OrchestrationGetFullSessionDiffInput,
  type OrchestrationGetTurnDiffInput,
} from '@workspace/contracts'

type SessionCheckpointContext = {
  checkpoints: ProjectionSessionCheckpointRow[]
  sessionId: string
  workspacePath: string
  baseCommit: string | null
}

export class OrchestrationCheckpointDiffQuery {
  private readonly database: OrchestrationDatabase
  private readonly git: GitService

  constructor(database: OrchestrationDatabase, git: GitService) {
    this.database = database
    this.git = git
  }

  async turnDiff(input: OrchestrationGetTurnDiffInput): Promise<GitFileDiff[]> {
    const query = v.parse(orchestrationGetTurnDiffInputSchema, input)
    validateTurnRange(query)

    const context = this.sessionCheckpointContext(query.sessionId)
    if (query.fromTurnCount === query.toTurnCount) return []

    const refs = checkpointRefsForRange(query, context)
    await this.assertCheckpointRefAvailable(context, refs.fromRef, query.fromTurnCount)
    await this.assertCheckpointRefAvailable(context, refs.toRef, query.toTurnCount)
    return this.git.diffRefs({
      ignoreWhitespace: query.ignoreWhitespace,
      newRef: refs.toRef,
      oldRef: refs.fromRef,
      path: context.workspacePath,
    })
  }

  fullSessionDiff(input: OrchestrationGetFullSessionDiffInput): Promise<GitFileDiff[]> {
    const query = v.parse(orchestrationGetFullSessionDiffInputSchema, input)

    return this.turnDiff({
      fromTurnCount: 0,
      ignoreWhitespace: query.ignoreWhitespace,
      sessionId: query.sessionId,
      toTurnCount: query.toTurnCount,
    })
  }

  /** The number of the session's latest checkpointed turn; 0 before the first. */
  latestTurnCount(sessionId: string) {
    return maxCheckpointTurnCount(this.checkpointRows(sessionId))
  }

  private sessionCheckpointContext(sessionId: string): SessionCheckpointContext {
    const { worktree } = readSessionOwner(this.database, sessionId)
    const workspacePath = worktree.canonicalPath

    return {
      checkpoints: this.checkpointRows(sessionId),
      sessionId,
      workspacePath,
      baseCommit: worktree.ownership === 'platform' ? worktree.baseCommit : null,
    }
  }

  /** The projection is the source: reverts already pruned what it no longer holds. */
  private checkpointRows(sessionId: string) {
    return this.database
      .select()
      .from(projectionSessionCheckpoints)
      .where(eq(projectionSessionCheckpoints.sessionId, sessionId))
      .orderBy(asc(projectionSessionCheckpoints.checkpointTurnCount))
      .all()
  }

  private async assertCheckpointRefAvailable(
    context: SessionCheckpointContext,
    ref: string,
    turnCount: number,
  ) {
    if (await this.git.hasRef({ path: context.workspacePath, ref })) return

    throw checkpointErrors.REF_UNAVAILABLE({ turnCount, internal: { ref } })
  }
}

function validateTurnRange(input: OrchestrationGetTurnDiffInput) {
  if (input.fromTurnCount <= input.toTurnCount) return

  throw checkpointErrors.RANGE_INVALID({
    fromTurnCount: input.fromTurnCount,
    toTurnCount: input.toTurnCount,
  })
}

function checkpointRefsForRange(
  input: OrchestrationGetTurnDiffInput,
  context: SessionCheckpointContext,
) {
  const availableTurnCount = maxCheckpointTurnCount(context.checkpoints)
  if (input.toTurnCount > availableTurnCount) {
    throw checkpointErrors.RANGE_EXCEEDS_TURN_COUNT({
      availableTurnCount,
      requestedTurnCount: input.toTurnCount,
    })
  }

  return {
    fromRef: checkpointRefForTurnCount(context, input.fromTurnCount),
    toRef: checkpointRefForTurnCount(context, input.toTurnCount),
  }
}

function checkpointRefForTurnCount(context: SessionCheckpointContext, turnCount: number) {
  if (turnCount === 0)
    return context.baseCommit ?? checkpointRefForSessionTurn(context.sessionId, 0)

  const checkpoint = context.checkpoints.find(
    (candidate) => candidate.checkpointTurnCount === turnCount,
  )
  if (!checkpoint) throw checkpointErrors.REF_UNAVAILABLE({ turnCount })
  if (checkpoint.status !== 'ready') throw checkpointErrors.REF_UNAVAILABLE({ turnCount })

  return checkpoint.checkpointRef
}
