import { useEffect, useState } from 'react'
import type { ChatTransport } from '@/features/chat/transport/chat-transport'
import {
  CONNECTING_STATE,
  subscribeChatShell,
  type ChatShellSubscriptionState,
} from '@/features/chat/state/shell-subscription'

export type { ChatShellSubscriptionState } from '@/features/chat/state/shell-subscription'

export function useChatShellSubscription(transport: ChatTransport): ChatShellSubscriptionState {
  const [state, setState] = useState<ChatShellSubscriptionState>(CONNECTING_STATE)
  useEffect(() => subscribeChatShell(transport, setState), [transport])
  return state
}
