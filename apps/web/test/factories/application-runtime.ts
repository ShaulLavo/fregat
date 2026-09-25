import { environmentScopedStorage } from '@/lib/environments/state/scoped-storage'
import { activeEnvironmentId } from '@/lib/environments/state/domain'
import { onTestFinished } from 'vitest'
import { readWorkspaceCache } from '@/features/workspace/state/cache'
import { createApplicationRuntime } from '@/state/application-runtime'

export function createTestApplicationRuntime() {
  const application = createApplicationRuntime({
    workspaceCache: readWorkspaceCache(environmentScopedStorage(activeEnvironmentId())),
    preparation: {
      appliedThemeContentHash: null,
      appliedThemeId: null,
      selectedThemeId: 'dark-plus',
      syntaxHighlightingEnabled: false,
      tabSize: 4,
    },
  })
  onTestFinished(() => application.dispose())
  return application
}
