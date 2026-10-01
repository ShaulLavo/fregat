import { expect, test } from 'vitest'
import { chromiumBridge } from '../chromium'
import { isMacDesktop } from '../../../../web/src/lib/platform/bridge'

function documentFixture(origin: string) {
  const global: Record<string, unknown> = {}
  const window = { top: undefined as unknown }
  window.top = window
  const timers: (() => void)[] = []
  const loads: (() => void)[] = []
  const evaluate = new Function(
    'globalThis',
    'window',
    'location',
    'document',
    'addEventListener',
    'setTimeout',
    'requestAnimationFrame',
    chromiumBridge('http://localhost:123/'),
  )
  evaluate(
    global,
    window,
    { origin },
    { readyState: 'complete' },
    (_: string, callback: () => void) => loads.push(callback),
    (callback: () => void) => timers.push(callback),
    () => {},
  )
  return { global, timers }
}

test('bridge executes in current document only on app origin and never exposes native picker', () => {
  expect(documentFixture('http://localhost:123').global.platformBridge).toEqual({
    backdrop: 'compositor',
    platform: 'linux',
    colorScheme: null,
    titlebar: 'native',
  })
  expect(documentFixture('http://external.test').global).toEqual({})
})
test('Mac desktop layout reserves traffic lights only for an overlay titlebar', () => {
  const previous = globalThis.window
  const window = {} as Window & typeof globalThis
  Object.defineProperty(globalThis, 'window', { configurable: true, value: window })
  try {
    window.platformBridge = {
      backdrop: 'app',
      platform: 'darwin',
      colorScheme: null,
      titlebar: 'native',
    }
    expect(isMacDesktop()).toBe(false)
    window.platformBridge.titlebar = 'overlay'
    expect(isMacDesktop()).toBe(true)
    window.platformBridge.platform = 'linux'
    expect(isMacDesktop()).toBe(false)
  } finally {
    if (previous)
      Object.defineProperty(globalThis, 'window', { configurable: true, value: previous })
    else Reflect.deleteProperty(globalThis, 'window')
  }
})
