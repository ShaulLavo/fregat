import type { AgentReviewRequest, AgentReviewResult, EnvironmentId } from '@workspace/contracts'

import { environmentClientFor } from '@/lib/client'
import { unwrapEdenResponse } from '@/lib/eden-events'
import { confirmedEnvironmentOrigin } from '@/lib/environments/state/domain'

export async function requestAgentReview(
  environmentId: EnvironmentId,
  request: AgentReviewRequest,
  signal?: AbortSignal,
) {
  const client = environmentClientFor(confirmedEnvironmentOrigin(environmentId))
  const response = await client['agent-review'].post(request, { fetch: { signal } })
  return unwrapEdenResponse<AgentReviewResult>(response, {
    emptyMessage: 'the review carried no data',
    requireData: true,
  })
}
