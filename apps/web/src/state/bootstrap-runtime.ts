import { restoreSettingsView } from '@/features/settings/state/reload'
import { environmentQueryKeys } from '@/features/environments/utils/query-keys'
import { environmentIdSchema, type HealthDescriptor } from '@workspace/contracts'
import * as v from 'valibot'
import { addressedWorkspaceCache, panelsForAddress } from '@/features/address/utils/cache'
import type { AddressIntent } from '@/features/address/utils/intent'
import { readWorkspaceCache } from '@/features/workspace/state/cache'
import { getSelectedEditorThemeId } from '@/features/editor/state/color-theme-store'
import { systemColorMode } from '@/features/settings/state/system-color-mode'
import { readSettingsMirror } from '@/lib/settings-boot-mirror'
import { environmentScopedStorage } from '@/lib/environments/state/scoped-storage'
import { primaryQueryClient } from '@/lib/environments/state/query-clients'
import { primaryServerOrigin } from '@/lib/client'
import { useEnvironmentsStore } from '@/lib/environments/state/store'
import { createApplicationRuntime } from '@/state/application-runtime'
import { createClientInvariantError } from '@/lib/structured-errors'

export function createBootRuntime(
  descriptor: HealthDescriptor,
  intent: AddressIntent,
  {
    cached = false,
    initialSession = 'restore',
  }: {
    readonly cached?: boolean
    readonly initialSession?: 'restore' | 'list'
  } = {},
) {
  if (
    cached &&
    !useEnvironmentsStore.getState().restoreDescriptor(primaryServerOrigin(), descriptor)
  )
    throw createClientInvariantError(
      'The cached machine identity conflicts with the current connection.',
    )
  if (!cached) useEnvironmentsStore.getState().recordDescriptor(primaryServerOrigin(), descriptor)
  if (cached) useEnvironmentsStore.getState().setPhase(primaryServerOrigin(), 'connecting')
  if (!cached) primaryQueryClient().setQueryData(environmentQueryKeys.descriptor, descriptor)
  const address = intent.address
  const target = v.safeParse(
    environmentIdSchema,
    address.environmentId ?? address.rejectedEnvironment ?? descriptor.environmentId,
  )
  const application = createApplicationRuntime({
    initialSession:
      target.success && initialSession === 'list'
        ? { environmentId: target.output, selection: { kind: 'auto' } }
        : undefined,
    workspaceCache: addressedWorkspaceCache(
      readWorkspaceCache(environmentScopedStorage(descriptor.environmentId)),
      address,
    ),
    preparation: {
      appliedThemeContentHash: null,
      appliedThemeId: null,
      selectedThemeId: getSelectedEditorThemeId(systemColorMode()),
      syntaxHighlightingEnabled: readSettingsMirror()['editor.syntaxHighlighting.enabled'],
      analysisLimitMiCodeUnits: readSettingsMirror()['editor.largeFile.analysisLimitMiCodeUnits'],
      tabSize: readSettingsMirror()['editor.tabSize'],
    },
  })
  restoreSettingsView(primaryQueryClient())
  const workspace = application.getSnapshot().editor.workspaceStore
  if (workspace.getState().rootFolder === null && address.rejectedEnvironment === null) {
    workspace
      .getState()
      .setWorkbenchPanels(panelsForAddress(workspace.getState().workbenchPanels, null, address))
  }
  return application
}
