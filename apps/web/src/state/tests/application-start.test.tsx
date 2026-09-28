import { afterEach, vi } from 'vitest'

import { installEditorPerformanceTraceFromUrl } from '@/features/editor/state/performance-trace'
import { readWorkspaceCache } from '@/features/workspace/state/cache'
import { createApplicationRuntime } from '@/state/application-runtime'
import { expect, test } from '../../../test/fixtures'
import { testScopedStorage } from '../../../test/factories/scoped-storage'

type TraceGlobal = typeof globalThis & {
  __editorPerfTrace?: {
    beginEditorOpenSample(request: { readonly path: string; readonly rootPath: string }): unknown
    stop(): void
  }
}

const originalUrl = window.location.href

afterEach(() => {
  ;(globalThis as TraceGlobal).__editorPerfTrace?.stop()
  delete (globalThis as TraceGlobal).__editorPerfTrace
  history.replaceState(null, '', originalUrl)
  vi.unstubAllEnvs()
})

test('the editor-open benchmark control is reachable once the application starts, with no tree', () => {
  vi.stubEnv('OBSERVABILITY_ENABLED', 'true')
  history.replaceState(null, '', '/?editorPerfTrace=1')
  installEditorPerformanceTraceFromUrl()
  const application = createApplicationRuntime({
    workspaceCache: readWorkspaceCache(testScopedStorage),
    preparation: {
      appliedThemeContentHash: null,
      appliedThemeId: null,
      selectedThemeId: 'dark',
      syntaxHighlightingEnabled: false,
      analysisLimitMiCodeUnits: 10,
      tabSize: 4,
    },
  })
  const begin = () =>
    (globalThis as TraceGlobal).__editorPerfTrace?.beginEditorOpenSample({
      path: 'repo/a.ts',
      rootPath: 'repo',
    })

  try {
    expect(begin).toThrow('Editor-open benchmark control is unavailable')
    application.start()
    // The control now answers for itself: no workspace is open, so no root is active.
    expect(begin).toThrow('Editor-open benchmark target root is not active')
  } finally {
    application.dispose()
  }
  expect(begin).toThrow('Editor-open benchmark control is unavailable')
})
