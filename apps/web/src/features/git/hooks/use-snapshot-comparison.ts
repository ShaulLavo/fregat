import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useEffectEvent, useId, useLayoutEffect } from 'react'
import { useStore } from 'zustand'
import type { GitFileDiff } from '@workspace/contracts'
import { useEditorRuntime } from '@/features/editor/hooks/use-runtime'
import {
  snapshotComparisonQueryOptions,
  snapshotComparisonIsAdmitted,
} from '@/lib/snapshot-comparison-query'
import { documentKey } from '@/lib/documents/utils/identity'
import { snapshotComparisonInput, checkpointComparisonInput } from '@/lib/snapshot-comparison-input'
import type { SnapshotComparisonScope } from '@/lib/documents/utils/snapshot-comparison'
import type { SnapshotComparisonLease } from '@/lib/snapshot-comparison'
import type { FilesystemPath, GitComparison, TabId } from '@/lib/documents/utils/types'
import { errorMessage } from '@/lib/error-message'
import { mutationKeys } from '@/features/git/utils/mutation-keys'

type SnapshotAdoption = {
  readonly comparison: GitComparison
  readonly diffs: readonly GitFileDiff[]
  readonly controller: AbortController
  readonly documents: ReturnType<typeof useEditorRuntime>['documentStore']
  readonly queries: QueryClient
  readonly scope: SnapshotComparisonScope
}

export function useSnapshotComparison(
  comparison: GitComparison | null,
  rootPath: FilesystemPath,
  diffs: readonly GitFileDiff[],
  pending: boolean,
  tabId?: TabId,
) {
  const runtime = useEditorRuntime()
  const queries = useQueryClient()
  const id = useId()
  const mutation = useMutation({
    mutationKey: mutationKeys.comparison(rootPath, id),
    scope: { id },
    gcTime: 0,
    retry: false,
    mutationFn: async (request: SnapshotAdoption) => adoptSnapshotComparison(request),
  })
  const adopt = useEffectEvent((subject: GitComparison, controller: AbortController) =>
    mutation.mutate({
      comparison: subject,
      diffs,
      controller,
      queries,
      documents: runtime.documentStore,
      scope: { environmentId: runtime.storage.environmentId, rootPath },
    }),
  )
  useLayoutEffect(() => {
    if (tabId || !comparison || pending) return
    const controller = new AbortController()
    adopt(comparison, controller)
    return () => controller.abort()
  }, [comparison, diffs, pending, rootPath, runtime, tabId])
  const subject = comparison ? documentKey({ kind: 'git-diff', source: comparison }) : null
  const read = useStore(runtime.documentStore, (state) => {
    const lease = tabId ? state.snapshotComparisonTabs.get(tabId) : mutation.data
    const read = lease ? state.snapshotComparisons.get(lease) : null
    return read?.kind === 'ready' &&
      (read.input.kind === 'snapshot' || read.input.kind === 'checkpoint') &&
      read.input.subject === subject &&
      read.input.scope.rootPath === rootPath
      ? read
      : null
  })
  return {
    read,
    failure: mutation.error ? errorMessage(mutation.error, 'Diff unavailable.') : null,
  }
}

function adoptSnapshotComparison(request: SnapshotAdoption): SnapshotComparisonLease | null {
  if (!snapshotComparisonIsAdmitted(request.queries, request.scope.rootPath, request.comparison))
    return null
  const current = request.queries.getQueryData<readonly GitFileDiff[]>(
    snapshotComparisonQueryOptions(request.comparison).queryKey,
  )
  if (
    request.controller.signal.aborted ||
    !current ||
    (request.comparison.kind === 'snapshot' && current !== request.diffs)
  )
    return null
  return request.documents.getState().acquireSnapshotComparison({
    input:
      request.comparison.kind === 'snapshot'
        ? snapshotComparisonInput({
            scope: request.scope,
            comparison: request.comparison,
            diffs: request.diffs,
          })
        : checkpointComparisonInput({
            scope: request.scope,
            comparison: request.comparison,
            diffs: current,
            hydrated: request.diffs,
          }),
    signal: request.controller.signal,
  })
}
