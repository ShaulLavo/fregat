import { clientLogContext } from '@/lib/environments/state/log-context'
import type { SessionId } from '@workspace/contracts'

import { getClient, type Client } from '@/lib/client'
import { observeClientOperation } from '@/lib/client-logging'
import { unwrapEdenResponse } from '@/lib/eden-events'
import { gitKeys } from '@/lib/query-keys'
import type { CheckpointDiffDocumentInput } from '@/features/git/utils/diff-document'
import type { FileDiff, FileStatus } from '@/features/git/utils/types'
import type { ChatTurnDiffSummary } from '@workspace/client-core/chat/types'

export type CheckpointDiffQueryInput = {
  filePath?: string
  fromTurnCount: number
  /**
   * Every client fetch is a *display* diff, so the builders pin `true`:
   * whitespace-only hunks are noise to a reader. Stat counting is the server's
   * own path (the checkpoint reactor pins `false` there). The flag rides the
   * cache key because the two answers to the same range genuinely differ.
   */
  ignoreWhitespace?: boolean
  path?: string
  scope?: 'file' | 'session' | 'turn'
  sessionId: SessionId
  toTurnCount: number
}

export function checkpointDiffQueryKey(input: CheckpointDiffQueryInput) {
  return gitKeys.checkpointDiff({
    filePath: input.filePath,
    fromTurnCount: input.fromTurnCount,
    ignoreWhitespace: input.ignoreWhitespace,
    path: input.path,
    scope: input.scope,
    sessionId: input.sessionId,
    toTurnCount: input.toTurnCount,
  })
}

export function checkpointDiffInputForSummary(
  summary: ChatTurnDiffSummary,
  path?: string,
): CheckpointDiffQueryInput {
  return {
    filePath: path,
    fromTurnCount: Math.max(0, summary.checkpointTurnCount - 1),
    ignoreWhitespace: true,
    path,
    scope: path ? 'file' : 'turn',
    sessionId: summary.sessionId,
    toTurnCount: summary.checkpointTurnCount,
  }
}

export function checkpointFullSessionDiffInputForSummary(
  summary: ChatTurnDiffSummary,
): CheckpointDiffQueryInput {
  return {
    fromTurnCount: 0,
    ignoreWhitespace: true,
    path: checkpointFullSessionDocumentPath(summary),
    scope: 'session',
    sessionId: summary.sessionId,
    toTurnCount: summary.checkpointTurnCount,
  }
}

export function canOpenCheckpointDiff(summary: ChatTurnDiffSummary) {
  if (summary.status !== 'ready') return false

  return summary.files.length > 0
}

export function checkpointDiffDocumentInput(
  summary: ChatTurnDiffSummary,
  path: string,
  diff: FileDiff | null,
): CheckpointDiffDocumentInput {
  const rangeInput = checkpointDiffInputForSummary(summary, path)

  return {
    filePath: path,
    fromTurnCount: rangeInput.fromTurnCount,
    newObjectId: diff?.newObjectId,
    oldObjectId: diff?.oldObjectId,
    oldPath: diff?.oldPath,
    path,
    scope: 'file',
    status: diff ? diffStatus(diff) : undefined,
    sessionId: rangeInput.sessionId,
    toTurnCount: rangeInput.toTurnCount,
  }
}

export function checkpointTurnDiffDocumentInput(
  summary: ChatTurnDiffSummary,
): CheckpointDiffDocumentInput {
  const rangeInput = checkpointDiffInputForSummary(summary)

  return {
    fromTurnCount: rangeInput.fromTurnCount,
    path: checkpointTurnDocumentPath(summary),
    scope: 'turn',
    sessionId: rangeInput.sessionId,
    toTurnCount: rangeInput.toTurnCount,
  }
}

export function checkpointFullSessionDiffDocumentInput(
  summary: ChatTurnDiffSummary,
): CheckpointDiffDocumentInput {
  const input = checkpointFullSessionDiffInputForSummary(summary)

  return {
    fromTurnCount: input.fromTurnCount,
    path: input.path ?? checkpointFullSessionDocumentPath(summary),
    scope: 'session',
    sessionId: input.sessionId,
    toTurnCount: input.toTurnCount,
  }
}

export function matchingCheckpointDiff(diffs: readonly FileDiff[], path: string | undefined) {
  if (!path) return null

  return diffs.find((diff) => checkpointDiffMatchesPath(diff, path)) ?? null
}

