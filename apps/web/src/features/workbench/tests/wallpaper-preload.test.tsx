import { afterEach, vi } from 'vitest'
import { initialAppearanceValues } from '@/lib/html-bootstrap'
import { expect, test } from '../../../../test/fixtures'
import {
  installHtmlBootstrap,
  installWallpaperPreload,
  removeHtmlBootstrap,
} from '../../../../test/factories/html-bootstrap'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  removeHtmlBootstrap()
  localStorage.clear()
})

test('the pre-paint script adopts document appearance and adds no wallpaper download', async () => {
  installHtmlBootstrap({ 'workbench.wallpaper': { enabled: true, source: { kind: 'desktop' } } })
  const link = installWallpaperPreload('http://localhost:3001/wallpaper/still')
  await runBootScript()
  expect(document.querySelectorAll('link[rel="preload"][as="image"]')).toHaveLength(1)
  expect(link.isConnected).toBe(true)
  expect(document.documentElement).not.toHaveAttribute('data-wallpaper-hidden')
})

test('an absent document bootstrap uses wallpaper off despite stale browser settings', async () => {
  localStorage.setItem(
    'platform.settings-boot-mirror.v1',
    JSON.stringify({ 'workbench.wallpaper': { enabled: true, source: { kind: 'desktop' } } }),
  )
  await runBootScript()
  expect(initialAppearanceValues()['workbench.wallpaper'].enabled).toBe(false)
  expect(document.querySelectorAll('link[rel="preload"][as="image"]')).toHaveLength(0)
  expect(document.documentElement).toHaveAttribute('data-wallpaper-hidden')
})

async function runBootScript() {
  vi.stubEnv('DEV', true)
  vi.stubEnv('BASE_URL', '/')
  vi.resetModules()
  await import('@/boot-appearance')
}
