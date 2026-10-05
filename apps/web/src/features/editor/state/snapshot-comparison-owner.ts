import type { GitFileDiff } from '@workspace/contracts'
import type { QueryClient } from '@tanstack/react-query'
import type { EditorDocumentStoreApi } from '@/features/editor/state/document-state'
import {
  snapshotComparisonQueryOptions,
  snapshotComparisonIsAdmitted,
} from '@/lib/snapshot-comparison-query'
import { sameSnapshotTarget } from '@/lib/documents/utils/comparisons'
import { documentKey } from '@/lib/documents/utils/identity'
import { snapshotComparisonInput, checkpointComparisonInput } from '@/lib/snapshot-comparison-input'
import {
  checkpointBlobRequest,
  displayedCheckpointEntry,
  withCheckpointSources,
} from '@/lib/checkpoint-sources'
import { blobDiffQueryKey } from '@/lib/blob-diff-query'
import type { SnapshotComparisonLease } from '@/lib/snapshot-comparison'
import type { SnapshotComparisonScope } from '@/lib/documents/utils/snapshot-comparison'
import type { GitComparison, TabId } from '@/lib/documents/utils/types'

type Binding = {
  readonly comparison: GitComparison
  readonly scope: SnapshotComparisonScope
  readonly controller: AbortController
  data: readonly GitFileDiff[] | undefined
  blob: readonly GitFileDiff[] | undefined
  lease: SnapshotComparisonLease | null
}

export function createSnapshotComparisonOwner(
  documents: EditorDocumentStoreApi,
  queries: QueryClient,
) {
  const bindings = new Map<TabId, Binding>()
  let disposed = false
  function suspend(binding: Binding) {
    binding.data = undefined
    binding.blob = undefined
    binding.lease = null
    binding.controller.abort()
  }
  function settle(tabId: TabId, binding: Binding) {
    if (disposed || binding.controller.signal.aborted || bindings.get(tabId) !== binding) return
    if (!snapshotComparisonIsAdmitted(queries, binding.scope.rootPath, binding.comparison)) return
    const data = queries.getQueryData<readonly GitFileDiff[]>(
      snapshotComparisonQueryOptions(binding.comparison).queryKey,
    )
    if (!data) return
    const previous = documents.getState().snapshotComparisonTabs.get(tabId)?.read()
    const displayed = binding.comparison.kind === 'snapshot' ? null : displayedCheckpointEntry(data)
    const blobRequest = checkpointBlobRequest(displayed)
    const blob = blobRequest
      ? queries.getQueryData<readonly GitFileDiff[]>(blobDiffQueryKey(blobRequest))
      : undefined
    if (binding.data === data && binding.blob === blob && previous?.kind === 'ready') return
    const hydrated =
      displayed && blobRequest
        ? withCheckpointSources(data, displayed, { data: blob, isPending: false })
        : data
    const shared = [...bindings].find(
      ([, other]) =>
        other.data === data &&
        other.blob === blob &&
        sameSubject(other, binding.scope, binding.comparison),
    )
    const sharedRead = shared
      ? documents.getState().snapshotComparisonTabs.get(shared[0])?.read()
      : null
    const input =
      (sharedRead?.kind === 'ready' ? sharedRead.input : null) ??
      (binding.comparison.kind === 'snapshot'
        ? snapshotComparisonInput({
            scope: binding.scope,
            comparison: binding.comparison,
            diffs: data,
          })
        : checkpointComparisonInput({
            scope: binding.scope,
            comparison: binding.comparison,
            diffs: data,
            hydrated,
          }))
    binding.data = data
    binding.blob = blob
    const lease = documents
      .getState()
      .prepareSnapshotComparisonTab(tabId, { input, signal: binding.controller.signal })
    if (binding.controller.signal.aborted || lease.read().kind === 'released') {
      lease.release()
      suspend(binding)
      return
    }
    binding.lease = lease
  }
  const stopDocuments = documents.subscribe(
    (state) => state.snapshotComparisonTabs,
    () => {
      for (const binding of bindings.values()) {
        if (binding.lease?.read().kind === 'released') suspend(binding)
      }
    },
  )
  const stopQueries = queries.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated' || event.action.type !== 'success') return
    for (const [tabId, binding] of bindings) settle(tabId, binding)
  })
  return {
    prepare(
      tabId: TabId,
      scope: SnapshotComparisonScope,
      comparison: GitComparison,
      { activate = true }: { readonly activate?: boolean } = {},
    ) {
      if (disposed) return
      const previous = bindings.get(tabId)
      if (
        previous &&
        sameSubject(previous, scope, comparison) &&
        (previous.comparison.kind !== 'snapshot' ||
          comparison.kind !== 'snapshot' ||
          sameSnapshotTarget(previous.comparison.target, comparison.target)) &&
        (!activate || !previous.controller.signal.aborted)
      ) {
        settle(tabId, previous)
        return
      }
      previous?.controller.abort()
      const binding: Binding = {
        scope,
        comparison,
        controller: new AbortController(),
        data: undefined,
        blob: undefined,
        lease: null,
      }
      bindings.set(tabId, binding)
      settle(tabId, binding)
    },
    retain(tabIds: ReadonlySet<TabId>) {
      for (const [tabId, binding] of bindings) {
        if (tabIds.has(tabId)) continue
        bindings.delete(tabId)
        binding.controller.abort()
        documents.getState().snapshotComparisonTabs.get(tabId)?.release()
      }
    },
    dispose() {
      disposed = true
      stopQueries()
      stopDocuments()
      for (const [tabId, binding] of bindings) {
        binding.controller.abort()
        documents.getState().snapshotComparisonTabs.get(tabId)?.release()
      }
      bindings.clear()
    },
  }
}

function sameSubject(binding: Binding, scope: SnapshotComparisonScope, comparison: GitComparison) {
  return (
    binding.scope.environmentId === scope.environmentId &&
    binding.scope.rootPath === scope.rootPath &&
    documentKey({ kind: 'git-diff', source: binding.comparison }) ===
      documentKey({ kind: 'git-diff', source: comparison })
  )
}