export async function fetchCheckpointDiff(
  input: CheckpointDiffQueryInput,
  signal?: AbortSignal,
  client: Client = getClient(),
) {
  if (input.scope === 'session') {
    return fetchFullSessionCheckpointDiff(input, signal, client)
  }

  return observeClientOperation(
    {
      ...clientLogContext(client),
      action: 'chat.checkpoint_diff.http',
      area: 'chat',
      fromTurnCount: input.fromTurnCount,
      path: checkpointDiffFilePath(input),
      scope: input.scope,
      sessionId: input.sessionId,
      toTurnCount: input.toTurnCount,
    },
    async () => {
      const response = await client.orchestration['turn-diff'].get({
        fetch: { signal },
        query: {
          fromTurnCount: input.fromTurnCount,
          ignoreWhitespace: input.ignoreWhitespace ?? true,
          sessionId: input.sessionId,
          toTurnCount: input.toTurnCount,
        },
      })
      const diffs = unwrapEdenResponse<FileDiff[]>(response)

      return filterCheckpointDiffsForPath(diffs, checkpointDiffFilePath(input))
    },
    (diffs) => ({ diffCount: diffs.length }),
  )
}

async function fetchFullSessionCheckpointDiff(
  input: Pick<CheckpointDiffQueryInput, 'ignoreWhitespace' | 'sessionId' | 'toTurnCount'>,
  signal: AbortSignal | undefined,
  client: Client,
) {
  return observeClientOperation(
    {
      ...clientLogContext(client),
      action: 'chat.full_session_checkpoint_diff.http',
      area: 'chat',
      sessionId: input.sessionId,
      toTurnCount: input.toTurnCount,
    },
    async () => {
      const response = await client.orchestration['full-session-diff'].get({
        fetch: { signal },
        query: {
          ignoreWhitespace: input.ignoreWhitespace ?? true,
          sessionId: input.sessionId,
          toTurnCount: input.toTurnCount,
        },
      })

      return unwrapEdenResponse<FileDiff[]>(response)
    },
    (diffs) => ({ diffCount: diffs.length }),
  )
}

/**
 * Retry policy off the typed catalog code, not the message: a reworded message
 * used to silently turn a permanent range failure into a retry loop. Only
 * RANGE_INVALID is permanent — a missing ref or a turn count overtaken by a
 * revert can resolve itself as the projection catches up.
 */
export function checkpointDiffRetry(failureCount: number, error: unknown) {
  if (failureCount >= 2) return false

  return structuredErrorCode(error) !== 'checkpoint.RANGE_INVALID'
}

function structuredErrorCode(error: unknown) {
  if (!error || typeof error !== 'object') return null
  if (!('code' in error)) return null

  const code = error.code
  return typeof code === 'string' ? code : null
}

export function checkpointDiffRetryDelay(attemptIndex: number) {
  return Math.min(250 * 2 ** attemptIndex, 1_000)
}

function checkpointDiffFilePath(input: CheckpointDiffQueryInput) {
  return input.filePath ?? (input.scope === 'file' ? input.path : undefined)
}

function filterCheckpointDiffsForPath(diffs: readonly FileDiff[], path: string | undefined) {
  if (!path) return diffs

  return diffs.filter((diff) => checkpointDiffMatchesPath(diff, path))
}

function checkpointDiffMatchesPath(diff: FileDiff, path: string) {
  if (samePath(diff.path, path)) return true
  if (!diff.oldPath) return false

  return samePath(diff.oldPath, path)
}

function samePath(left: string, right: string) {
  const normalizedLeft = normalizeDiffPath(left)
  const normalizedRight = normalizeDiffPath(right)
  if (normalizedLeft === normalizedRight) return true
  if (normalizedLeft.endsWith(`/${normalizedRight}`)) return true

  return normalizedRight.endsWith(`/${normalizedLeft}`)
}

function normalizeDiffPath(path: string) {
  return path.replaceAll('\\', '/').replace(/^\.\//, '').replace(/^\/+/, '')
}

function diffStatus(diff: FileDiff): FileStatus['index'] | FileStatus['worktree'] {
  if (diff.oldPath && diff.oldPath !== diff.path) return 'renamed'
  if (diff.oldFileMissing) return 'added'
  if (diff.newFileMissing) return 'deleted'

  return 'modified'
}

function checkpointTurnDocumentPath(summary: ChatTurnDiffSummary) {
  return `checkpoint-turn-${summary.checkpointTurnCount}`
}

function checkpointFullSessionDocumentPath(summary: ChatTurnDiffSummary) {
  return `checkpoint-session-${summary.checkpointTurnCount}`
}
