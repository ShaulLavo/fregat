import { useSyncExternalStore } from 'react'

import { railOrderIntents, railOrderOverrides } from '@/features/chat-mode/state/rail-order-intents'

export function useRailOrderOverrides() {
  return useSyncExternalStore(railOrderIntents.subscribe, railOrderOverrides, railOrderOverrides)
}
