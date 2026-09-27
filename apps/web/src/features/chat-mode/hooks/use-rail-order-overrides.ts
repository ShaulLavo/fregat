import { useStore } from 'zustand'

import { railOrderIntents, railOrderOverrides } from '@/features/chat-mode/state/rail-order-intents'

export function useRailOrderOverrides() {
  return useStore(railOrderIntents, railOrderOverrides)
}
