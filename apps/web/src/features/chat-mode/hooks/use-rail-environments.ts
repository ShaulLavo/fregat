import { useChatProjectionStore } from '@/features/chat/state/chat-projection-store'
import { createRailEnvironmentsSelector } from '@/features/chat-mode/state/rail-environments'
import { useEnvironmentsStore } from '@/lib/environments/state/store'
import {} from 'react'

export function useRailEnvironments() {
  const entries = useEnvironmentsStore((state) => state.entries)
  // Preserve the per-slice selector cache across token updates.
  const select = createRailEnvironmentsSelector(entries)
  return useChatProjectionStore(select)
}
