import { getClient } from '@/lib/client'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { expect, test } from '../../../../test/fixtures'
import { createTestQueryClient, renderWithProviders } from '../../../../test/render'
import { createTestApplicationRuntime } from '../../../../test/factories/application-runtime'
import { TestEditorStateProvider } from '../../../../test/factories/editor-state-provider'
import { wallpaperPng } from '../../../../test/factories/wallpaper'
import { CommandPalette } from '@/components/command-palette'
import { fetchSettings } from '@/features/settings/utils/api'
import { useWallpaperPreviewStore } from '@/lib/wallpapers/state/preview-store'
import { settingsKeys } from '@workspace/client-core/settings/query-keys'

test('the highlighted wallpaper previews, Escape drops it unsaved, and a pick is written', async ({
  client,
  controlledClient,
}) => {
  const asset = (await client.themes.wallpapers.post({ file: new File([wallpaperPng()], 'x.png') }))
    .data!
  const before = await fetchSettings(undefined, getClient())
  const queryClient = createTestQueryClient()
  queryClient.setQueryData(settingsKeys.document(), before)
  const options = {
    application: createTestApplicationRuntime(),
    command: { paletteOpen: true, paletteSearch: 'wallpaper x' },
    queryClient,
  }
  const first = renderWithProviders(
    <TestEditorStateProvider>
      <CommandPalette />
    </TestEditorStateProvider>,
    options,
  )
  const user = userEvent.setup()
  await screen.findByPlaceholderText(/Select a wallpaper/)
  await waitFor(() =>
    expect(useWallpaperPreviewStore.getState().source).toEqual({
      kind: 'library',
      asset: asset.id,
    }),
  )

  await user.keyboard('{Escape}')
  await waitFor(() => expect(useWallpaperPreviewStore.getState().source).toBeNull())
  expect(controlledClient.controller.settingsWriteCount).toBe(0)
  first.unmount()

  renderWithProviders(
    <TestEditorStateProvider>
      <CommandPalette />
    </TestEditorStateProvider>,
    options,
  )
  await user.click(await screen.findByText('x'))
  await waitFor(async () => {
    const { light, dark } = (await fetchSettings(undefined, getClient())).values[
      'workbench.wallpaper'
    ]
    expect([light, dark]).toContainEqual({ kind: 'library', asset: asset.id })
  })
  expect(controlledClient.controller.settingsWriteCount).toBe(1)
})
