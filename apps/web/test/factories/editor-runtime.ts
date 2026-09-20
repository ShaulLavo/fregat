import { testScopedStorage } from './scoped-storage'
import type { QueryClient } from '@tanstack/react-query'

import { addressedWorkspaceCache } from '@/features/address/utils/cache'
import { parseAddress } from '@workspace/client-core/address/grammar'
import { createEditorRuntime } from '@/features/editor/state/runtime'
import { readSettingsMirror } from '@/lib/settings-boot-mirror'
import { readWorkspaceCache, type CachedWorkspaceState } from '@/features/workspace/state/cache'
import { activeServerOrigin, getClient } from '@/lib/client'
import { registerEnvironmentQueryClient } from '@/lib/environments/state/query-clients'

export function createTestEditorRuntime(
  queryClient: QueryClient,
  workspaceCache: CachedWorkspaceState = addressedWorkspaceCache(
    readWorkspaceCache(testScopedStorage),
    parseAddress(window.location.href),
  ),
) {
  registerEnvironmentQueryClient(queryClient, activeServerOrigin(), getClient())
  return createEditorRuntime({
    storage: testScopedStorage,
    queryClient,
    workspaceCache,
    preparation: {
      appliedThemeContentHash: null,
      appliedThemeId: null,
      selectedThemeId: 'dark',
      syntaxHighlightingEnabled: readSettingsMirror()['editor.syntaxHighlighting.enabled'],
    },
  })
}
