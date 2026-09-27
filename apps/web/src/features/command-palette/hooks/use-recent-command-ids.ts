import { useStore } from 'zustand'

import { recentCommandsStore } from '@/features/command-palette/state/recent-commands-store'

export function useRecentCommandIds() {
  return useStore(recentCommandsStore)
}
