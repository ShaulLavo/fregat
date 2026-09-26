import type { EnvironmentId } from '@workspace/contracts'
import { expect, test } from '../../../../test/fixtures'

import { reviewCommentLabel } from '@/lib/review-draft/utils/label'
import { reviewPrompt, withReviewComments } from '@/lib/review-draft/utils/prompt'
import type { ReviewComment } from '@/lib/review-draft/utils/types'

const comment = (body: string, start: number, end: number): ReviewComment => ({
  anchor: {
    kind: 'diff',
    newRange: { start, end },
    oldRange: null,
    path: 'src/app.ts',
  },
  author: 'user',
  body,
  createdAt: '2026-09-25T00:00:00.000Z',
  destination: { environmentId: 'environment-1' as EnvironmentId, rootPath: 'repo' },
  id: `comment-${start}`,
  quote: `About \`src/app.ts\`, new lines ${start}-${end}:`,
})

test('numbers each quoted excerpt with its comment, in front of the typed message', () => {
  const comments = [comment('Name this better', 3, 3), comment('This can throw', 10, 12)]

  expect(reviewPrompt(comments)).toBe(
    [
      'Review comments:',
      '',
      '1. About `src/app.ts`, new lines 3-3:',
      '',
      'Name this better',
      '',
      '2. About `src/app.ts`, new lines 10-12:',
      '',
      'This can throw',
    ].join('\n'),
  )
  expect(withReviewComments('Please fix these', comments)).toMatch(
    /This can throw\n\nPlease fix these$/,
  )
  expect(withReviewComments('Only text', [])).toBe('Only text')
  expect(reviewCommentLabel(comments[1]!.anchor)).toBe('app.ts:10–12')
})
