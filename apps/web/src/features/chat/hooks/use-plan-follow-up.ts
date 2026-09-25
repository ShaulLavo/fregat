import { use } from 'react'

import { ChatPlanFollowUpContext } from '@/features/chat/providers/plan-follow-up-context'
import { requireContext } from '@/lib/require-context'

export function usePlanFollowUp() {
  const followUp = use(ChatPlanFollowUpContext)
  requireContext(followUp, 'usePlanFollowUp must be used within ChatPlanFollowUpProvider')
  return followUp
}
