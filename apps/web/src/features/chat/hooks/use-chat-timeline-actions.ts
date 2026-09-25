import { use } from 'react'

import { ChatTimelineActionsContext } from '@/features/chat/providers/timeline-actions-context'
import { requireContext } from '@/lib/require-context'

export function useChatTimelineActions() {
  const actions = use(ChatTimelineActionsContext)
  requireContext(actions, 'useChatTimelineActions must be used within ChatTimelineActionsContext')
  return actions
}
