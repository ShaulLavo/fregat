import { act, waitFor } from '@testing-library/react'
import { useApplicationRuntime } from '@/hooks/use-application-runtime'
import { useNavigation } from '@/hooks/use-navigation'
import { settingsDocumentId } from '@/features/settings/utils/document'
import { environmentActivitySignal } from '@/lib/environments/state/activity'
import { confirmedEnvironmentId } from '@/lib/environments/state/domain'
import { expect, test } from './fixtures'
import { renderHookWithProviders } from './render'

test.for([false, true])(
  'fallback providers keep a live runtime with StrictMode=%s',
  async (reactStrictMode) => {
    const rendered = renderHookWithProviders(
      () => ({ application: useApplicationRuntime(), navigation: useNavigation() }),
      { reactStrictMode },
    )
    const { application, navigation } = rendered.result.current
    const owner = application.getSnapshot()
    expect(application.getEnvironment(confirmedEnvironmentId(owner.origin)) === owner).toBe(true)
    expect(environmentActivitySignal(owner.origin).aborted).toBe(false)
    await waitFor(() => expect(navigation.getSnapshot().status).toBe('applied'))
    await act(async () => {
      expect(
        await navigation
          .editorCommands(owner.editor.workspaceStore)
          .openSettingsEditor('Providers'),
      ).toEqual({ status: 'applied' })
    })
    expect(navigation.currentAddress()).toMatchObject({
      workspace: '-',
      document: 'settings',
      settings: 'providers',
    })
    expect(owner.editor.workspaceStore.getState().selectedFilePath).toBe(settingsDocumentId())
    rendered.unmount()
    expect(application.getEnvironment(confirmedEnvironmentId(owner.origin))).toBeUndefined()
  },
)
