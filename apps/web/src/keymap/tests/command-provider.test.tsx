import { settingsPageQueryOptions } from '@/features/settings/utils/page-query'
import { primaryQueryClient } from '@/lib/environments/state/query-clients'
import { BUNDLED_THEMES, resolveThemeSettings } from '@workspace/contracts'
import { wallpaperPng } from '../../../test/factories/wallpaper'
import { getClient } from '@/lib/client'
import { filesystemPath } from '@/lib/documents/utils/identity'
import { selectSettingsSearch } from '@/features/settings/state/search-store'
import { selectSettingsCategory } from '@/features/settings/state/category-store'
import { selectSettingsView } from '@/features/settings/state/view-store'
import { testScopedStorage } from '../../../test/factories/scoped-storage'
import { useEffect } from 'react'
import { act, screen, waitFor } from '@testing-library/react'
import type { SettingsMutationRequest, SettingsValues } from '@workspace/contracts'

import { EditorTabActionsProvider } from '@/features/editor/providers/tab-actions-provider'
import { TestEditorStateProvider as EditorStateProvider } from '../../../test/factories/editor-state-provider'
import { useSettingsIntentStore } from '@/features/settings/state/intent-store'
import { resetSettingsIntentStore } from '@workspace/client-core/settings/intent-store'
import { resetSettingsSnapshotAdmission } from '@/features/settings/state/snapshot-admission'
import { fetchSettings } from '@/features/settings/utils/api'
import { settingsKeys } from '@workspace/client-core/settings/query-keys'
import { writeRootFolderCache } from '@/features/workspace/state/cache'
import { useCommand } from '@/keymap/hooks/use-command'
import { CommandProvider } from '@/keymap/providers/command-provider'
import type { PlatformCommandBus } from '@/keymap/providers/command-context'
import { installTestEnvironment } from '../../../test/factories/client-binding'
import { createFolderPath } from '@/lib/file-server'
import { createInProcessClient } from '../../../test/client'
import { expect, test } from '../../../test/fixtures'
import { createTestQueryClient, renderWithProviders } from '../../../test/render'
import { makeTestServer } from '../../../test/server'
import { createTestApplicationRuntime } from '../../../test/factories/application-runtime'
import { activeEnvironmentId } from '@/lib/environments/state/domain'

let capturedBus: PlatformCommandBus | null = null

test.beforeEach(() => {
  capturedBus = null
  selectSettingsSearch('')
  selectSettingsCategory(null)
  selectSettingsView('form')
  resetSettingsIntentStore()
  writeRootFolderCache(testScopedStorage, null)
})

test.afterEach(() => {
  capturedBus = null
  selectSettingsSearch('')
  selectSettingsCategory(null)
  selectSettingsView('form')
  resetSettingsIntentStore()
  writeRootFolderCache(testScopedStorage, null)
})

test.each([
  ['workspace.showUnicodeSettings', 'unicode'],
  ['workspace.showFontSettings', 'font'],
  ['workspace.showUsage', 'usage'],
  ['workspace.showTransparencySettings', 'workbench.surface'],
] as const)('%s opens the settings controls matching its search', async (command, query) => {
  await primaryQueryClient().fetchQuery(settingsPageQueryOptions)
  const queryClient = createTestQueryClient()
  queryClient.setQueryData(settingsKeys.document(), await fetchSettings(undefined, getClient()))
  selectSettingsCategory('Machines')
  selectSettingsView('json')
  const view = renderCommandProvider(queryClient)
  await waitFor(() => expect(capturedBus).not.toBeNull())

  act(() => {
    capturedBus!.dispatch(command, invocation())
  })

  await waitFor(() =>
    expect(screen.getByRole('textbox', { name: 'Search settings' })).toHaveValue(query),
  )
  expect(screen.queryByText('Clear category filter')).toBeNull()
  view.unmount()
  resetSettingsSnapshotAdmission(queryClient)
  queryClient.clear()
})

