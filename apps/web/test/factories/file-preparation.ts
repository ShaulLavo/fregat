import { QueryClient } from '@tanstack/react-query'
import { WorkspaceDocumentService } from '@/features/editor/state/workspace-document-service'
import {
  createPlatformFileOpenPreparer,
  type EditorPreparedEnvironment,
} from '@/features/editor/utils/prepared-document'
import { fileDocumentKey } from '@/lib/documents/utils/identity'
import {
  createFileOpenIntentServiceOwner,
  type FileOpenIntentPreparer,
  type FileOpenIntentRuntime,
} from '@/lib/file-open-intent/state/service'

export function preparationDocuments() {
  return new WorkspaceDocumentService()
}

export const preparationEnvironment: EditorPreparedEnvironment = {
  appliedThemeContentHash: null,
  appliedThemeId: null,
  selectedThemeId: 'dark-plus',
  syntaxHighlightingEnabled: false,
  analysisLimitMiCodeUnits: 10,
  tabSize: 4,
}

export function filePreparationOwner({
  queryClient = new QueryClient(),
  runtime,
  preparer = createPlatformFileOpenPreparer(preparationEnvironment),
}: {
  readonly queryClient?: QueryClient
  readonly runtime?: FileOpenIntentRuntime
  readonly preparer?: FileOpenIntentPreparer
} = {}) {
  const documents = preparationDocuments()
  const owner = createFileOpenIntentServiceOwner({
    acquireFilePreparation: (input) => documents.acquireFilePreparation(input),
    getLiveDocument: (path) => documents.getLiveDocument(fileDocumentKey(path)),
    getRetainedScrollPosition: () => null,
    isActive: () => false,
    mountedEditors: { has: () => false, subscribe: () => () => undefined },
    preparer,
    prefetchRelated: () => undefined,
    queryClient,
    runtime,
    subscribeLiveDocuments: (listener) => documents.subscribeEditorAnalyses(listener),
  })
  return {
    documents,
    owner,
    queryClient,
    dispose: () => {
      owner.disposeNow()
      documents.dispose()
      queryClient.clear()
    },
  }
}

export function preparationRuntime() {
  let now = 0
  const tasks: (() => Promise<unknown>)[] = []
  const operations = new Set<Promise<unknown>>()
  const timers = new Map<object, { at: number; task: () => void }>()
  const runtime: FileOpenIntentRuntime = {
    now: () => now,
    schedule: (task) =>
      new Promise((resolve, reject) => {
        tasks.push(() => Promise.resolve().then(task).then(resolve, reject))
      }),
    scheduleTimer: (task, delay) => {
      const token = {}
      timers.set(token, { at: now + delay, task })
      return () => {
        timers.delete(token)
      }
    },
  }
  return {
    runtime,
    startNext: () => {
      const task = tasks.shift()
      if (!task) return
      const operation = task().finally(() => operations.delete(operation))
      operations.add(operation)
    },
    settled: async () => {
      await Promise.all(operations)
      await Promise.resolve()
    },
    advance: (ms: number) => {
      now += ms
      const due = Array.from(timers).filter(([, timer]) => timer.at <= now)
      for (const [token, timer] of due) {
        if (!timers.delete(token)) continue
        timer.task()
      }
    },
    queued: () => tasks.length,
    timerCount: () => timers.size,
  }
}
