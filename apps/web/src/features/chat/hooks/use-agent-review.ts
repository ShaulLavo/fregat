import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import type { AgentReviewFinding, AgentReviewRequest, EnvironmentId } from '@workspace/contracts'
import { toast } from 'sonner'

import { requestAgentReview } from '@/features/chat/transport/agent-review'
import { chatMutationKeys } from '@/features/chat/utils/mutation-keys'
import { findingComment, reviewSummary } from '@/features/chat/utils/review-findings'
import { filesystemPath } from '@/lib/documents/utils/identity'
import { errorMessage } from '@/lib/error-message'
import { fileSnapshotQueryOptions } from '@/lib/file-snapshot-query-cache'
import { addReviewComment } from '@/lib/review-draft/state/store'
import { toastError } from '@/lib/toast-error'

/** Asks an agent to review; its findings join the review draft of this checkout's composer. */
export function useAgentReview(environmentId: EnvironmentId, rootPath: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: chatMutationKeys.agentReview(environmentId, rootPath),
    mutationFn: async (request: Omit<AgentReviewRequest, 'rootPath'>) => {
      const result = await requestAgentReview(environmentId, { ...request, rootPath })
      const lines = await Promise.all(
        result.findings.map((finding) => citedLines(queryClient, finding)),
      )
      return { lines, result }
    },
    onSuccess: ({ lines, result }) => {
      result.findings.forEach((finding, index) =>
        addReviewComment(
          findingComment(finding, { environmentId, rootPath }, lines[index] ?? null),
        ),
      )
      toast(reviewSummary(result), { description: result.explanation || undefined })
    },
    onError: (error) =>
      toastError('The review did not finish', {
        description: errorMessage(error, 'No findings were added.'),
      }),
  })
}

/** The cited lines as the file reads now, which is what the comment later checks against. */
async function citedLines(queryClient: QueryClient, finding: AgentReviewFinding) {
  const path = filesystemPath(finding.path)
  const file = await queryClient
    .query({ ...fileSnapshotQueryOptions(path), staleTime: 0 })
    .catch(() => null)
  if (!file) return null
  const lines = file.content.split(/\r?\n/).slice(finding.startLine - 1, finding.endLine)
  return lines.length === finding.endLine - finding.startLine + 1 ? lines : null
}
