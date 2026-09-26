import type { EnvironmentId, ModelSelection, WorktreeId } from '@workspace/contracts'
import { environmentClientFor } from '@/lib/client'
import { confirmedEnvironmentOrigin } from '@/lib/environments/state/domain'
import { unwrapEdenResponse } from '@/lib/eden-events'

export async function startPullRequestSession(input: {
  environmentId: EnvironmentId
  worktreeId: WorktreeId
  reference: string
  modelSelection: ModelSelection
}) {
  const client = environmentClientFor(confirmedEnvironmentOrigin(input.environmentId))
  const response = await client.orchestration['pull-request-session'].post({
    worktreeId: input.worktreeId,
    reference: input.reference,
    modelSelection: input.modelSelection,
  })
  return unwrapEdenResponse(response, {
    requireData: true,
    emptyMessage: 'The server did not say which session it started.',
  })
}
