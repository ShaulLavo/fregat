import { createRequire } from 'node:module'
import { act, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import { afterEach, vi } from 'vitest'

import { expect, test } from '../../../../../test/fixtures'
import { deferredThemeModule } from '../../../../../test/factories/deferred-theme-module'

// Resolve from the dependency owner; app-relative mocks miss these imports on clean installs.
const themeModuleResolver = createRequire(
  import.meta.resolve('@workspace/client-core/themes/registration'),
)
const monokaiModuleId = themeModuleResolver.resolve('@shikijs/themes/monokai')
const draculaModuleId = themeModuleResolver.resolve('@shikijs/themes/dracula')

let restoreClient: (() => void) | undefined

afterEach(() => {
  restoreClient?.()
  restoreClient = undefined
  vi.doUnmock(monokaiModuleId)
  vi.doUnmock(draculaModuleId)
  vi.resetModules()
})

test('a late older theme load cannot overwrite the newer applied theme id', async ({ client }) => {
  expect(client).toBeDefined()
  vi.resetModules()
  const monokai = deferredThemeModule(() => vi.importActual(monokaiModuleId))
  const dracula = deferredThemeModule(() => vi.importActual(draculaModuleId))
  vi.doMock(monokaiModuleId, monokai.load)
  vi.doMock(draculaModuleId, dracula.load)

  const store = await import('@/features/editor/state/color-theme-store')
  const { activeServerOrigin } = await import('@/lib/client')
  const { installTestEnvironment } = await import('../../../../../test/factories/client-binding')
  restoreClient = await installTestEnvironment(activeServerOrigin(), client)
  const { useEditorColorTheme } = await import('@/features/editor/hooks/use-editor-color-theme')
  const { renderWithProviders, createTestQueryClient } = await import('../../../../../test/render')
  const { settingsKeys } = await import('@workspace/client-core/settings/query-keys')
  const { fetchSettings, saveSettings } = await import('@/features/settings/utils/api')
  await saveSettings({
    mutationId: 'theme-load-seed',
    operations: [{ kind: 'set', key: 'editor.codeTheme.dark', value: 'monokai' }],
    target: 'user',
  })
  const queryClient = createTestQueryClient()
  queryClient.setQueryData(settingsKeys.document(), await fetchSettings())
  store.resetEditorColorThemeStore()
  let selectTheme: ReturnType<typeof useEditorColorTheme>['selectTheme'] | undefined

  function AppliedThemeProbe() {
    const theme = useEditorColorTheme()
    selectTheme = theme.selectTheme

    return createElement('output', {
      'data-applied-theme-id': theme.appliedThemeId ?? '',
      'data-selected-theme-id': theme.selectedThemeId,
    })
  }

  const view = renderWithProviders(createElement(AppliedThemeProbe), {
    command: false,
    queryClient,
  })
  await waitFor(() => expect(monokai.requested).toBe(true))

  act(() => selectTheme?.('dracula'))
  await waitFor(() => expect(dracula.requested).toBe(true))
  await act(() => dracula.release())
  await waitFor(() => {
    expect(view.getByRole('status')).toHaveAttribute('data-applied-theme-id', 'dracula')
    expect(view.getByRole('status')).toHaveAttribute('data-selected-theme-id', 'dracula')
  })

  await act(() => monokai.release())
  await Promise.resolve()

  expect(view.getByRole('status')).toHaveAttribute('data-applied-theme-id', 'dracula')
})
