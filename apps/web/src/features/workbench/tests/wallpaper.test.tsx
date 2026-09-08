import { fireEvent } from '@testing-library/react'
import { QueryClient } from '@tanstack/react-query'
import { afterEach, vi } from 'vitest'
import { WebWallpaper } from '@/features/workbench/components/web-wallpaper'
import { wallpaperStillUrl } from '@/features/workbench/state/wallpaper-query'
import { WALLPAPER_URL } from '@/features/workbench/utils/wallpaper'
import { primaryServerOrigin } from '@/lib/client'
import { registerEnvironmentQueryClient } from '@/lib/environments/state/query-clients'

import { expect, test } from '../../../../test/fixtures'
import { renderWithProviders } from '../../../../test/render'

function disableMotion() {
  const matchMedia = window.matchMedia.bind(window)
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)')
  Object.defineProperty(reducedMotion, 'matches', { value: true })
  vi.spyOn(window, 'matchMedia').mockImplementation((query) =>
    query === '(prefers-reduced-motion: reduce)' ? reducedMotion : matchMedia(query),
  )
}

function markDesktopPreload(status: 'ready' | 'error') {
  const link = document.createElement('link')
  link.href = wallpaperStillUrl(primaryServerOrigin())!
  link.dataset.workbenchWallpaperPreload = status
  document.head.append(link)
}

afterEach(() => {
  vi.restoreAllMocks()
  document.head
    .querySelectorAll('link[data-workbench-wallpaper-preload]')
    .forEach((link) => link.remove())
})

test('a remote environment starts with the bundled image, never the primary desktop', ({
  client,
}) => {
  const queryClient = new QueryClient()
  registerEnvironmentQueryClient(queryClient, 'http://localhost:39078', client)
  const rendered = renderWithProviders(<WebWallpaper />, { command: false, queryClient })
  const still = rendered.container.querySelector('[data-workbench-wallpaper-layer="still"]')

  expect(still).toHaveAttribute('src', WALLPAPER_URL)
  expect(rendered.container.querySelectorAll('img')).toHaveLength(1)
})

test('the bundled image stays visible while the desktop image is pending and after an error', () => {
  disableMotion()
  const rendered = renderWithProviders(<WebWallpaper />, { command: false })
  const fallback = rendered.container.querySelector('[data-workbench-wallpaper-layer="still"]')
  const desktop = rendered.container.querySelector(
    '[data-workbench-wallpaper-layer="pending-still"]',
  )!

  expect(fallback).toHaveAttribute('src', WALLPAPER_URL)
  expect(desktop).toHaveAttribute('src', wallpaperStillUrl(primaryServerOrigin()))
  expect(desktop).toHaveAttribute('decoding', 'sync')
  expect(desktop).toHaveClass('opacity-0')
  expect(rendered.container.querySelector('video')).toBeNull()
  fireEvent.error(desktop)
  expect(rendered.container.querySelectorAll('img')).toHaveLength(1)
  expect(rendered.container.querySelector('[data-workbench-wallpaper-layer="still"]')).toBe(
    fallback,
  )
})

test('a loaded desktop image replaces the fallback without remounting the decoded image', () => {
  disableMotion()
  const rendered = renderWithProviders(<WebWallpaper />, { command: false })
  const desktop = rendered.container.querySelector(
    '[data-workbench-wallpaper-layer="pending-still"]',
  )!

  fireEvent.load(desktop)
  expect(rendered.container.querySelectorAll('img')).toHaveLength(1)
  expect(rendered.container.querySelector('[data-workbench-wallpaper-layer="still"]')).toBe(desktop)
  expect(desktop).not.toHaveClass('opacity-0')
})

test('an already preloaded desktop is the only image on the first render', () => {
  disableMotion()
  markDesktopPreload('ready')
  const rendered = renderWithProviders(<WebWallpaper />, { command: false })

  expect(rendered.container.querySelectorAll('img')).toHaveLength(1)
  expect(
    rendered.container.querySelector('[data-workbench-wallpaper-layer="still"]'),
  ).toHaveAttribute('src', wallpaperStillUrl(primaryServerOrigin()))
})

test('a failed boot preload starts directly with the bundled image', () => {
  disableMotion()
  markDesktopPreload('error')
  const rendered = renderWithProviders(<WebWallpaper />, { command: false })

  expect(rendered.container.querySelectorAll('img')).toHaveLength(1)
  expect(
    rendered.container.querySelector('[data-workbench-wallpaper-layer="still"]'),
  ).toHaveAttribute('src', WALLPAPER_URL)
})