test('consecutive toggles project landed settings intents before React renders', async ({
  controlledClient,
}) => {
  const queryClient = createTestQueryClient()
  const before = await fetchSettings(undefined, getClient())
  queryClient.setQueryData(settingsKeys.document(), before)
  const view = renderWithProviders(
    <EditorStateProvider>
      <EditorTabActionsProvider requestCloseTab={rejectCloseTab} requestCloseTabs={rejectCloseTabs}>
        <CommandProvider>
          <BusCapture />
        </CommandProvider>
      </EditorTabActionsProvider>
    </EditorStateProvider>,
    { command: false, queryClient },
  )
  await waitFor(() => expect(capturedBus).not.toBeNull())
  if (!capturedBus) return

  let first!: ReturnType<PlatformCommandBus['dispatch']>
  let second!: ReturnType<PlatformCommandBus['dispatch']>
  act(() => {
    first = capturedBus!.dispatch('workspace.toggleWallpaper', invocation())
    second = capturedBus!.dispatch('workspace.toggleWallpaper', invocation())
  })

  expect(first.claimed).toBe(true)
  expect(second.claimed).toBe(true)
  expect(
    useSettingsIntentStore.getState().active.map((entry) => entry.patch.request.operations),
  ).toEqual([
    [
      {
        key: 'workbench.wallpaper',
        kind: 'set',
        value: { enabled: false, source: { kind: 'desktop' } },
      },
    ],
    [
      {
        key: 'workbench.wallpaper',
        kind: 'set',
        value: { enabled: true, source: { kind: 'desktop' } },
      },
    ],
  ])

  await controlledClient.controller.waitForSettingsWriteRequest(2)
  const requests =
    (await controlledClient.controller.settingsWriteRequests()) as SettingsMutationRequest[]
  expect(requests.map((request) => request.operations)).toEqual([
    [
      {
        key: 'workbench.wallpaper',
        kind: 'set',
        value: { enabled: false, source: { kind: 'desktop' } },
      },
    ],
    [
      {
        key: 'workbench.wallpaper',
        kind: 'set',
        value: { enabled: true, source: { kind: 'desktop' } },
      },
    ],
  ])
  await expect(first.completion).resolves.toEqual({ status: 'handled' })
  await expect(second.completion).resolves.toEqual({ status: 'handled' })

  view.unmount()
  resetSettingsSnapshotAdmission(queryClient)
  queryClient.clear()
})

test('consecutive toggles replay intents before the confirmed settings query lands', async ({
  controlledClient,
}) => {
  const queryClient = createTestQueryClient()
  const view = renderCommandProvider(queryClient)
  await waitFor(() => expect(capturedBus).not.toBeNull())
  queryClient.removeQueries({ queryKey: settingsKeys.document() })
  expect(queryClient.getQueryData(settingsKeys.document())).toBeUndefined()
  if (!capturedBus) return

  let first!: ReturnType<PlatformCommandBus['dispatch']>
  let second!: ReturnType<PlatformCommandBus['dispatch']>
  act(() => {
    first = capturedBus!.dispatch('workspace.toggleWallpaper', invocation())
    second = capturedBus!.dispatch('workspace.toggleWallpaper', invocation())
  })

  expect(
    useSettingsIntentStore.getState().active.map((entry) => entry.patch.request.operations),
  ).toEqual([
    [
      {
        key: 'workbench.wallpaper',
        kind: 'set',
        value: { enabled: false, source: { kind: 'desktop' } },
      },
    ],
    [
      {
        key: 'workbench.wallpaper',
        kind: 'set',
        value: { enabled: true, source: { kind: 'desktop' } },
      },
    ],
  ])
  await controlledClient.controller.waitForSettingsWriteRequest(2)
  await expect(first.completion).resolves.toEqual({ status: 'handled' })
  await expect(second.completion).resolves.toEqual({ status: 'handled' })

  view.unmount()
  resetSettingsSnapshotAdmission(queryClient)
  queryClient.clear()
})

