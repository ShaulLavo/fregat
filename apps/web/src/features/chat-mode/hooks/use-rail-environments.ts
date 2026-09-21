import { useChatProjectionStore } from '@/features/chat/state/chat-projection-store'
import { createRailEnvironmentsSelector } from '@/features/chat-mode/state/rail-environments'
import { useEnvironmentsStore } from '@/lib/environments/state/store'
import { useMemo } from 'react'

export function useRailEnvironments() {
  const entries = useEnvironmentsStore((state) => state.entries)
  // Preserve the per-slice selector cache across token updates.
  // Manual memo: the store keys on the selector's identity, and the compiler's cache is a cache,
  // not an identity guarantee — a recompute hands the store a cold selector every render.
  const select = useMemo(() => createRailEnvironmentsSelector(entries), [entries])
  return useChatProjectionStore(select)
}
