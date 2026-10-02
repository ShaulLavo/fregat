import { getPlatformBridge } from '@/lib/platform/bridge'

const QUERY = '(prefers-color-scheme: dark)'
export function subscribeSystemColorMode(notify: () => void) {
  const query = window.matchMedia(QUERY)
  query.addEventListener('change', notify)
  return () => query.removeEventListener('change', notify)
}
export function systemColorMode(): 'light' | 'dark' {
  // WebKitGTK's native host can supply the OS preference when its media query is unavailable.
  return getPlatformBridge()?.colorScheme ?? (window.matchMedia(QUERY).matches ? 'dark' : 'light')
}