test('consecutive color-mode commands read intents before React renders', async ({
  controlledClient,
}) => {
  const queryClient = createTestQueryClient()
  const confirmed = await fetchSettings(undefined, getClient())
  queryClient.setQueryData(settingsKeys.document(), confirmed)
  const view = renderCommandProvider(queryClient)
  await waitFor(() => expect(capturedBus).not.toBeNull())
  if (!capturedBus) return

  const confirmedTheme = confirmed.values['workbench.colorTheme']
  const firstTheme = confirmedTheme === 'dark' ? 'light' : 'dark'
  let first!: ReturnType<PlatformCommandBus['dispatch']>
  let second!: ReturnType<PlatformCommandBus['dispatch']>
  act(() => {
    first = capturedBus!.dispatch(themeCommand(firstTheme), invocation())
    second = capturedBus!.dispatch(themeCommand(confirmedTheme), invocation())
  })

  expect(first.claimed).toBe(true)
  expect(second.claimed).toBe(true)
  expect(
    useSettingsIntentStore.getState().active.map((entry) => entry.patch.request.operations),
  ).toEqual([
    [{ key: 'workbench.colorTheme', kind: 'set', value: firstTheme }],
    [{ key: 'workbench.colorTheme', kind: 'set', value: confirmedTheme }],
  ])

  await controlledClient.controller.waitForSettingsWriteRequest(2)
  await expect(first.completion).resolves.toEqual({ status: 'handled' })
  await expect(second.completion).resolves.toEqual({ status: 'handled' })

  view.unmount()
  resetSettingsSnapshotAdmission(queryClient)
  queryClient.clear()
})

test.for([
  {
    command: 'workspace.toggleWallpaper',
    key: 'workbench.wallpaper',
    toggled: { enabled: false, source: { kind: 'desktop' } },
  },
  {
    command: 'workspace.toggleDiffViewMode',
    key: 'editor.diff.viewMode',
    toggled: 'split',
  },
] as const)(
  '$command reads and writes the primary settings while the remote editor is active',
  async ({ command, key, toggled }, { client }) => {
    const primary = createTestQueryClient()
    const primaryBefore = await fetchSettings(undefined, client)
    primary.setQueryData(settingsKeys.document(), primaryBefore)
    const remoteServer = await makeTestServer({ filesystemWatch: false })
    const remoteClient = createInProcessClient(remoteServer)
    const restoreEnvironment = await installTestEnvironment('http://localhost:3521', remoteClient)
    const editor = createTestQueryClient()
    let view: ReturnType<typeof renderCommandProvider> | null = null

    try {
      const remoteBefore = await fetchSettings(undefined, remoteClient)
      editor.setQueryData(settingsKeys.document(), remoteBefore)
      const root = await createFolderPath(filesystemPath('remote-project'), remoteClient)
      const application = createTestApplicationRuntime()
      await application.openEnvironmentWorkspaceRoot(activeEnvironmentId(), root.path)
      view = renderCommandProvider(editor, primary, application)
      await waitFor(() => expect(capturedBus).not.toBeNull())

      await act(async () => {
        const ticket = capturedBus!.dispatch(command, invocation())
        await expect(ticket.completion).resolves.toEqual({ status: 'handled' })
      })
      expect((await fetchSettings(undefined, client)).values[key]).toEqual(toggled)

      await act(async () => {
        const ticket = capturedBus!.dispatch(command, invocation())
        await expect(ticket.completion).resolves.toEqual({ status: 'handled' })
      })
      expect((await fetchSettings(undefined, client)).values[key]).toEqual(
        primaryBefore.values[key],
      )
      expect((await fetchSettings(undefined, remoteClient)).values).toEqual(remoteBefore.values)
    } finally {
      view?.unmount()
      resetSettingsSnapshotAdmission(primary)
      resetSettingsSnapshotAdmission(editor)
      primary.clear()
      editor.clear()
      restoreEnvironment()
      await remoteServer.cleanup()
    }
  },
)

function BusCapture() {
  const { bus } = useCommand()
  useEffect(() => captureBus(bus), [bus])
  return null
}

function captureBus(bus: PlatformCommandBus) {
  capturedBus = bus
}

