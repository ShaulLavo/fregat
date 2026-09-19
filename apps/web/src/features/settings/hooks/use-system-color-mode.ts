import { useSyncExternalStore } from 'react'
import {
  subscribeSystemColorMode,
  systemColorMode,
} from '@/features/settings/state/system-color-mode'

export function useSystemColorMode() {
  return useSyncExternalStore(subscribeSystemColorMode, systemColorMode)
}
