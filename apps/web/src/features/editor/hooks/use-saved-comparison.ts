import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useEffect, useEffectEvent, useId, useLayoutEffect, useRef } from 'react'
import { useStore } from 'zustand'
import { useHeldUntilReady } from '@/hooks/use-held-until-ready'
import { useEnvironmentId } from '@/lib/environments/hooks/use-environment-id'
import type { FilesystemPath, TabId } from '@/lib/documents/utils/types'
import type { FileSnapshot } from '@/lib/file-snapshot'
import { fileSnapshotQueryOptions } from '@/lib/file-snapshot-query-cache'
import {
  useEditorDocumentStoreApi,
  type EditorDocumentStoreApi,
} from '@/features/editor/state/document-state'
import { editorMutationKeys } from '@/features/editor/utils/mutation-keys'
import type {
  SavedComparisonLease,
  SavedComparisonScope,
  SavedComparisonRefresh,
} from '@/lib/saved-comparison'

type ComparisonBinding = {
  readonly documents: EditorDocumentStoreApi
  readonly lease: SavedComparisonLease
  readonly controller: AbortController
  readonly scope: SavedComparisonScope
  readonly path: FilesystemPath
}

type ComparisonAdoption =
  | {
      readonly kind: 'acquire'
      readonly documents: EditorDocumentStoreApi
      readonly scope: SavedComparisonScope
      readonly controller: AbortController
      readonly file: FileSnapshot
      readonly queries: QueryClient
      readonly tabId?: TabId
    }
  | {
      readonly kind: 'refresh'
      readonly binding: ComparisonBinding
      readonly file: FileSnapshot
      readonly queries: QueryClient
      readonly request: SavedComparisonRefresh
    }

export function useSavedComparison(
  rootPath: FilesystemPath,
  saved: FileSnapshot | null,
  tabId?: TabId,
) {
  const environmentId = useEnvironmentId()
  const store = useEditorDocumentStoreApi()
  const queries = useQueryClient()
  const id = useId()
  const active = useRef<ComparisonBinding | null>(null)
  const mutation = useMutation({
    mutationKey: editorMutationKeys.savedComparison(id),
    scope: { id },
    gcTime: 0,
    retry: false,
    mutationFn: async (request: ComparisonAdoption) => adoptComparison(request),
    onSuccess(binding) {
      if (binding.controller.signal.aborted || binding.lease.read().kind === 'released') return
      const previous = active.current
      active.current = binding
      if (previous?.controller !== binding.controller) previous?.controller.abort()
    },
    onError(_error, request) {
      if (request.kind === 'acquire') request.controller.abort()
    },
  })
  const adopt = useEffectEvent((controller: AbortController, file: FileSnapshot) => {
    const binding = active.current
    if (
      binding?.documents === store &&
      binding.path === file.path &&
      binding.scope.rootPath === rootPath
    ) {
      mutation.mutate({
        kind: 'refresh',
        binding,
        file,
        queries,
        request: binding.lease.requestSavedRefresh(),
      })
      return
    }
    mutation.mutate({
      kind: 'acquire',
      documents: store,
      scope: { environmentId, rootPath },
      controller,
      file,
      queries,
      tabId,
    })
  })
  useLayoutEffect(() => {
    if (!saved) return
    const controller = new AbortController()
    adopt(controller, saved)
    return () => {
      if (active.current?.controller !== controller) controller.abort()
    }
  }, [environmentId, rootPath, saved, store, tabId])
  useEffect(() => () => active.current?.controller.abort(), [])
  const binding = useHeldUntilReady(mutation.data ?? null, mutation.isSuccess)
  const read = useStore(tabId ? store : (binding?.documents ?? store), (state) => {
    const lease = tabId ? state.savedComparisonTabs.get(tabId) : binding?.lease
    return lease ? (state.savedComparisons.get(lease) ?? null) : null
  })
  return { read, error: mutation.error }
}

function adoptComparison(request: ComparisonAdoption): ComparisonBinding {
  const current =
    request.queries.getQueryData<FileSnapshot>(
      fileSnapshotQueryOptions(request.file.path).queryKey,
    ) === request.file
  if (request.kind === 'refresh') {
    if (current && !request.binding.controller.signal.aborted)
      request.binding.lease.refreshSaved(request.file, request.request)
    return request.binding
  }
  const { documents, scope, controller, file } = request
  if (!current) controller.abort()
  const source = { scope, saved: file, signal: controller.signal }
  const lease =
    request.tabId && !controller.signal.aborted
      ? documents.getState().prepareSavedComparisonTab(request.tabId, {
          ...source,
          signal: new AbortController().signal,
        })
      : documents.getState().acquireSavedComparison(source)
  return { documents, scope, controller, lease, path: file.path }
}
