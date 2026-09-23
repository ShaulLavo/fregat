import { afterEach, vi } from 'vitest'
import { DEFAULT_SETTING_VALUES } from '@workspace/contracts'
import { writeBootMirror } from '@/lib/settings-boot-mirror'

import { expect, test } from '../../../../test/fixtures'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  delete window.platformBridge
  delete window.platformBootWallpaper
  localStorage.clear()
  for (const link of document.querySelectorAll('link[rel="preload"][as="image"]')) link.remove()
})

test('HTML preloads the desktop wallpaper without fetching an unused fallback', async () => {
  vi.stubGlobal('navigator', { userAgentData: { platform: 'macOS' }, userAgent: '' })
  await runBootScript({ serverUrl: 'https://example.test/platform-api/?ignored=yes' })

  expect(preloadSources()).toEqual(['https://example.test/platform-api/wallpaper/still'])
  // The app reads the preload's outcome from this record, not from the link.
  expect(window.platformBootWallpaper).toEqual({
    href: 'https://example.test/platform-api/wallpaper/still',
    status: 'pending',
  })
  for (const link of document.querySelectorAll('link[rel="preload"][as="image"]')) {
    expect(link).toHaveAttribute('crossorigin', 'anonymous')
  }
})

test('a production page without an override preloads from its own base URL', async () => {
  vi.stubGlobal('navigator', { userAgentData: { platform: 'macOS' }, userAgent: '' })
  await runBootScript({ dev: false })

  expect(preloadSources()).toEqual([`${location.origin}/platform/wallpaper/still`])
})

test('a development page without an override preloads from the dev server port', async () => {
  vi.stubGlobal('navigator', { userAgentData: { platform: 'macOS' }, userAgent: '' })
  await runBootScript({ dev: true })

  expect(preloadSources()).toEqual(['http://localhost:3001/wallpaper/still'])
})

test.each([
  { platform: 'macOS', enabled: false, backdrop: 'app' },
  { platform: 'Linux', enabled: true, backdrop: 'app' },
  { platform: 'macOS', enabled: true, backdrop: 'transparent' },
  { platform: 'macOS', enabled: true, backdrop: 'compositor' },
])(
  'preload respects $platform, enabled=$enabled, backdrop=$backdrop',
  async ({ platform, enabled, backdrop }) => {
    vi.stubGlobal('navigator', { userAgentData: { platform }, userAgent: '' })
    Object.defineProperty(window, 'platformBridge', { configurable: true, value: { backdrop } })
    writeBootMirror({
      ...DEFAULT_SETTING_VALUES,
      'workbench.wallpaper': {
        enabled,
        source: { kind: 'desktop' },
      },
    })
    await runBootScript()

    expect(preloadSources()).toEqual([])
  },
)

// The same module the Vite plugin bundles into index.html, with the three values it defines.
async function runBootScript({
  serverUrl,
  dev = false,
}: { serverUrl?: string; dev?: boolean } = {}) {
  vi.stubEnv('DEV', dev)
  vi.stubEnv('BASE_URL', '/platform/')
  vi.stubEnv('VITE_SERVER_URL', serverUrl)
  vi.resetModules()
  await import('@/boot-appearance')
}

function preloadSources() {
  return Array.from(document.querySelectorAll('link[rel="preload"][as="image"]'), (link) =>
    link.getAttribute('href'),
  )
}
