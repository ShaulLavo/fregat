import { useSyncExternalStore } from 'react'
import { hasNativeMacOverlay } from '@/lib/platform/bridge'

function subscribe(notify: () => void) {
  window.addEventListener('platform-native-window-state', notify)
  return () => window.removeEventListener('platform-native-window-state', notify)
}

function snapshot(): boolean {
  return hasNativeMacOverlay() && !document.documentElement.hasAttribute('data-native-fullscreen')
}

export function useNativeMacOverlay(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false)
}
