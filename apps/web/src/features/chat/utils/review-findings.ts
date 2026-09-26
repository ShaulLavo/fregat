import type { AgentReviewFinding, AgentReviewResult } from '@workspace/contracts'

import type { ComposerDestination } from '@/lib/composer-attach/providers/context'
import { markdownFence } from '@/lib/markdown-fence'
import type { ReviewComment } from '@/lib/review-draft/utils/types'

/**
 * A finding as a review-draft comment on the lines it cites, marked as the agent's. `lines` is
 * the file's text at those lines when the finding arrived, so the comment can tell later whether
 * they still read the same; null when the file could not be read.
 */
export function findingComment(
  finding: AgentReviewFinding,
  destination: ComposerDestination,
  lines: readonly string[] | null,
): Omit<ReviewComment, 'createdAt' | 'id'> {
  const range = { start: finding.startLine, end: finding.endLine }
  return {
    anchor: {
      kind: 'diff',
      path: finding.path,
      oldRange: null,
      newRange: range,
    },
    author: 'agent',
    body: finding.body ? `${finding.title}: ${finding.body}` : finding.title,
    destination,
    quote: findingQuote(finding, lines),
  }
}

/** The cited lines in the same diff-shaped excerpt a selected diff range quotes. */
function findingQuote(finding: AgentReviewFinding, lines: readonly string[] | null) {
  const heading = `About \`${finding.path}\`, new lines ${finding.startLine}-${finding.endLine}:`
  if (!lines) return heading
  const body = lines.map((line) => ` ${line}`)
  const fence = markdownFence(body)
  const span = `${finding.startLine},${lines.length}`
  return [heading, '', `${fence}diff`, `@@ -${span} +${span} @@`, ...body, fence].join('\n')
}

/** The toast after a review: how many findings joined the draft, or the reviewer's verdict. */
export function reviewSummary(result: AgentReviewResult) {
  const count = result.findings.length
  if (count === 0) return 'The review found nothing to fix'
  return count === 1 ? '1 finding added to your review' : `${count} findings added to your review`
}
