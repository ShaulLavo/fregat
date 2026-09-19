import { useRenderer } from '@opentui/react'
import { useSyncExternalStore } from 'react'

export function useSystemColorMode() {
  const renderer = useRenderer()
  return useSyncExternalStore(
    (notify) => {
      renderer.on('theme_mode', notify)
      return () => {
        renderer.off('theme_mode', notify)
      }
    },
    () => renderer.themeMode ?? 'dark',
  )
}
