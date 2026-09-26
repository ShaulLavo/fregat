import { describe, expect, it } from 'vitest'
import { deviceLabel, pushSupport, type PushEnvironment } from '../push-support'

const WORKER = 'https://omarchy.example.test/platform/sw.js'
const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1'
const IPAD_AS_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15'
const LINUX_CHROME =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
const ANDROID_FIREFOX = 'Mozilla/5.0 (Android 15; Mobile; rv:143.0) Gecko/143.0 Firefox/143.0'
const WINDOWS_EDGE =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0'

function environment(overrides: Partial<PushEnvironment> = {}): PushEnvironment {
  return {
    secure: true,
    serviceWorker: true,
    pushManager: true,
    notification: true,
    userAgent: LINUX_CHROME,
    maxTouchPoints: 0,
    standalone: false,
    controllerScript: null,
    workerScript: WORKER,
    ...overrides,
  }
}

describe('push support', () => {
  it('needs the Home Screen on iPhone and iPad before anything else', () => {
    expect(pushSupport(environment({ userAgent: IPHONE, pushManager: false }))).toBe(
      'needs-install',
    )
    expect(pushSupport(environment({ userAgent: IPAD_AS_MAC, maxTouchPoints: 5 }))).toBe(
      'needs-install',
    )
    expect(pushSupport(environment({ userAgent: IPHONE, standalone: true }))).toBe('supported')
    expect(pushSupport(environment({ userAgent: IPAD_AS_MAC }))).toBe('supported')
  })

  it('leaves a scope another worker controls alone, and accepts its own worker', () => {
    const demo = 'https://omarchy.example.test/platform/mockServiceWorker.js'
    expect(pushSupport(environment({ controllerScript: demo }))).toBe('scope-taken')
    expect(pushSupport(environment({ controllerScript: WORKER }))).toBe('supported')
    expect(pushSupport(environment({ controllerScript: `${WORKER}?label=Chrome` }))).toBe(
      'supported',
    )
  })

  it('needs a secure context, service workers, the Push API and notifications', () => {
    expect(pushSupport(environment({ secure: false }))).toBe('unsupported')
    expect(pushSupport(environment({ serviceWorker: false }))).toBe('unsupported')
    expect(pushSupport(environment({ pushManager: false }))).toBe('unsupported')
    expect(pushSupport(environment({ notification: false }))).toBe('unsupported')
  })

  it('names the browser and platform for the device list', () => {
    expect(deviceLabel({ userAgent: LINUX_CHROME, maxTouchPoints: 0 })).toBe('Chrome on Linux')
    expect(deviceLabel({ userAgent: IPHONE, maxTouchPoints: 5 })).toBe('Safari on iPhone')
    expect(deviceLabel({ userAgent: IPAD_AS_MAC, maxTouchPoints: 5 })).toBe('Safari on iPad')
    expect(deviceLabel({ userAgent: IPAD_AS_MAC, maxTouchPoints: 0 })).toBe('Safari on macOS')
    expect(deviceLabel({ userAgent: ANDROID_FIREFOX, maxTouchPoints: 5 })).toBe(
      'Firefox on Android',
    )
    expect(deviceLabel({ userAgent: WINDOWS_EDGE, maxTouchPoints: 0 })).toBe('Edge on Windows')
  })
})
