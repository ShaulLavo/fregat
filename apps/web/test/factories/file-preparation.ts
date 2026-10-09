import { QueryClient } from '@tanstack/react-query'
import { vi } from 'vitest'
import { createEditorPreparedDocument } from '@singapore-editor/core/editor'
import { WorkspaceDocumentService } from '@/features/editor/state/workspace-document-service'
import {
  createPlatformFileOpenPreparer,
  type EditorPreparedEnvironment,
} from '@/features/editor/utils/prepared-document'
import { fileDocumentKey } from '@/lib/documents/utils/identity'
import type { FilesystemPath } from '@/lib/documents/utils/types'
import type { FileResult } from '@/lib/file-system-types'
import {
  createFileOpenIntentServiceOwner,
  type FileOpenIntentPreparer,
  type FileOpenIntentRuntime,
  type FileOpenIntentServiceOwnerDependencies,
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
  mountedEditors = { has: () => false, subscribe: () => () => undefined },
}: {
  readonly queryClient?: QueryClient
  readonly runtime?: FileOpenIntentRuntime
  readonly preparer?: FileOpenIntentPreparer
  readonly mountedEditors?: FileOpenIntentServiceOwnerDependencies['mountedEditors']
} = {}) {
  const documents = preparationDocuments()
  const owner = createFileOpenIntentServiceOwner({
    acquireFilePreparation: (input) => documents.acquireFilePreparation(input),
    getLiveDocument: (path) => documents.getLiveDocument(fileDocumentKey(path)),
    getRetainedScrollPosition: () => null,
    isActive: () => false,
    mountedEditors,
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

/**
 * A real prepared document with one highlighter stage whose work stays pending until `settle`,
 * so a test can order service events against the stage's scheduled start.
 */
export function gatedStagePreparer() {
  let settle!: () => void
  const pending = new Promise<void>((resolve) => {
    settle = resolve
  })
  const start = vi.fn(() => pending)
  const configuration = {
    documentConfigurationTag: [],
    stages: [{ configurationTag: [], family: 'highlighter' as const, provider: start, start }],
  }
  const observed: {
    preparedDocument: ReturnType<typeof createEditorPreparedDocument> | null
    signal: AbortSignal | null
  } = { preparedDocument: null, signal: null }
  const preparer: FileOpenIntentPreparer = {
    environment: { configurationTag: [], highlighterProvider: null, structuralProvider: null },
    prepare: (buffer, documentId, _path, abortSignal, _range, analysis) => {
      const preparedDocument = createEditorPreparedDocument({
        analysis,
        buffer,
        configuredTabSize: 4,
        documentConfigurationTag: [],
        documentId,
        folding: false,
        languageId: 'typescript',
        tabSizePolicy: 'fixed',
      })
      vi.spyOn(preparedDocument, 'dispose')
      observed.preparedDocument = preparedDocument
      observed.signal = abortSignal
      return { buffer, preparedDocument, ...configuration }
    },
    reconfigure: () => configuration,
  }
  return {
    preparer,
    settle,
    start,
    preparedDocument: () => observed.preparedDocument!,
    signal: () => observed.signal!,
  }
}

export function preparationFile(path: FilesystemPath, content = 'const a = 1\n'): FileResult {
  return { content, mtimeMs: 1, path, size: content.length, version: 'v1' }
}
