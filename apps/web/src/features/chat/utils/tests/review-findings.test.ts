import type { AgentReviewResult, EnvironmentId, ProviderInstanceId } from '@workspace/contracts'

import { findingComment, reviewSummary } from '@/features/chat/utils/review-findings'
import { reviewPrompt } from '@/lib/review-draft/utils/prompt'
import { expect, test } from '../../../../../test/fixtures'

const finding = {
  title: 'Off by one',
  body: 'The loop skips the last item.',
  priority: 1,
  confidence: 0.8,
  path: 'src/sum.ts',
  startLine: 2,
  endLine: 3,
}
const destination = { environmentId: 'environment-1' as EnvironmentId, rootPath: 'repo' }

test('a finding becomes an agent comment on the new lines it cites, and reads as a finding', () => {
  const comment = findingComment(finding, destination)
  expect(comment).toMatchObject({
    anchor: { kind: 'diff', path: 'src/sum.ts', newRange: { start: 2, end: 3 }, oldRange: null },
    author: 'agent',
    destination,
  })
  const prompt = reviewPrompt([{ ...comment, createdAt: '', id: 'c1' }])
  expect(prompt).toContain('1. About `src/sum.ts`, new lines 2-3:')
  expect(prompt).toContain('Reviewer finding: Off by one: The loop skips the last item.')
})

test('the summary counts findings and says when there are none', () => {
  const result: AgentReviewResult = {
    findings: [finding],
    unplacedCount: 0,
    verdict: 'patch is incorrect',
    explanation: '',
    reviewer: { providerInstanceId: 'codex' as ProviderInstanceId, model: 'gpt-5.5' },
  }
  expect(reviewSummary(result)).toBe('1 finding added to your review')
  expect(reviewSummary({ ...result, findings: [] })).toBe('The review found nothing to fix')
})
