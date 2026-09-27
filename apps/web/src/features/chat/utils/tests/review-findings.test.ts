import type { AgentReviewResult, EnvironmentId, ProviderInstanceId } from '@workspace/contracts'
import {
  extractReviewComments,
  prependReviewComments,
} from '@workspace/client-core/chat/review-comments'

import { findingComment, reviewSummary } from '@/features/chat/utils/review-findings'
import { diffQuoteLines } from '@/features/chat/utils/review-source'
import { expect, test } from '../../../../../test/fixtures'

const finding = {
  title: 'Off by one',
  body: 'The loop skips the last item.',
  priority: 1,
  confidence: 0.8,
  path: 'work/repo/src/sum.ts',
  startLine: 2,
  endLine: 3,
}
const destination = { environmentId: 'environment-1' as EnvironmentId, rootPath: 'work/repo' }

test('a finding becomes an agent comment on the lines it cites, quoting them as they read', () => {
  const comment = findingComment(finding, destination, ['  let total = 0', '  for (const x of xs)'])
  expect(comment).toMatchObject({
    anchor: {
      kind: 'diff',
      path: 'work/repo/src/sum.ts',
      newRange: { start: 2, end: 3 },
      oldRange: null,
    },
    author: 'agent',
    body: 'Off by one: The loop skips the last item.',
    destination,
  })
  expect(comment.quote).toContain('About `work/repo/src/sum.ts`, new lines 2-3:')
  expect(diffQuoteLines(comment.quote, 'new')).toEqual(['  let total = 0', '  for (const x of xs)'])
  const sent = extractReviewComments(prependReviewComments('', [comment])).comments[0]
  expect(sent?.author).toBe('agent')
  expect(diffQuoteLines(sent?.quote ?? '', 'new')).toEqual([
    '  let total = 0',
    '  for (const x of xs)',
  ])
})

test('a finding on a file that could not be read quotes only its place', () => {
  expect(diffQuoteLines(findingComment(finding, destination, null).quote, 'new')).toBeNull()
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