function renderCommandProvider(
  queryClient: ReturnType<typeof createTestQueryClient>,
  settingsOwner = queryClient,
  application?: ReturnType<typeof createTestApplicationRuntime>,
) {
  return renderWithProviders(
    <EditorStateProvider>
      <EditorTabActionsProvider requestCloseTab={rejectCloseTab} requestCloseTabs={rejectCloseTabs}>
        <CommandProvider>
          <BusCapture />
        </CommandProvider>
      </EditorTabActionsProvider>
    </EditorStateProvider>,
    { command: false, queryClient, settingsOwner, application },
  )
}

function invocation() {
  return { source: { caller: 'command-provider-test', kind: 'programmatic' } } as const
}

function themeCommand(theme: SettingsValues['workbench.colorTheme']) {
  if (theme === 'dark') return 'workspace.setDarkTheme' as const
  if (theme === 'light') return 'workspace.setLightTheme' as const

  return 'workspace.setSystemTheme' as const
}

function rejectCloseTab() {
  return { reason: 'not-found', status: 'rejected' } as const
}

function rejectCloseTabs() {
  return { reason: 'not-found', status: 'rejected' } as const
}

test('wallpaper toggles preserve the chosen image across color modes and remounts', async ({
  client,
}) => {
  const asset = (
    await client.themes.wallpapers.post({ file: new File([wallpaperPng()], 'retained.png') })
  ).data!
  const source = { kind: 'library', asset: asset.id } as const
  await client.settings.write.post({
    mutationId: 'selected-wallpaper',
    target: 'user',
    operations: [{ kind: 'set', key: 'workbench.wallpaper', value: { enabled: true, source } }],
  })
  const queryClient = createTestQueryClient()
  queryClient.setQueryData(settingsKeys.document(), await fetchSettings(undefined, getClient()))
  const view = renderCommandProvider(queryClient)
  await waitFor(() => expect(capturedBus).not.toBeNull())
  for (const command of [
    'workspace.toggleWallpaper',
    'workspace.setLightTheme',
    'workspace.setDarkTheme',
  ] as const) {
    await act(async () => {
      await capturedBus!.dispatch(command, invocation()).completion
    })
    expect((await fetchSettings(undefined, getClient())).values['workbench.wallpaper']).toEqual({
      enabled: false,
      source,
    })
  }
  view.unmount()
  resetSettingsSnapshotAdmission(queryClient)
  queryClient.clear()
  queryClient.setQueryData(settingsKeys.document(), await fetchSettings(undefined, getClient()))
  const remounted = renderCommandProvider(queryClient)
  await act(async () => {
    await capturedBus!.dispatch('workspace.toggleWallpaper', invocation()).completion
  })
  expect((await fetchSettings(undefined, getClient())).values['workbench.wallpaper']).toEqual({
    enabled: true,
    source,
  })
  remounted.unmount()
})

test('bundle wallpaper toggle retains the active variant image', async ({ client }) => {
  const asset = (
    await client.themes.wallpapers.post({ file: new File([wallpaperPng()], 'bundle.png') })
  ).data!
  const source = { kind: 'library', asset: asset.id } as const
  const base = BUNDLED_THEMES[0]!
  const bundle = {
    ...base,
    variants: {
      ...base.variants,
      light: { ...base.variants.light, wallpaper: { enabled: true, source } },
    },
  }
  await client.settings.write.post({
    mutationId: 'bundle-wallpaper-toggle',
    target: 'user',
    operations: [
      { kind: 'set', key: 'workbench.theme', value: bundle },
      { kind: 'set', key: 'workbench.colorTheme', value: 'light' },
    ],
  })
  const queryClient = createTestQueryClient()
  queryClient.setQueryData(settingsKeys.document(), await fetchSettings(undefined, getClient()))
  const view = renderCommandProvider(queryClient)
  await waitFor(() => expect(capturedBus).not.toBeNull())
  for (const enabled of [false, true]) {
    await act(async () => {
      await capturedBus!.dispatch('workspace.toggleWallpaper', invocation()).completion
    })
    const snapshot = await fetchSettings(undefined, getClient())
    expect(resolveThemeSettings(snapshot.values, 'light')['workbench.wallpaper']).toEqual({
      enabled,
      source,
    })
  }
  view.unmount()
})
