export type { PlatformBridge } from '../../../../desktop/src/shared/bridge'
import type { PlatformBridge } from '../../../../desktop/src/shared/bridge'

export function getPlatformBridge(): PlatformBridge | null {
  if (typeof window === 'undefined') return null

  return window.platformBridge ?? null
}

/** The retained native host reserves its own macOS controls when browser geometry is absent. */
export function hasNativeMacOverlay() {
  const bridge = getPlatformBridge()
  return bridge?.platform === 'darwin' && bridge.titlebar === 'overlay'
}
