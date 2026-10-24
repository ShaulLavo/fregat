import { createScriptError } from '../structured-errors'

export type CheckRun = {
  readonly exitCode: number
  readonly tests: number
  readonly passed: number
  readonly failed: number
}

export function validateChecksOnly(options: {
  readonly checksOnly?: boolean
  readonly baseline?: boolean
  readonly inspectOnly?: boolean
  readonly receipts?: string
  readonly evaluationReceipt?: string
  readonly evaluationLedger?: string
}) {
  if (!options.checksOnly) return
  if (
    options.baseline ||
    options.inspectOnly ||
    options.receipts ||
    options.evaluationReceipt ||
    options.evaluationLedger
  )
    throw createScriptError('Checks-only execution requires the candidate and executed checks.', {
      internal: { argument: 'checks-only' },
      fix: 'Omit baseline, inspection and promotion evidence options from checks-only runs.',
    })
}

export function checkRunExitCode(exitCode: number, run: Omit<CheckRun, 'exitCode'>): number {
  if (exitCode !== 0 || run.failed > 0 || run.tests < 1 || run.passed !== run.tests) return 1
  return 0
}

export function qualificationExitCode(input: {
  readonly checksOnly: boolean
  readonly mode: 'baseline' | 'candidate' | 'paired'
  readonly candidateAvailable: boolean
  readonly verdict: string
  readonly runs: readonly CheckRun[]
  readonly expectedRuns: number
}): number {
  const incomplete = input.runs.length < input.expectedRuns || input.runs.length === 0
  const failed = input.runs.some((run) => checkRunExitCode(run.exitCode, run) !== 0)
  if (incomplete || failed) return 1
  if (input.checksOnly) return input.candidateAvailable && input.mode !== 'baseline' ? 0 : 1
  if (input.mode === 'baseline') return 0
  return input.verdict === 'VERIFIED' ? 0 : 1
}
