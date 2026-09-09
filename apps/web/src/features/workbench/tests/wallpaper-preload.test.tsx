import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, vi } from 'vitest'
import { DEFAULT_SETTING_VALUES } from '@workspace/contracts'
import { writeBootMirror } from '@/features/settings/utils/boot-mirror'

import { expect, test } from '../../../../test/fixtures'

afterEach(() => {
  vi.unstubAllGlobals()
  delete window.platformBridge
  localStorage.clear()
  for (const link of document.querySelectorAll('link[rel="preload"][as="image"]')) link.remove()
})

test('HTML discovers both wallpaper images before the application module loads', () => {
  vi.stubGlobal('navigator', { userAgentData: { platform: 'macOS' }, userAgent: '' })
  runBootScript()

  expect(preloadSources()).toEqual([
    'https://example.test/platform-api/wallpaper/still',
    '/platform/workbench/wallpaper.jpg',
  ])
  for (const link of document.querySelectorAll('link[rel="preload"][as="image"]')) {
    expect(link).toHaveAttribute('crossorigin', 'anonymous')
  }
})

test.each([
  { platform: 'macOS', enabled: false, backdrop: 'app' },
  { platform: 'Linux', enabled: true, backdrop: 'app' },
  { platform: 'macOS', enabled: true, backdrop: 'transparent' },
  { platform: 'macOS', enabled: true, backdrop: 'compositor' },
])(
  'preload respects $platform, enabled=$enabled, backdrop=$backdrop',
  ({ platform, enabled, backdrop }) => {
    vi.stubGlobal('navigator', { userAgentData: { platform }, userAgent: '' })
    Object.defineProperty(window, 'platformBridge', { configurable: true, value: { backdrop } })
    writeBootMirror({ ...DEFAULT_SETTING_VALUES, 'workbench.wallpaper.enabled': enabled })
    runBootScript()

    expect(preloadSources()).toEqual([])
  },
)

function runBootScript() {
  const html = readFileSync(join(import.meta.dirname, '../../../../index.html'), 'utf8')
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1]
  expect(script).toBeDefined()
  if (!script) return

  const configured = script
    .replaceAll('%BASE_URL%', '/platform/')
    .replaceAll('%VITE_SERVER_URL%', 'https://example.test/platform-api/?ignored=yes')
  new Function(configured)()
}

function preloadSources() {
  return Array.from(document.querySelectorAll('link[rel="preload"][as="image"]'), (link) =>
    link.getAttribute('href'),
  )
}
