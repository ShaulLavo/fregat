import { use } from 'react'

import { ChatPendingRequestsContext } from '@/features/chat/providers/pending-requests-context'
import { requireContext } from '@/lib/require-context'

export function usePendingRequests() {
  const pendingRequests = use(ChatPendingRequestsContext)
  requireContext(
    pendingRequests,
    'usePendingRequests must be used within ChatPendingRequestsProvider',
  )
  return pendingRequests
}
