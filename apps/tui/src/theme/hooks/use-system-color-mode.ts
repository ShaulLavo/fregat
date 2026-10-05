import { useRenderer } from '@opentui/react'
import { useSyncExternalStore } from 'react'
import { systemColorModeSource } from '@/theme/state/system-color-mode'

export function useSystemColorMode() {
  const source = systemColorModeSource(useRenderer())
  return useSyncExternalStore(source.subscribe, source.getSnapshot)
}
