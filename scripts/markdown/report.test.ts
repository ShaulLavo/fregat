import { expect, test } from 'vitest'
import { parseTestCounts } from './qualify'
import { promotionVerdict } from './report'

test('missing candidate and evaluation evidence cannot certify cutover from a passing baseline', () => {
  const report = promotionVerdict(
    [{ suite: 'completed', fixture: 'control', status: 'passed', findings: [] }],
    true,
  )
  expect(report.verdict).toBe('NOT VERIFIED')
  expect(report.reasons).toContain(
    'Candidate renderer semantics and paired measurements are unavailable.',
  )
  expect(report.reasons).toContain(
    'Independent held-out evaluation has not been frozen or executed.',
  )
})

test('an unmet baseline expectation stays failed in the readiness report', () => {
  const report = promotionVerdict(
    [{ suite: 'streaming', fixture: 'control', status: 'failed', findings: ['missing strong'] }],
    false,
  )
  expect(report.counts.failed).toBe(1)
  expect(report.verdict).toBe('NOT VERIFIED')
})

test('malformed and missing test counters fail rather than inventing executed coverage', () => {
  expect(
    parseTestCounts({
      numTotalTests: 2,
      numPassedTests: 1,
      numFailedTests: 1,
      numPendingTests: 0,
      numTodoTests: 0,
    }),
  ).toEqual({
    numTotalTests: 2,
    numPassedTests: 1,
    numFailedTests: 1,
    numPendingTests: 0,
    numTodoTests: 0,
  })
  expect(() => parseTestCounts({})).toThrow()
  expect(() =>
    parseTestCounts({
      numTotalTests: -1,
      numPassedTests: 0,
      numFailedTests: 0,
      numPendingTests: 0,
      numTodoTests: 0,
    }),
  ).toThrow()
  expect(() =>
    parseTestCounts({
      numTotalTests: 1,
      numPassedTests: '1',
      numFailedTests: 0,
      numPendingTests: 0,
      numTodoTests: 0,
    }),
  ).toThrow()
  expect(() =>
    parseTestCounts({
      numTotalTests: 1,
      numPassedTests: 1,
      numFailedTests: 1,
      numPendingTests: 0,
      numTodoTests: 0,
    }),
  ).toThrow()
  expect(
    parseTestCounts({
      numTotalTests: 10,
      numPassedTests: 0,
      numFailedTests: 0,
      numPendingTests: 9,
      numTodoTests: 1,
    }),
  ).toEqual({
    numTotalTests: 10,
    numPassedTests: 0,
    numFailedTests: 0,
    numPendingTests: 9,
    numTodoTests: 1,
  })
})
