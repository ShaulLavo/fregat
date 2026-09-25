import type { ChatRailOrder } from '@/features/chat-mode/providers/rail-order-context'
import {
  reorderRailProject,
  reorderRailSession,
} from '@/features/chat-mode/state/rail-order-commands'

/**
 * The rail's two drop handlers, bound to the chat transport that dispatches
 * for them. Everything else about a reorder — the order key, the optimistic
 * write, the fallback when the server refuses — lives in the commands module,
 * which reads the same stores the rail renders from.
 */
export function useRailOrderActions(): ChatRailOrder {
  return {
    reorderProject: (activeId, overId) => reorderRailProject({ activeId, overId }),
    reorderSession: (activeId, overId) => reorderRailSession({ activeId, overId }),
  }
}
