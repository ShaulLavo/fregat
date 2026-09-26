import { useMutation } from '@tanstack/react-query'
import type { AgentReviewRequest, EnvironmentId } from '@workspace/contracts'
import { toast } from 'sonner'

import { requestAgentReview } from '@/features/chat/transport/agent-review'
import { chatMutationKeys } from '@/features/chat/utils/mutation-keys'
import { findingComment, reviewSummary } from '@/features/chat/utils/review-findings'
import { errorMessage } from '@/lib/error-message'
import { addReviewComment } from '@/lib/review-draft/state/store'
import { toastError } from '@/lib/toast-error'

/** Asks an agent to review; its findings join the review draft of this checkout's composer. */
export function useAgentReview(environmentId: EnvironmentId, rootPath: string) {
  return useMutation({
    mutationKey: chatMutationKeys.agentReview(environmentId, rootPath),
    mutationFn: (request: Omit<AgentReviewRequest, 'rootPath'>) =>
      requestAgentReview(environmentId, { ...request, rootPath }),
    onSuccess: (result) => {
      for (const finding of result.findings)
        addReviewComment(findingComment(finding, { environmentId, rootPath }))
      toast(reviewSummary(result), { description: result.explanation || undefined })
    },
    onError: (error) =>
      toastError('The review did not finish', {
        description: errorMessage(error, 'No findings were added.'),
      }),
  })
}
