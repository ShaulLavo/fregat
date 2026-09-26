// Folds the Vitest JSON reports of repeated runs into per-test failure counts for the nightly
// flake watch. Usage: bun scripts/flake-summary.ts <title> <report.json>...
import { appendFileSync, existsSync, readFileSync } from 'node:fs'

type AssertionResult = {
  readonly fullName?: string
  readonly title?: string
  readonly status: string
}

type FileResult = {
  readonly name: string
  readonly status: string
  readonly message?: string
  readonly assertionResults?: readonly AssertionResult[]
}

type VitestReport = {
  readonly testResults?: readonly FileResult[]
}

type FlakeRow = {
  readonly test: string
  readonly failures: number
}

/** Failures per test across the reports; a missing report counts as a run that failed whole. */
function flakeRows(reports: readonly (VitestReport | null)[], root: string): FlakeRow[] {
  const failures = new Map<string, number>()
  const count = (test: string) => failures.set(test, (failures.get(test) ?? 0) + 1)
  for (const report of reports) {
    if (!report) {
      count('(no report: the run crashed or timed out)')
      continue
    }
    for (const file of report.testResults ?? []) countFile(file, root, count)
  }
  return [...failures]
    .map(([test, total]) => ({ test, failures: total }))
    .toSorted(
      (left, right) => right.failures - left.failures || left.test.localeCompare(right.test),
    )
}

function countFile(file: FileResult, root: string, count: (test: string) => void) {
  const name = file.name.startsWith(root) ? file.name.slice(root.length) : file.name
  const failed = (file.assertionResults ?? []).filter((result) => result.status === 'failed')
  // A file that fails to load or tears down badly reports no failed assertion of its own.
  if (failed.length === 0 && file.status === 'failed') {
    count(`${name} (file)`)
    return
  }
  for (const result of failed) count(`${name} > ${result.fullName ?? result.title ?? '?'}`)
}

function summaryMarkdown(title: string, runs: number, rows: readonly FlakeRow[]) {
  const heading = `### ${title}: ${runs} runs, retry 0\n\n`
  if (rows.length === 0) return `${heading}No failures.\n`
  const lines = rows.map(
    (row) => `| ${row.failures}/${runs} | ${row.test.replaceAll('|', '\\|')} |`,
  )
  return `${heading}| Failed | Test |\n| --- | --- |\n${lines.join('\n')}\n`
}

function readReport(file: string): VitestReport | null {
  if (!existsSync(file)) return null
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

if (import.meta.main) {
  const [title = 'Flake watch', ...files] = process.argv.slice(2)
  const rows = flakeRows(files.map(readReport), `${process.cwd()}/`)
  const markdown = summaryMarkdown(title, files.length, rows)
  const summary = process.env.GITHUB_STEP_SUMMARY
  if (summary) appendFileSync(summary, markdown)
  process.stdout.write(markdown)
  process.exitCode = rows.length === 0 ? 0 : 1
}
