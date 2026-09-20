import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, vi } from 'vitest'
import { DEFAULT_SETTING_VALUES } from '@workspace/contracts'
import { writeBootMirror } from '@/lib/settings-boot-mirror'

import { expect, test } from '../../../../test/fixtures'

afterEach(() => {
  vi.unstubAllGlobals()
  delete window.platformBridge
  localStorage.clear()
  for (const link of document.querySelectorAll('link[rel="preload"][as="image"]')) link.remove()
})

test('HTML preloads the desktop wallpaper without fetching an unused fallback', () => {
  vi.stubGlobal('navigator', { userAgentData: { platform: 'macOS' }, userAgent: '' })
  runBootScript({ serverUrl: 'https://example.test/platform-api/?ignored=yes' })

  expect(preloadSources()).toEqual(['https://example.test/platform-api/wallpaper/still'])
  for (const link of document.querySelectorAll('link[rel="preload"][as="image"]')) {
    expect(link).toHaveAttribute('crossorigin', 'anonymous')
  }
})

test('a production page without an override preloads from its own base URL', () => {
  vi.stubGlobal('navigator', { userAgentData: { platform: 'macOS' }, userAgent: '' })
  runBootScript({ dev: false })

  expect(preloadSources()).toEqual([`${location.origin}/platform/wallpaper/still`])
})

test('a development page without an override preloads from the dev server port', () => {
  vi.stubGlobal('navigator', { userAgentData: { platform: 'macOS' }, userAgent: '' })
  runBootScript({ dev: true })

  expect(preloadSources()).toEqual(['http://localhost:3001/wallpaper/still'])
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
    writeBootMirror({
      ...DEFAULT_SETTING_VALUES,
      'workbench.wallpaper': {
        enabled,
        source: { kind: 'desktop' },
      },
    })
    runBootScript()

    expect(preloadSources()).toEqual([])
  },
)

// Vite leaves an unset %VITE_SERVER_URL% in place, which is the production case.
function runBootScript({ serverUrl, dev = false }: { serverUrl?: string; dev?: boolean } = {}) {
  const html = readFileSync(join(import.meta.dirname, '../../../../index.html'), 'utf8')
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1]
  expect(script).toBeDefined()
  if (!script) return

  const configured = script
    .replaceAll('%BASE_URL%', '/platform/')
    .replaceAll('%DEV%', String(dev))
    .replaceAll('%VITE_SERVER_URL%', serverUrl ?? '%VITE_SERVER_URL%')
  new Function(configured)()
}

function preloadSources() {
  return Array.from(document.querySelectorAll('link[rel="preload"][as="image"]'), (link) =>
    link.getAttribute('href'),
  )
}
