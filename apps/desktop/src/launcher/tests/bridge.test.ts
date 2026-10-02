import { expect, test } from 'vitest'
import { isMacDesktop } from '../../../../web/src/lib/platform/bridge'

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
