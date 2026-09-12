import { fileDocumentKey, filesystemPath } from '@/lib/documents/utils/identity'
import { useCallback, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { useWorkspaceEditService } from '@/features/editor/providers/workspace-edit-context'
import { useEditorDocumentStoreApi } from '@/features/editor/state/document-state'
import type {
  SearchBufferSnapshot,
  WorkspaceSearchFileGroup,
} from '@/features/search/state/buffer-state'
import { useSearchBufferState, useSearchBufferStoreApi } from '@/features/search/state/buffer-state'
import {
  replaceWorkspaceSearchMatches,
  workspaceSearchReplaceSummary,
} from '@/features/search/utils/replace-runner'
import { errorMessage } from '@/lib/error-message'
import type { Client } from '@/lib/client'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import { fetchFile } from '@/lib/file-server'
import type { WorkspaceSearchMatch, WorkspaceSearchQuery } from '@workspace/contracts'

export function useWorkspaceSearchReplace(rootPath: string, enabled = true) {
  const client = clientForQueryClient(useQueryClient())
  const canReplaceValue = useSearchBufferState((state) => {
    if (!enabled) return false
    if (state.active?.rootPath !== rootPath) return false

    return canReplace(state.active)
  })
  const store = useSearchBufferStoreApi()
  const documentStore = useEditorDocumentStoreApi()
  const workspaceEdits = useWorkspaceEditService()
  const controllerRef = useRef<AbortController | null>(null)

  const replaceMatches = useCallback(
    (matches: readonly WorkspaceSearchMatch[]) => {
      const controller = new AbortController()
      controllerRef.current?.abort()
      controllerRef.current = controller

      void runReplace({
        client,
        controller,
        documentStore,
        matches,
        rootPath,
        store,
        workspaceEdits,
      }).finally(() => {
        if (controllerRef.current === controller) controllerRef.current = null
      })
    },
    [client, documentStore, rootPath, store, workspaceEdits],
  )
  const replaceAll = useCallback(() => {
    const snapshot = store.getState().active
    if (snapshot?.rootPath !== rootPath) return

    replaceMatches(snapshot.matches)
  }, [replaceMatches, rootPath, store])
  const replaceGroup = useCallback(
    (group: WorkspaceSearchFileGroup) => replaceMatches(group.matches),
    [replaceMatches],
  )
  const replaceMatch = useCallback(
    (match: WorkspaceSearchMatch) => replaceMatches([match]),
    [replaceMatches],
  )
  const replaceNext = useCallback(() => {
    const snapshot = store.getState().active
    if (snapshot?.rootPath !== rootPath) return

    const match = firstContentMatch(snapshot.matches)
    if (match) replaceMatches([match])
  }, [replaceMatches, rootPath, store])

  return {
    canReplace: canReplaceValue,
    replaceAll,
    replaceGroup,
    replaceMatch,
    replaceNext,
  }
}

type RunReplaceInput = {
  client: Client
  controller: AbortController
  documentStore: ReturnType<typeof useEditorDocumentStoreApi>
  matches: readonly WorkspaceSearchMatch[]
  rootPath: string
  store: ReturnType<typeof useSearchBufferStoreApi>
  workspaceEdits: ReturnType<typeof useWorkspaceEditService>
}

async function runReplace({
  client,
  controller,
  documentStore,
  matches,
  rootPath,
  store,
  workspaceEdits,
}: RunReplaceInput) {
  const snapshot = store.getState().active
  if (!canReplace(snapshot)) return
  if (snapshot.rootPath !== rootPath) return

  const contentMatches = matches.filter((match) => match.kind === 'content')
  if (contentMatches.length === 0) return

  store.getState().startReplace(rootPath)

  try {
    const result = await replaceWorkspaceSearchMatches({
      context: {
        applyWorkspaceChange: workspaceEdits.applyWorkspaceChange,
        fetchFile: (path, signal) => fetchFile(filesystemPath(path), signal, client),
        getLiveEditorDocument: (path) => {
          const document = documentStore
            .getState()
            .getLiveEditorDocument(fileDocumentKey(filesystemPath(path)))
          if (document?.target.kind !== 'file') return null
          return { buffer: document.buffer, path: document.target.resource.path }
        },
        rootPath,
        signal: controller.signal,
      },
      matches: contentMatches,
      query: snapshot.resultsSearchQuery,
      replaceText: snapshot.replaceText,
    })
    if (controller.signal.aborted) return

    if (result.status === 'applied') {
      store.getState().finishReplace(rootPath, workspaceSearchReplaceSummary(result))
      store.getState().requestSearchRefresh(rootPath)
      return
    }
    if (result.status === 'cancelled') {
      store.getState().finishReplace(rootPath, 'Replace cancelled.')
      return
    }
    store.getState().failReplace(rootPath, result.message)
  } catch (error) {
    if (controller.signal.aborted) return

    store.getState().failReplace(rootPath, errorMessage(error, 'Replace failed.'))
  }
}

type ReplaceableSearchBufferSnapshot = SearchBufferSnapshot & {
  resultsSearchQuery: WorkspaceSearchQuery
}

function canReplace(
  snapshot: SearchBufferSnapshot | null,
): snapshot is ReplaceableSearchBufferSnapshot {
  if (!snapshot) return false
  if (!snapshot.resultsSearchQuery) return false
  if (snapshot.replaceStatus === 'running') return false
  // An allowlist: a run that fails mid-stream keeps its partial matches, so a
  // denylist blocking only `'loading'` let replace run over an incomplete set.
  if (snapshot.status !== 'ready') return false

  return firstContentMatch(snapshot.matches) !== null
}

function firstContentMatch(matches: readonly WorkspaceSearchMatch[]) {
  return matches.find((match) => match.kind === 'content') ?? null
}
