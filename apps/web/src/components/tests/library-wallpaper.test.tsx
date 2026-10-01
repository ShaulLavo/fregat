import { act, fireEvent, waitFor } from '@testing-library/react'
import { BUNDLED_THEMES, BUNDLED_WALLPAPERS } from '@workspace/contracts'
import { vi } from 'vitest'
import { test, expect } from '../../../test/fixtures'
import { omarchyCatalogWebp, wallpaperPng } from '../../../test/factories/wallpaper'
import { createTestQueryClient, renderWithProviders } from '../../../test/render'
import { Wallpaper } from '@/components/wallpaper'
import { LibraryWallpaper } from '@/components/library-wallpaper'
import { refreshConfirmedSettings } from '@/features/settings/state/snapshot-admission'

test.afterEach(() => {
  vi.restoreAllMocks()
  document.documentElement.removeAttribute('data-backdrop')
})

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

test.for(['bundled', 'uploaded'] as const)(
  'keeps the decoded %s wallpaper painted until a different asset decodes',
  async (origin, { client }) => {
    const theme = BUNDLED_THEMES.find((entry) => entry.id === 'graphite')!
    let assets = [BUNDLED_WALLPAPERS.graphiteLight.asset, BUNDLED_WALLPAPERS.graphiteDark.asset]
    if (origin === 'uploaded') {
      const first = await client.themes.wallpapers.post({
        file: new File([wallpaperPng()], 'first.png'),
      })
      const second = await client.themes.wallpapers.post({
        file: new File([omarchyCatalogWebp()], 'second.webp'),
      })
      assets = [first.data!.id, second.data!.id]
    }
    const initial = await client.settings.write.post({
      mutationId: 'initial-wallpaper',
      target: 'user',
      operations: [
        { kind: 'set', key: 'workbench.colorTheme', value: 'dark' },
        { kind: 'set', key: 'workbench.theme', value: theme },
        {
          kind: 'theme.customize',
          id: theme.id,
          mode: 'dark',
          patch: { wallpaper: { enabled: true, source: { kind: 'library', asset: assets[0]! } } },
        },
      ],
    })
    expect(initial.error).toBeFalsy()
    const queryClient = createTestQueryClient()
    await refreshConfirmedSettings(queryClient)
    document.documentElement.setAttribute('data-backdrop', 'app')
    const view = renderWithProviders(<Wallpaper />, { command: false, queryClient })
    await act(() => refreshConfirmedSettings(view.queryClient))
    const original = view.container.querySelector<HTMLImageElement>(
      '[data-workbench-wallpaper-layer="pending-still"]',
    )!
    await act(async () => {
      fireEvent.load(original)
    })
    expect(original).toHaveAttribute('data-workbench-wallpaper-layer', 'still')
    expect(original.src).toContain(assets[0])
    await act(async () => {
      const changed = await client.settings.write.post({
        mutationId: 'replacement-wallpaper',
        target: 'user',
        operations: [
          {
            kind: 'theme.customize',
            id: theme.id,
            mode: 'dark',
            patch: { wallpaper: { enabled: true, source: { kind: 'library', asset: assets[1]! } } },
          },
        ],
      })
      expect(changed.error).toBeFalsy()
      await refreshConfirmedSettings(queryClient)
    })
    await waitFor(() =>
      expect(
        view.container.querySelector(`img[src*="${assets[1]}"][decoding="async"]`),
      ).not.toBeNull(),
    )
    expect(original.isConnected).toBe(true)
    expect(original).not.toHaveClass('opacity-0')
    expect(view.container.querySelector('[data-workbench-wallpaper-layer="still"]')).toBe(original)
    const replacement = view.container.querySelector<HTMLImageElement>(
      '[data-workbench-wallpaper-layer="pending-still"]',
    )!
    expect(replacement.src).toContain(assets[1])
    const decoded = Promise.withResolvers<void>()
    const decode = vi.spyOn(replacement, 'decode').mockReturnValue(decoded.promise)
    await act(async () => {
      fireEvent.load(replacement)
    })
    expect(decode).toHaveBeenCalledOnce()
    expect(original.isConnected).toBe(true)
    expect(replacement).toHaveClass('opacity-0')
    await act(async () => {
      decoded.resolve()
    })
    expect(original.isConnected).toBe(false)
    expect(view.container.querySelector('[data-workbench-wallpaper-layer="still"]')).toBe(
      replacement,
    )
    expect(replacement).not.toHaveClass('opacity-0')
    expect(view.container.querySelectorAll('img')).toHaveLength(1)
    decode.mockRestore()
  },
)

