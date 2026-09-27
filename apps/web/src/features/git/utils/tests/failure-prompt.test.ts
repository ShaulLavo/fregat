import { gitFailureLabel, gitFailurePrompt } from '@/features/git/utils/failure-prompt'
import { expect, test } from '../../../../../test/fixtures'

const ESCAPE = String.fromCharCode(27)

test('labels an operation from its mutation key segment', () => {
  expect(gitFailureLabel('push')).toBe('Push')
  expect(gitFailureLabel('stage-many')).toBe('Stage')
})

test('a commit failure carries the hook output without its escapes', () => {
  const prompt = gitFailurePrompt(
    { message: 'git commit exited with code 1', operation: 'commit' },
    'work/projects/platform',
    [`${ESCAPE}[1mformat check${ESCAPE}[m`, '', 'apps/web/a.tsx (10ms)'],
  )

  expect(prompt).toBe(
    [
      'Fix the Git commit failure in work/projects/platform.',
      '',
      'Error: git commit exited with code 1',
      '',
      'Output:',
      '```',
      'format check',
      'apps/web/a.tsx (10ms)',
      '```',
    ].join('\n'),
  )
})

test('a failure with no output is only the step and the error', () => {
  const prompt = gitFailurePrompt(
    { message: 'rejected: non-fast-forward', operation: 'push' },
    '',
    [],
  )

  expect(prompt).not.toContain('Output:')
  expect(prompt).toContain('Fix the Git push failure in this repository.')
})
