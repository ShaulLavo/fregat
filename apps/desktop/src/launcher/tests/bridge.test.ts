import { expect, test } from 'vitest'
import { hasNativeMacOverlay } from '../../../../web/src/lib/platform/bridge'

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
    expect(hasNativeMacOverlay()).toBe(false)
    window.platformBridge.titlebar = 'overlay'
    expect(hasNativeMacOverlay()).toBe(true)
    window.platformBridge.platform = 'linux'
    expect(hasNativeMacOverlay()).toBe(false)
  } finally {
    if (previous)
      Object.defineProperty(globalThis, 'window', { configurable: true, value: previous })
    else Reflect.deleteProperty(globalThis, 'window')
  }
})
