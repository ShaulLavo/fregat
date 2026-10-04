import type { GitFileDiff } from '@workspace/contracts'
import type { QueryClient } from '@tanstack/react-query'
import type { EditorDocumentStoreApi } from '@/features/editor/state/document-state'
import { blobDiffQueryOptions } from '@/lib/blob-diff-query'
import { documentKey } from '@/lib/documents/utils/identity'
import { snapshotComparisonInput } from '@/lib/snapshot-comparison-input'
import type {
  SnapshotComparison,
  SnapshotComparisonScope,
} from '@/lib/documents/utils/snapshot-comparison'
import type { TabId } from '@/lib/documents/utils/types'

type Binding = {
  readonly comparison: SnapshotComparison
  readonly scope: SnapshotComparisonScope
  readonly controller: AbortController
  data: readonly GitFileDiff[] | undefined
}

export function createSnapshotComparisonOwner(
  documents: EditorDocumentStoreApi,
  queries: QueryClient,
) {
  const bindings = new Map<TabId, Binding>()
  let disposed = false
  function settle(tabId: TabId, binding: Binding) {
    if (disposed || binding.controller.signal.aborted || bindings.get(tabId) !== binding) return
    const data = queries.getQueryData(blobDiffQueryOptions(binding.comparison).queryKey)
    if (!data) return
    const previous = documents.getState().snapshotComparisonTabs.get(tabId)?.read()
    if (binding.data === data && previous?.kind === 'ready') return
    const shared = [...bindings].find(
      ([, other]) =>
        other.data === data &&
        other.scope.rootPath === binding.scope.rootPath &&
        documentKey({ kind: 'git-diff', source: other.comparison }) ===
          documentKey({ kind: 'git-diff', source: binding.comparison }),
    )
    const sharedRead = shared
      ? documents.getState().snapshotComparisonTabs.get(shared[0])?.read()
      : null
    const input =
      (sharedRead?.kind === 'ready' ? sharedRead.input : null) ??
      snapshotComparisonInput({ scope: binding.scope, comparison: binding.comparison, diffs: data })
    binding.data = data
    documents
      .getState()
      .prepareSnapshotComparisonTab(tabId, { input, signal: binding.controller.signal })
  }
  const stopQueries = queries.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated' || event.action.type !== 'success') return
    for (const [tabId, binding] of bindings) settle(tabId, binding)
  })
  return {
    prepare(tabId: TabId, scope: SnapshotComparisonScope, comparison: SnapshotComparison) {
      if (disposed) return
      const previous = bindings.get(tabId)
      const subject = documentKey({ kind: 'git-diff', source: comparison })
      if (
        previous &&
        previous.scope.rootPath === scope.rootPath &&
        documentKey({ kind: 'git-diff', source: previous.comparison }) === subject
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
      for (const [tabId, binding] of bindings) {
        binding.controller.abort()
        documents.getState().snapshotComparisonTabs.get(tabId)?.release()
      }
      bindings.clear()
    },
  }
}
