import type { AgentReviewFinding, AgentReviewResult } from '@workspace/contracts'

import type { ComposerDestination } from '@/lib/composer-attach/providers/context'
import type { ReviewComment } from '@/lib/review-draft/utils/types'

/** A finding as a review-draft comment on the lines it cites, marked as the agent's. */
export function findingComment(
  finding: AgentReviewFinding,
  destination: ComposerDestination,
): Omit<ReviewComment, 'createdAt' | 'id'> {
  return {
    anchor: {
      kind: 'diff',
      path: finding.path,
      oldRange: null,
      newRange: { start: finding.startLine, end: finding.endLine },
    },
    author: 'agent',
    body: finding.body ? `${finding.title}: ${finding.body}` : finding.title,
    destination,
    quote: `About \`${finding.path}\`, new lines ${finding.startLine}-${finding.endLine}:`,
  }
}

/** The toast after a review: how many findings joined the draft, or the reviewer's verdict. */
export function reviewSummary(result: AgentReviewResult) {
  const count = result.findings.length
  if (count === 0) return 'The review found nothing to fix'
  return count === 1
    ? '1 finding added to your review'
    : `${count} findings added to your review`
}
