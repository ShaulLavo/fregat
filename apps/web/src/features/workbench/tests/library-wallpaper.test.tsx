import { act, fireEvent, waitFor } from '@testing-library/react'
import { test, expect } from '../../../../test/fixtures'
import { wallpaperPng } from '../../../../test/factories/wallpaper'
import { createTestQueryClient, renderWithProviders } from '../../../../test/render'
import { Wallpaper } from '@/features/workbench/components/wallpaper'
import { refreshConfirmedSettings } from '@/features/settings/state/snapshot-admission'

test.afterEach(() => document.documentElement.removeAttribute('data-backdrop'))

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
          value: { enabled: true, source: { kind: 'library', asset: asset.id } },
        },
      ],
    })
    const queryClient = createTestQueryClient()
    await refreshConfirmedSettings(queryClient)
    document.documentElement.setAttribute('data-backdrop', backdrop)
    const view = renderWithProviders(<Wallpaper />, { command: false, queryClient })
    await act(() => refreshConfirmedSettings(view.queryClient))
    await waitFor(() =>
      expect(view.container.querySelectorAll('img')).toHaveLength(
        backdrop === 'transparent' ? 0 : 2,
      ),
    )
    for (const image of view.container.querySelectorAll('img')) fireEvent.error(image)
    expect(view.container.querySelector('img')).toBeNull()
    view.unmount()
    document.documentElement.removeAttribute('data-backdrop')
  },
)

test('color mode preserves the image and disabling hides it without losing the selection', async ({
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
        value: { enabled: true, source: { kind: 'library', asset: asset.id } },
      },
    ],
  })
  const queryClient = createTestQueryClient()
  await refreshConfirmedSettings(queryClient)
  const view = renderWithProviders(<Wallpaper />, { command: false, queryClient })
  await act(() => refreshConfirmedSettings(view.queryClient))
  await waitFor(() => expect(view.container.querySelectorAll('img')).toHaveLength(2))
  const original = view.container.querySelector('img')
  await act(async () => {
    await client.settings.write.post({
      mutationId: 'dark-mode',
      target: 'user',
      operations: [{ kind: 'set', key: 'workbench.colorTheme', value: 'dark' }],
    })
    await refreshConfirmedSettings(view.queryClient)
  })
  expect(view.container.querySelector('img')).toBe(original)
  await act(async () => {
    await client.settings.write.post({
      mutationId: 'hide-wallpaper',
      target: 'user',
      operations: [
        {
          kind: 'set',
          key: 'workbench.wallpaper',
          value: { enabled: false, source: { kind: 'library', asset: asset.id } },
        },
      ],
    })
    await refreshConfirmedSettings(view.queryClient)
  })
  await waitFor(() => expect(view.container.querySelector('img')).toBeNull())
  await waitFor(() => expect(document.documentElement).toHaveAttribute('data-wallpaper-hidden'))
})
