import { mutationOptions, type QueryClient } from '@tanstack/react-query'
import type { EditorDocumentAnalysis } from '@singapore-editor/core/editor'

import { reconcileInactiveAnalysis } from '@/features/editor/state/inactive-analysis-policy'
import { editorMutationKeys } from '@/features/editor/utils/mutation-keys'
import { log } from '@/lib/client-logging'
import { runMutation } from '@/lib/mutations/run'

export function createInactiveAnalysisRetention({
  enumerate,
  queryClient,
  readLimit,
  subscribe,
  subscribeLimit,
}: {
  readonly enumerate: () => Iterable<EditorDocumentAnalysis>
  readonly queryClient: QueryClient
  readonly readLimit: () => number
  readonly subscribe: (listener: () => void) => () => void
  readonly subscribeLimit: (listener: () => void) => () => void
}) {
  const subscriptions = new Map<EditorDocumentAnalysis, () => void>()
  let queued = false
  let disposed = false
  const options = mutationOptions({
    mutationKey: editorMutationKeys.analysisRetention(),
    scope: { id: 'editor.analysis.retention' },
    mutationFn: async () => {
      if (disposed) return null
      return reconcileInactiveAnalysis({ enumerate, classify: () => 'warm', limit: readLimit() })
    },
  })

  function schedule() {
    if (disposed || queued) return
    queued = true
    queueMicrotask(() => {
      queued = false
      if (disposed) return
      void runMutation(queryClient, options, undefined).catch((error: unknown) => {
        log.warn({ action: 'editor.analysis.retention_abandoned', area: 'editor', error })
      })
    })
  }

  function reconcileMembership() {
    if (disposed) return
    const current = new Set(enumerate())
    for (const [analysis, stop] of subscriptions) {
      if (current.has(analysis)) continue
      subscriptions.delete(analysis)
      stop()
    }
    for (const analysis of current) {
      if (subscriptions.has(analysis)) continue
      subscriptions.set(analysis, analysis.subscribeRetention(schedule))
    }
    schedule()
  }

  const stopMembership = subscribe(reconcileMembership)
  const stopLimit = subscribeLimit(schedule)
  reconcileMembership()
  return {
    dispose() {
      if (disposed) return
      disposed = true
      stopMembership()
      stopLimit()
      for (const stop of subscriptions.values()) stop()
      subscriptions.clear()
    },
  }
}
