import { act, fireEvent, waitFor } from '@testing-library/react'
import { test, expect } from '../../../../test/fixtures'
import { wallpaperPng } from '../../../../test/factories/wallpaper'
import { createTestQueryClient, renderWithProviders } from '../../../../test/render'
import { Wallpaper } from '@/features/workbench/components/wallpaper'
import { refreshConfirmedSettings } from '@/features/settings/state/snapshot-admission'

test.for(['app', 'compositor', 'transparent'] as const)(
  'library rendering on %s backdrop',
  async (backdrop, { client }) => {
    const asset = (
      await client.themes.wallpapers.post({ file: new File([wallpaperPng()], 'sample.png') })
    ).data!
    await client.settings.write.post({
      mutationId: 'render-library',
      target: 'user',
      operations: [
        {
          kind: 'set',
          key: 'workbench.wallpaper',
          value: {
            light: { kind: 'library', asset: asset.id },
            dark: { kind: 'library', asset: asset.id },
          },
        },
      ],
    })
    const queryClient = createTestQueryClient()
    await refreshConfirmedSettings(queryClient)
    const view = renderWithProviders(<Wallpaper />, { command: false, queryClient })
    document.documentElement.setAttribute('data-backdrop', backdrop)
    await act(() => refreshConfirmedSettings(view.queryClient))
    await waitFor(() =>
      expect(view.container.querySelectorAll('img')).toHaveLength(
        backdrop === 'transparent' ? 0 : 2,
      ),
    )
    view.unmount()
    document.documentElement.removeAttribute('data-backdrop')
  },
)

test('switching modes removes the previous image and failed images reveal the solid floor', async ({
  client,
}) => {
  const asset = (
    await client.themes.wallpapers.post({ file: new File([wallpaperPng()], 'sample.png') })
  ).data!
  await client.settings.write.post({
    mutationId: 'light-library',
    target: 'user',
    operations: [
      { kind: 'set', key: 'workbench.colorTheme', value: 'light' },
      {
        kind: 'set',
        key: 'workbench.wallpaper',
        value: { light: { kind: 'library', asset: asset.id }, dark: { kind: 'none' } },
      },
    ],
  })
  const queryClient = createTestQueryClient()
  await refreshConfirmedSettings(queryClient)
  const view = renderWithProviders(<Wallpaper />, { command: false, queryClient })
  await act(() => refreshConfirmedSettings(view.queryClient))
  await waitFor(() => expect(view.container.querySelectorAll('img')).toHaveLength(2))
  for (const image of view.container.querySelectorAll('img')) fireEvent.error(image)
  expect(view.container.querySelector('img')).toBeNull()
  await act(async () => {
    await client.settings.write.post({
      mutationId: 'dark-none',
      target: 'user',
      operations: [{ kind: 'set', key: 'workbench.colorTheme', value: 'dark' }],
    })
    await refreshConfirmedSettings(view.queryClient)
  })
  expect(view.container.querySelector('img')).toBeNull()
  await waitFor(() => expect(document.documentElement).toHaveAttribute('data-wallpaper-hidden'))
})
