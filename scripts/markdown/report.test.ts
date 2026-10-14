import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'
import { parseTestCounts, qualificationMode, qualificationTestPlan } from './qualify'
import { inspectCandidate, promotionVerdict } from './report'

test('missing candidate and evaluation evidence cannot certify cutover from a passing baseline', () => {
  const report = promotionVerdict(
    [{ suite: 'completed', fixture: 'control', status: 'passed', findings: [] }],
    true,
  )
  expect(report.verdict).toBe('NOT VERIFIED')
  expect(report.reasons).toContain('Trusted candidate promotion receipts have not been supplied.')
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

test('actual native semantics and adapter probes report availability without certification', async () => {
  const root = path.resolve(import.meta.dirname, '../..')
  const candidate = await inspectCandidate(root)
  expect(candidate.status).toBe('available-unqualified')
  expect(candidate.profile).toBe('fregat-chat')
  expect(candidate.semanticChecks).toMatchObject({ executed: 8, passed: 8, failed: 0 })
  expect(candidate.observedCapabilities).toEqual({
    commonmark: true,
    gfm: true,
    math: true,
    footnotes: true,
    cjkFlanking: true,
  })
  for (const artifact of candidate.artifacts)
    expect(artifact.sha256).toBe(
      createHash('sha256')
        .update(await readFile(path.resolve(root, artifact.file)))
        .digest('hex'),
    )
  expect(candidate.missing).toContain('complete promotion receipts')
})

test('missing and invalid actual artifacts cannot be reported as available', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'markdown-inspection-'))
  try {
    const root = path.resolve(import.meta.dirname, '../..')
    const missing = await inspectCandidate(root, { grammar: path.join(directory, 'missing.wasm') })
    expect(missing.status).toBe('unavailable')
    await writeFile(path.join(directory, 'invalid.wasm'), 'invalid artifact')
    const invalid = await inspectCandidate(root, { resolver: path.join(directory, 'invalid.wasm') })
    expect(invalid.status).toBe('unavailable')
    expect(invalid.semanticChecks.executed).toBe(0)
    await writeFile(
      path.join(directory, 'empty.wasm'),
      new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]),
    )
    const empty = await inspectCandidate(root, { grammar: path.join(directory, 'empty.wasm') })
    expect(empty.status).toBe('unavailable')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('qualification modes select actual candidate configurations and preserve baseline comparisons', () => {
  expect(qualificationMode({})).toBe('paired')
  expect(qualificationMode({ baseline: true })).toBe('baseline')
  expect(qualificationMode({ candidate: true })).toBe('candidate')
  expect(() => qualificationMode({ baseline: true, candidate: true })).toThrow()
  const candidate = qualificationTestPlan('parity', 'candidate')
  expect(candidate).toHaveLength(1)
  expect(candidate[0].flags).toContain('qualification-candidate')
  const baseline = qualificationTestPlan('parity', 'baseline')
  expect(baseline[0].flags).toContain('**/qualification-candidate.test.ts')
  const visual = qualificationTestPlan('visual', 'candidate')
  expect(visual).toHaveLength(2)
  expect(visual.map((plan) => plan.flags)).toEqual(
    expect.arrayContaining([
      expect.arrayContaining(['--mode', 'candidate']),
      expect.arrayContaining(['--mode', 'baseline']),
    ]),
  )
})
