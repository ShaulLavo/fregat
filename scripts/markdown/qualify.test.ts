import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PROMOTION_GATES } from './promotion'
import { expect, test } from 'vitest'
import {
  type CheckRun,
  checkRunExitCode,
  qualificationExitCode,
  validateChecksOnly,
} from './check-exit'
import {
  seededEdits,
  runSeededFuzz,
  qualificationTestPlan,
  parseTestCounts,
  readTestResult,
} from './qualify'

const passed: CheckRun = { exitCode: 0, tests: 2, passed: 2, failed: 0 }
const executed = {
  checksOnly: true,
  mode: 'paired',
  candidateAvailable: true,
  verdict: 'NOT VERIFIED',
  runs: [passed],
  expectedRuns: 1,
} as const

test('checks-only success leaves promotion unqualified and the default exit nonzero', () => {
  expect(qualificationExitCode(executed)).toBe(0)
  expect(qualificationExitCode({ ...executed, checksOnly: false })).toBe(1)
  expect(qualificationExitCode({ ...executed, checksOnly: false, verdict: 'INCONCLUSIVE' })).toBe(1)
  expect(executed.verdict).toBe('NOT VERIFIED')
  expect(PROMOTION_GATES).toHaveLength(14)
})

test('absent candidate, failing suite, missing report, empty run and missing planned suite fail checks', () => {
  expect(qualificationExitCode({ ...executed, candidateAvailable: false })).toBe(1)
  expect(qualificationExitCode({ ...executed, mode: 'baseline' })).toBe(1)
  expect(qualificationExitCode({ ...executed, runs: [{ ...passed, exitCode: 1 }] })).toBe(1)
  expect(qualificationExitCode({ ...executed, runs: [{ ...passed, failed: 1 }] })).toBe(1)
  expect(qualificationExitCode({ ...executed, runs: [{ ...passed, tests: 0, passed: 0 }] })).toBe(1)
  expect(qualificationExitCode({ ...executed, runs: [] })).toBe(1)
  expect(qualificationExitCode({ ...executed, expectedRuns: 2 })).toBe(1)
  expect(checkRunExitCode(0, { tests: 10, passed: 0, failed: 0 })).toBe(1)
})

test.each([
  { baseline: true },
  { inspectOnly: true },
  { receipts: 'receipts.json' },
  { evaluationReceipt: 'evaluation.json' },
  { evaluationLedger: 'ledger' },
])('checks-only refuses certification or non-execution arguments %j', (argument) => {
  expect(() => validateChecksOnly({ checksOnly: true, ...argument })).toThrow()
})

test('nightly plans pair actual engines, include seeded package streaming, and choose WebKit explicitly', () => {
  const stream = qualificationTestPlan('stream', 'paired')
  expect(stream).toHaveLength(4)
  const parity = qualificationTestPlan('parity', 'paired')
  expect(parity).toHaveLength(4)
  expect(parity[1].flags).toEqual(
    expect.arrayContaining([
      'qualification-semantics',
      'qualification-state',
      'qualification-layout',
      'qualification-production',
    ]),
  )
  expect(stream[0].flags).toContain('qualification-stream')
  expect(stream[2].flags).toContain('qualification-candidate')
  expect(qualificationTestPlan('visual', 'paired', 'webkit').map((entry) => entry.flags)).toEqual([
    expect.arrayContaining(['--mode', 'baseline-webkit']),
    expect.arrayContaining(['--mode', 'candidate-webkit']),
  ])
})

test('seeded fuzz edits replay exactly, retain undo and delimiters, and bound source growth', () => {
  const edits = seededEdits(176, 64)
  expect(edits).toEqual(seededEdits(176, 64))
  expect(edits).toHaveLength(65)
  expect(edits.some((entry) => entry.operation === 'undo')).toBe(true)
  expect(edits.some((entry) => entry.operation.startsWith('delete'))).toBe(true)
  expect(edits.some((entry) => entry.operation.startsWith('insert'))).toBe(true)
  expect(edits.every((entry) => entry.source.length < 4200)).toBe(true)
})

test('fuzz checks execute both engines and retain first failing operation-prefix replays', async () => {
  const report = await runSeededFuzz(true, 2, 8)
  expect(report.cases).toHaveLength(4)
  expect(report.verdict).toBe('NOT VERIFIED')
  for (const entry of report.cases) {
    expect(entry.declaredRevisions).toBe(9)
    expect(entry.executedRevisions + entry.unexecutedRevisions).toBe(entry.declaredRevisions)
    if (!entry.failure) continue
    expect(entry.replay).toHaveLength(entry.failure.revision + 1)
    expect(entry.failure.expected).not.toBe(entry.failure.observed)
  }
})

function bailedReport() {
  const assertionResults = Array.from({ length: 63 }, () => ({ status: 'passed' })).concat(
    [{ status: 'failed' }],
    Array.from({ length: 53 }, () => ({ status: 'pending' })),
  )
  return {
    numTotalTests: 117,
    numPassedTests: 63,
    numFailedTests: 1,
    numPendingTests: 0,
    numTodoTests: 0,
    testResults: [{ assertionResults }],
  }
}

test('bail preserves 117 declared, 63 passed, 1 failed and 53 pending assertion rows', () => {
  const raw = bailedReport()
  expect(parseTestCounts(raw)).toMatchObject({
    numTotalTests: 117,
    numPassedTests: 63,
    numFailedTests: 1,
    numPendingTests: 53,
  })
  expect(raw.numPendingTests).toBe(0)
  expect(parseTestCounts({ ...raw, testResults: [] }).numPendingTests).toBe(53)
  expect(() => parseTestCounts({ ...raw, numTotalTests: 1 })).toThrow()
  expect(() =>
    parseTestCounts({ ...raw, testResults: [{ assertionResults: [{ status: 'unknown' }] }] }),
  ).toThrow()
})

test('even exit-zero partial execution with no failures cannot pass checks-only', () => {
  const counts = parseTestCounts({
    numTotalTests: 117,
    numPassedTests: 63,
    numFailedTests: 0,
    numPendingTests: 0,
    numTodoTests: 0,
  })
  expect(counts.numPendingTests).toBe(54)
  const run = {
    exitCode: 0,
    tests: counts.numTotalTests,
    passed: counts.numPassedTests,
    failed: counts.numFailedTests,
  }
  expect(qualificationExitCode({ ...executed, runs: [run] })).toBe(1)
})

test('report readback preserves raw bail JSON and missing reports fail with zero execution', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'markdown-report-'))
  try {
    const file = path.join(directory, 'bail.json')
    const raw = JSON.stringify(bailedReport())
    await writeFile(file, raw)
    expect((await readTestResult(file)).numPendingTests).toBe(53)
    expect(await readFile(file, 'utf8')).toBe(raw)
    const absent = await readTestResult(path.join(directory, 'missing.json'))
    expect(
      checkRunExitCode(0, {
        tests: absent.numTotalTests,
        passed: absent.numPassedTests,
        failed: absent.numFailedTests,
      }),
    ).toBe(1)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