test('a superseded decode cannot replace the last painted wallpaper', async () => {
  const first = BUNDLED_WALLPAPERS.graphiteLight.asset
  const second = BUNDLED_WALLPAPERS.graphiteDark.asset
  const third = BUNDLED_WALLPAPERS.sageDark.asset
  const view = renderWithProviders(<LibraryWallpaper asset={first} />, { command: false })
  const original = view.container.querySelector<HTMLImageElement>(
    '[data-workbench-wallpaper-layer="pending-still"]',
  )!
  await act(async () => {
    fireEvent.load(original)
  })
  view.rerender(<LibraryWallpaper asset={second} />)
  const superseded = view.container.querySelector<HTMLImageElement>(
    '[data-workbench-wallpaper-layer="pending-still"]',
  )!
  const decoded = Promise.withResolvers<void>()
  const decode = vi.spyOn(superseded, 'decode').mockReturnValue(decoded.promise)
  await act(async () => {
    fireEvent.load(superseded)
  })
  view.rerender(<LibraryWallpaper asset={third} />)
  expect(superseded.isConnected).toBe(false)
  await act(async () => {
    decoded.resolve()
  })
  expect(original.isConnected).toBe(true)
  expect(view.container.querySelector('[data-workbench-wallpaper-layer="still"]')).toBe(original)
  const replacement = view.container.querySelector<HTMLImageElement>(
    '[data-workbench-wallpaper-layer="pending-still"]',
  )!
  expect(replacement.src).toContain(third)
  await act(async () => {
    fireEvent.load(replacement)
  })
  expect(original.isConnected).toBe(false)
  expect(view.container.querySelector('[data-workbench-wallpaper-layer="still"]')).toBe(replacement)
  decode.mockRestore()
})

test.for(['request', 'decode'] as const)(
  'a failed replacement %s keeps the previous wallpaper and can be retried',
  async (failure) => {
    const first = BUNDLED_WALLPAPERS.graphiteLight.asset
    const second = BUNDLED_WALLPAPERS.graphiteDark.asset
    const view = renderWithProviders(<LibraryWallpaper asset={first} />, { command: false })
    const original = view.container.querySelector<HTMLImageElement>(
      '[data-workbench-wallpaper-layer="pending-still"]',
    )!
    await act(async () => {
      fireEvent.load(original)
    })
    view.rerender(<LibraryWallpaper asset={second} />)
    const replacement = view.container.querySelector<HTMLImageElement>(
      '[data-workbench-wallpaper-layer="pending-still"]',
    )!
    if (failure === 'decode') {
      vi.spyOn(replacement, 'decode').mockRejectedValue(undefined)
      await act(async () => {
        fireEvent.load(replacement)
      })
    }
    if (failure === 'request') fireEvent.error(replacement)
    expect(original.isConnected).toBe(true)
    expect(view.container.querySelector('[data-workbench-wallpaper-layer="still"]')).toBe(original)
    expect(original).not.toHaveClass('opacity-0')
    expect(replacement.isConnected).toBe(false)
    view.rerender(<LibraryWallpaper asset={first} />)
    expect(view.container.querySelector('[data-workbench-wallpaper-layer="still"]')).toBe(original)
    view.rerender(<LibraryWallpaper asset={second} />)
    const retried = view.container.querySelector<HTMLImageElement>(
      '[data-workbench-wallpaper-layer="pending-still"]',
    )!
    expect(retried).not.toBe(replacement)
    await act(async () => {
      fireEvent.load(retried)
    })
    expect(view.container.querySelector('[data-workbench-wallpaper-layer="still"]')).toBe(retried)
    expect(original.isConnected).toBe(false)
  },
)
