import { useSyncExternalStore } from 'react'
import { flushSync } from 'react-dom'
import { hasNativeMacOverlay } from '@/lib/platform/bridge'

function subscribe(notify: () => void) {
  // AppKit starts moving the traffic lights with this signal, before React's next task.
  const onWindowState = () => flushSync(notify)
  window.addEventListener('platform-native-window-state', onWindowState)
  return () => window.removeEventListener('platform-native-window-state', onWindowState)
}

function snapshot(): boolean {
  return hasNativeMacOverlay() && !document.documentElement.hasAttribute('data-native-fullscreen')
}

export function useNativeMacOverlay(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => false)
}
