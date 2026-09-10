export type { PlatformBridge } from '../../../../desktop/src/shared/bridge'
import type { PlatformBridge } from '../../../../desktop/src/shared/bridge'

export function getPlatformBridge(): PlatformBridge | null {
  if (typeof window === 'undefined') return null

  return window.platformBridge ?? null
}

export function isDesktop() {
  return getPlatformBridge() !== null
}
