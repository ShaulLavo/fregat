import { addressHrefFromBrowser } from '@/features/address/utils/browser-url'
import type { HealthDescriptor } from '@workspace/contracts'
import { addressedWorkspaceCache, panelsForAddress } from '@/features/address/utils/cache'
import { parseAddress } from '@workspace/client-core/address/grammar'
import { readWorkspaceCache } from '@/features/workspace/state/cache'
import { getSelectedEditorThemeId } from '@/features/editor/state/color-theme-store'
import { systemPrefersDark } from '@/features/settings/providers/appearance-provider'
import { readSettingsMirror } from '@/features/settings/utils/boot-mirror'
import { environmentScopedStorage } from '@/lib/environments/state/scoped-storage'
import { primaryQueryClient } from '@/lib/environments/state/query-clients'
import { primaryServerOrigin } from '@/lib/client'
import { useEnvironmentsStore } from '@/lib/environments/state/store'
import { createApplicationRuntime } from '@/state/application-runtime'
import { createClientInvariantError } from '@/lib/structured-errors'

export function createBootRuntime(descriptor: HealthDescriptor, cached = false) {
  if (
    cached &&
    !useEnvironmentsStore.getState().restoreDescriptor(primaryServerOrigin(), descriptor)
  )
    throw createClientInvariantError(
      'The cached machine identity conflicts with the current connection.',
    )
  if (!cached) useEnvironmentsStore.getState().recordDescriptor(primaryServerOrigin(), descriptor)
  if (cached) useEnvironmentsStore.getState().setPhase(primaryServerOrigin(), 'offline')
  primaryQueryClient().setQueryData(['environment-descriptor'], descriptor)
  const address = parseAddress(addressHrefFromBrowser(window.location.href))
  const application = createApplicationRuntime({
    workspaceCache: addressedWorkspaceCache(
      readWorkspaceCache(environmentScopedStorage(descriptor.environmentId)),
      address,
    ),
    preparation: {
      appliedThemeContentHash: null,
      appliedThemeId: null,
      selectedThemeId: getSelectedEditorThemeId(systemPrefersDark() ? 'dark' : 'light'),
      syntaxHighlightingEnabled: readSettingsMirror()['editor.syntaxHighlighting.enabled'],
    },
  })
  const workspace = application.getSnapshot().editor.workspaceStore
  if (workspace.getState().rootFolder === null && address.rejectedEnvironment === null) {
    workspace
      .getState()
      .setWorkbenchPanels(panelsForAddress(workspace.getState().workbenchPanels, null, address))
  }
  return application
}
