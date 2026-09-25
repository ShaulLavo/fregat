import { readWorkspaceCache } from '@/features/workspace/state/cache'
import { activeServerOrigin, setActiveServerOrigin, setClient } from '@/lib/client'
import { useEnvironmentsStore } from '@/lib/environments/state/store'
import { environmentScopedStorage } from '@/lib/environments/state/scoped-storage'
import { readEnvironmentDescriptor } from '@/lib/environments/utils/descriptor'
import { createApplicationRuntime } from '@/state/application-runtime'
import { createInProcessClient } from '../../../../test/client'
import { expect, test } from '../../../../test/fixtures'
import { makeTestServer } from '../../../../test/server'

test('a descriptor confirms storage ownership before runtime creation and identity drift preserves documents', async ({
  client,
}) => {
  const origin = 'http://localhost:37511'
  const previousOrigin = activeServerOrigin()
  const previousState = useEnvironmentsStore.getState()
  useEnvironmentsStore.getState().activate(origin)
  setClient(client)
  const descriptor = await readEnvironmentDescriptor(origin, new AbortController().signal)
  const application = createApplicationRuntime({
    workspaceCache: readWorkspaceCache(environmentScopedStorage(descriptor.environmentId)),
    preparation: {
      appliedThemeContentHash: null,
      appliedThemeId: null,
      selectedThemeId: 'dark-plus',
      syntaxHighlightingEnabled: false,
      tabSize: 4,
    },
  })
  const retained = application.getSnapshot().editor
  const replacement = await makeTestServer({ filesystemWatch: false })
  try {
    setClient(createInProcessClient(replacement))
    await expect(
      readEnvironmentDescriptor(origin, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'ENVIRONMENT_IDENTITY_DRIFT' })
    expect(useEnvironmentsStore.getState().entries[origin]?.environmentId).toBe(
      descriptor.environmentId,
    )
    expect(application.getSnapshot().editor).toBe(retained)
  } finally {
    application.dispose()
    useEnvironmentsStore.setState(previousState, true)
    setActiveServerOrigin(previousOrigin)
    await replacement.cleanup()
  }
})
