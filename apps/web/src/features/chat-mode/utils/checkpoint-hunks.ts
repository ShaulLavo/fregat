import { queryOptions } from '@tanstack/react-query'
import type {
  GitFileDiff,
  GitStatusResult,
  OrchestrationCheckpointHunk,
  OrchestrationRevertCheckpointHunkInput,
  SessionId,
} from '@workspace/contracts'

import type { Client } from '@/lib/client'
import { observeClientOperation } from '@/lib/client-logging'
import { unwrapEdenResponse } from '@/lib/eden-events'
import { clientLogContext } from '@/lib/environments/state/log-context'
import { checkpointDiffQueryKey, fetchCheckpointDiff } from '@/lib/checkpoint-diff-query'

export const checkpointHunkKeys = {
  all: ['chat', 'checkpoint-hunks'] as const,
  states: (sessionId: SessionId, turnCount: number) =>
    [...checkpointHunkKeys.all, sessionId, turnCount] as const,
}

/**
 * The turn's changes as git prints them with whitespace counted, the diff the server builds
 * undo patches from, so the hunk ids on screen are the ids it accepts.
 */
export function turnHunksQueryOptions(client: Client, sessionId: SessionId, turnCount: number) {
  const input = {
    fromTurnCount: turnCount - 1,
    ignoreWhitespace: false,
    scope: 'turn' as const,
    sessionId,
    toTurnCount: turnCount,
  }
  return queryOptions({
    queryKey: checkpointDiffQueryKey(input),
    queryFn: ({ signal }) => fetchCheckpointDiff(input, signal, client),
    // Checkpoint refs never change after the turn settles.
    staleTime: Number.POSITIVE_INFINITY,
  })
}

export function checkpointHunkStatesQueryOptions(
  client: Client,
  sessionId: SessionId,
  turnCount: number,
) {
  return queryOptions({
    queryKey: checkpointHunkKeys.states(sessionId, turnCount),
    queryFn: ({ signal }) =>
      observeClientOperation(
        {
          ...clientLogContext(client),
          action: 'chat.checkpoint_hunks.http',
          area: 'chat',
          sessionId,
          turnCount,
        },
        async () =>
          unwrapEdenResponse<OrchestrationCheckpointHunk[]>(
            await client.orchestration['checkpoint-hunks'].get({
              fetch: { signal },
              query: { sessionId, turnCount },
            }),
          ),
        (hunks) => ({ hunkCount: hunks.length }),
      ),
    // The worktree moves under it: an agent turn, an edit, an undo.
    staleTime: 0,
  })
}

export function revertCheckpointHunk(
  client: Client,
  input: OrchestrationRevertCheckpointHunkInput,
) {
  return observeClientOperation(
    {
      ...clientLogContext(client),
      action: 'chat.checkpoint_hunk_revert.http',
      area: 'chat',
      reapply: input.reapply ?? false,
      sessionId: input.sessionId,
      turnCount: input.turnCount,
      whole: input.hunkId === null,
    },
    async () =>
      unwrapEdenResponse<GitStatusResult>(
        await client.orchestration['checkpoint-hunks'].revert.post(input),
      ),
  )
}

export type TurnHunkRow = {
  readonly id: string
  readonly file: GitFileDiff
  readonly hunk: GitFileDiff['hunks'][number]
  /** One-based position among every change of the turn, for "n of m". */
  readonly position: number
}

/** Every change of the turn in file order, numbered across files. */
export function turnHunkRows(files: readonly GitFileDiff[]): TurnHunkRow[] {
  let position = 0
  return files.flatMap((file) =>
    file.hunks.map((hunk) => {
      position += 1
      return { file, hunk, id: `hunk:${hunk.id}`, position }
    }),
  )
}

/** The hunk's first added or removed line, the part a reader recognises it by. */
export function hunkPreview(hunk: GitFileDiff['hunks'][number]) {
  const change = hunk.changes.find((line) => line.type !== 'context')
  if (!change) return ''
  return `${change.type === 'added' ? '+' : '−'} ${change.text.trim()}`
}

export function hunkStateLabel(state: OrchestrationCheckpointHunk['state'] | undefined) {
  if (state === 'reverted') return 'Undone'
  if (state === 'changed') return 'Edited since'
  return ''
}

export function wholeFileHunkAction(
  file: GitFileDiff | null,
  states: ReadonlyMap<string, OrchestrationCheckpointHunk['state']>,
  statesStatus: 'pending' | 'error' | 'success',
) {
  if (!file?.hunks.length) return { reapply: false, reason: 'No changes available' }
  if (statesStatus === 'pending') return { reapply: false, reason: 'Checking the file' }
  if (statesStatus === 'error') return { reapply: false, reason: 'Could not check the file' }
  const values = file.hunks.map((hunk) => states.get(hunk.id))
  if (values.every((state) => state === 'applied')) return { reapply: false, reason: null }
  if (values.every((state) => state === 'reverted')) return { reapply: true, reason: null }
  return {
    reapply: false,
    reason: 'Use the individual changes while this file has mixed or edited changes',
  }
}
