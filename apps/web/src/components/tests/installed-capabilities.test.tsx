import { afterEach } from 'vitest'
import { expect, test } from '../../../test/fixtures'
import {
  browserPlatform,
  displayCaptureSupported,
  displayMode,
  runtimeCapabilities,
} from '@/lib/platform/capabilities'
import { systemColorMode } from '@/features/settings/state/system-color-mode'
import { launchAddress } from '@/components/utils/launch-address'

const originalMatchMedia = window.matchMedia

afterEach(() => {
  window.matchMedia = originalMatchMedia
  delete window.platformBridge
})

test('installed display mode is desktop without an injected bridge', () => {
  window.matchMedia = ((query: string) => ({
    matches: query === '(display-mode: standalone)',
  })) as typeof window.matchMedia
  expect(displayMode()).toBe('standalone')
  expect(runtimeCapabilities().installed).toBe(true)
  expect(runtimeCapabilities().nativeTransparency).toBe(false)
})

test('bridge-free system appearance and capture follow browser signals', () => {
  window.matchMedia = ((query: string) => ({
    matches: query === '(prefers-color-scheme: dark)',
  })) as typeof window.matchMedia
  expect(systemColorMode()).toBe('dark')
  expect(displayCaptureSupported(undefined)).toBe(false)
  expect(
    displayCaptureSupported({ getDisplayMedia: async () => new MediaStream() } as MediaDevices),
  ).toBe(true)
})

test('viewing platform uses client hints independently of server and shell', () => {
  expect(browserPlatform({ userAgentData: { platform: 'macOS' }, userAgent: 'Linux' })).toBe(
    'darwin',
  )
  expect(browserPlatform({ userAgent: 'Mozilla/5.0 (Linux; Android 15)' })).toBe('other')
  expect(browserPlatform({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' })).toBe('linux')
})

test('launch URLs stay within the installed application and preserve focus-only launches', () => {
  const base = 'https://example.test/platform/'
  expect(launchAddress('https://example.test/platform/', base)).toBeNull()
  expect(launchAddress('https://example.test/platform/?workspace=repo', base)).toBe(
    '/platform/?workspace=repo',
  )
  expect(launchAddress('https://elsewhere.test/platform/?workspace=repo', base)).toBeNull()
  expect(launchAddress('https://example.test/platform-other/?workspace=repo', base)).toBeNull()
  expect(launchAddress('javascript:alert(1)', base)).toBeNull()
  expect(launchAddress('https://user:pass@example.test/platform/?workspace=repo', base)).toBeNull()
})
