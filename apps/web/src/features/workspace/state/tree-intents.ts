import type { QueryClient } from '@tanstack/react-query'
import { createIntentQueue, type Intent } from '@workspace/client-core/optimistic/queue'
import { projectIntents } from '@workspace/client-core/optimistic/projection'
import {
  runIntent,
  type AcknowledgementSource,
  type IntentOutcome,
  type IntentRunEvent,
} from '@workspace/client-core/optimistic/run'

import type { FilesystemPath } from '@/lib/documents/utils/types'
import { reportError, toClientError } from '@/lib/client-error-taxonomy'
import { log } from '@/lib/client-logging'
import { watchIntentHolds } from '@/lib/optimistic/hold-diagnostics'
import { fileSystemKeys } from '@/lib/query-keys'
import type { TreeModel } from '@/lib/tree-model'
import { runMutation } from '@/lib/mutations/run'
import { invalidateTreeQueries } from '@/features/workspace/utils/invalidate-queries'
import { workspaceMutationKeys } from '@/features/workspace/utils/mutation-keys'
import {
  applyTreePatch,
  treePatchConfirmed,
  treePatchPaths,
  treePatchResources,
  type TreePatch,
} from '@/features/workspace/utils/tree-patch'

const TREE_ACKNOWLEDGEMENT_TIMEOUT_MS = 10_000

/** Every file-tree change the server has not confirmed yet, across all roots. */
export const treeIntents = watchIntentHolds(createIntentQueue<TreePatch>(), {
  area: 'file-tree',
  describe: (patch) => patch.kind,
})

let cachedConfirmed: TreeModel | null = null
let cachedActive: readonly Intent<TreePatch>[] = treeIntents.getState().active
let cachedRootPath = ''
let cachedProjection: TreeModel | null = null

/** The confirmed model with this root's pending patches replayed. Identity-stable while nothing changed. */
export function projectedTreeModel(confirmed: TreeModel, rootPath: FilesystemPath): TreeModel {
  const { active } = treeIntents.getState()
  const cacheHit =
    cachedConfirmed === confirmed && cachedActive === active && cachedRootPath === rootPath
  if (cacheHit && cachedProjection) return cachedProjection

  cachedConfirmed = confirmed
  cachedActive = active
  cachedRootPath = rootPath
  cachedProjection = projectIntents(
    confirmed,
    active.filter((intent) => intent.patch.rootPath === rootPath),
    applyTreePatch,
  )
  return cachedProjection
}

export function hasPendingTreeMove(rootPath: FilesystemPath) {
  return treeIntents
    .getState()
    .active.some((intent) => intent.patch.kind === 'move' && intent.patch.rootPath === rootPath)
}

export function resetTreeIntents() {
  treeIntents.reset()
}

/**
 * The whole optimistic lifecycle for one tree change. The transport runs, the
 * tree queries are invalidated, and the patch stays projected until the
 * refetched model shows it or ten seconds pass. A refused transport reports
 * the error; a timeout only logs, because the tree is then simply showing
 * what the server knows.
 */
export async function runTreeIntent<TResult>({
  patch,
  perform,
  queryClient,
  context,
}: {
  readonly patch: TreePatch
  readonly perform: () => Promise<TResult>
  readonly queryClient: QueryClient
  /** Extra fields for the wide event, resolved after the transport so late values land. */
  readonly context?: () => Record<string, unknown>
}): Promise<IntentOutcome<TResult>> {
  const outcome = await runMutation(
    queryClient,
    {
      mutationFn: () =>
        runIntent(treeIntents, patch, {
          resources: treePatchResources(patch),
          perform: async () => {
            try {
              return await perform()
            } finally {
              invalidateTreeQueries(queryClient)
            }
          },
          until: confirmedTreeAcknowledgement(queryClient, patch),
          record: (event) => recordTreeIntent(patch, event, context?.()),
        }),
      mutationKey: workspaceMutationKeys.tree(patch.kind, patch.rootPath),
    },
    undefined,
  )
  settleTreeOutcome(outcome)
  return outcome
}

function confirmedTreeAcknowledgement(
  queryClient: QueryClient,
  patch: TreePatch,
): AcknowledgementSource {
  const key = fileSystemKeys.tree(patch.rootPath)
  return {
    subscribe: (listener) => queryClient.getQueryCache().subscribe(listener),
    satisfied: () => {
      const confirmed = queryClient.getQueryData<TreeModel>(key)
      return confirmed ? treePatchConfirmed(confirmed, patch) : false
    },
    timeoutMs: TREE_ACKNOWLEDGEMENT_TIMEOUT_MS,
  }
}

function settleTreeOutcome(outcome: IntentOutcome<unknown>) {
  if (outcome.ok) return
  // The projection already dropped the patch; the failed entry has served its purpose.
  treeIntents.discardFailed(outcome.intentId)
  if (outcome.reason !== 'transport') return

  reportError(toClientError(outcome.error))
}

function recordTreeIntent(
  patch: TreePatch,
  event: IntentRunEvent,
  context: Record<string, unknown> = {},
) {
  const { error, ...rest } = event
  const level = event.outcome === 'acknowledged' ? 'info' : 'warn'
  log[level]({
    action: 'file-tree.mutation.intent',
    area: 'file-tree',
    kind: patch.kind,
    rootPath: patch.rootPath,
    treePaths: treePatchPaths(patch),
    ...context,
    ...rest,
    ...(error === undefined ? {} : { error: { message: String(error) } }),
  })
}
