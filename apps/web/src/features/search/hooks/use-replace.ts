import { useRef } from 'react'

import { useWorkspaceTextChanges } from '@/lib/workspace-edits/hooks/use-text-changes'
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
import type { WorkspaceSearchMatch, WorkspaceSearchQuery } from '@workspace/contracts'

export function useWorkspaceSearchReplace(rootPath: string, enabled = true) {
  const canReplaceValue = useSearchBufferState((state) => {
    if (!enabled) return false
    if (state.active?.rootPath !== rootPath) return false

    return canReplace(state.active)
  })
  const store = useSearchBufferStoreApi()
  const workspaceEdits = useWorkspaceTextChanges()
  const controllerRef = useRef<AbortController | null>(null)

  const replaceMatches = (matches: readonly WorkspaceSearchMatch[]) => {
    const controller = new AbortController()
    controllerRef.current?.abort()
    controllerRef.current = controller

    void runReplace({
      controller,
      matches,
      rootPath,
      store,
      workspaceEdits,
    }).finally(() => {
      if (controllerRef.current === controller) controllerRef.current = null
    })
  }
  const replaceAll = () => {
    const snapshot = store.getState().active
    if (snapshot?.rootPath !== rootPath) return

    replaceMatches(snapshot.matches)
  }
  const replaceGroup = (group: WorkspaceSearchFileGroup) => replaceMatches(group.matches)
  const replaceMatch = (match: WorkspaceSearchMatch) => replaceMatches([match])
  const replaceNext = () => {
    const snapshot = store.getState().active
    if (snapshot?.rootPath !== rootPath) return

    const match = firstContentMatch(snapshot.matches)
    if (match) replaceMatches([match])
  }

  return {
    canReplace: canReplaceValue,
    replaceAll,
    replaceGroup,
    replaceMatch,
    replaceNext,
  }
}

type RunReplaceInput = {
  controller: AbortController
  matches: readonly WorkspaceSearchMatch[]
  rootPath: string
  store: ReturnType<typeof useSearchBufferStoreApi>
  workspaceEdits: ReturnType<typeof useWorkspaceTextChanges>
}

async function runReplace({
  controller,
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

  const token = store.getState().startReplace(rootPath)
  if (!token) return

  try {
    const result = await replaceWorkspaceSearchMatches({
      workspaceEdits,
      signal: controller.signal,
      matches: contentMatches,
      query: snapshot.resultsSearchQuery,
      replaceText: snapshot.replaceText,
    })

    if (result.status === 'applied') {
      store.getState().finishReplace(token, workspaceSearchReplaceSummary(result), true)
      return
    }
    if (result.status === 'cancelled') {
      store.getState().finishReplace(token, 'Replace cancelled.')
      return
    }
    store.getState().failReplace(token, result.message)
  } catch (error) {
    if (controller.signal.aborted) {
      store.getState().finishReplace(token, 'Replace cancelled.')
      return
    }
    store.getState().failReplace(token, errorMessage(error, 'Replace failed.'))
  }
}

type ReplaceableSearchBufferSnapshot = SearchBufferSnapshot & {
  resultsSearchQuery: WorkspaceSearchQuery
}

function canReplace(
  snapshot: SearchBufferSnapshot | null,
): snapshot is ReplaceableSearchBufferSnapshot {
  if (!snapshot || snapshot.runId === 0) return false
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
