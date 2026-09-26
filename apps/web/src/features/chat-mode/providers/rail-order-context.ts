import { createContext, use } from 'react'

import { requireContext } from '@/lib/require-context'

/**
 * Dropping a row is an app-level command — it mints an order key and dispatches
 * — so the rail's rows reach it through here instead of being handed a callback
 * down through the bands they live in.
 *
 * The ids are the raw drag ids: dnd-kit reports what was dragged and what it was
 * released over, and resolving those against the list is the action's own job.
 */
export type ChatRailOrder = {
  readonly reorderProject: (activeId: string, overId: string | null) => void
  readonly reorderSession: (activeId: string, overId: string | null) => void
}

export const ChatRailOrderContext = createContext<ChatRailOrder | null>(null)

export function useChatRailOrder() {
  const railOrder = use(ChatRailOrderContext)
  requireContext(railOrder, 'useChatRailOrder must be used within ChatRailOrderProvider')
  return railOrder
}
