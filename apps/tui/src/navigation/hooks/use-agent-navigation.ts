import { use } from 'react'
import { AgentNavigationContext } from '@/navigation/providers/agent-context'
import { createTuiError } from '@/host/utils/structured-errors'

export function useAgentNavigation() {
  const navigation = use(AgentNavigationContext)
  if (!navigation)
    throw createTuiError(
      'Agent navigation is unavailable.',
      'Open the agent screen inside Platform.',
    )
  return navigation
}
