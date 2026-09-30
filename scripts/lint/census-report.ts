import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

export type Hit = { file: string; line: number; value: string }
export type GateResult = {
  allowProblems: readonly string[]
  failures: readonly { title: string; count: number }[]
}

/** Shared report formatting for the censuses. A measure is a list of hits, each with a `value`. */

/** Past this a list stops being readable; the count above it is the number that matters. */
const LIST_CAP = 40

export function histogram(hits: readonly { value: string }[]) {
  const counts = new Map<string, number>()
  for (const hit of hits) counts.set(hit.value, (counts.get(hit.value) ?? 0) + 1)
  return counts
}

export function formatHistogram(title: string, hits: readonly { value: string }[]) {
  const rows = [...histogram(hits)].sort(
    (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
  )
  if (rows.length === 0) return `${title}\n  (none)`
  const width = Math.max(...rows.map(([value]) => value.length), 'total'.length)
  const body = rows.map(
    ([value, count]) => `  ${value.padEnd(width)}  ${String(count).padStart(6)}`,
  )
  return `${title}\n${body.join('\n')}\n  ${'total'.padEnd(width)}  ${String(hits.length).padStart(6)}`
}

export function formatList(title: string, hits: readonly Hit[]) {
  if (hits.length === 0) return `${title}: none`
  const shown = hits.slice(0, LIST_CAP).map((hit) => `  ${hit.file}:${hit.line}  ${hit.value}`)
  if (hits.length > LIST_CAP) shown.push(`  … and ${hits.length - LIST_CAP} more`)
  return `${title}: ${hits.length}\n${shown.join('\n')}`
}

export function formatGate(result: GateResult) {
  const lines = result.allowProblems.map((problem) => `  allow-list  ${problem}`)
  for (const failure of result.failures)
    lines.push(`  ${failure.title}: ${failure.count} over target`)
  if (lines.length === 0) return 'gate: every measure is on target'
  return `gate: ${lines.length} measure(s) off target\n${lines.join('\n')}`
}

export type Roots = readonly { root: string; files: number }[]

type CensusCommand<Census extends { files: number }, Result extends { passed: boolean }> = {
  repository: string
  defaultRoots: readonly string[]
  defaultAllow: string
  censusTree: (root: string) => Census
  mergeCensus: (censuses: readonly Census[]) => Census
  readAllowList: (file: string) => unknown
  evaluate: (census: Census, entries: unknown, options: { checkStale: boolean }) => Result
  toJson: (census: Census, result: Result, roots: Roots) => unknown
  formatReport: (census: Census, result: Result, roots: Roots) => string
}

export function runCensusIfMain<
  Census extends { files: number },
  Result extends { passed: boolean },
>(moduleUrl: string, command: CensusCommand<Census, Result>) {
  if (!process.argv[1] || pathToFileURL(process.argv[1]).href !== moduleUrl) return
  const { values } = parseArgs({
    options: {
      allow: { type: 'string', default: command.defaultAllow },
      check: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      root: { type: 'string', multiple: true },
    },
  })
  const requested = values.root ?? []
  const roots =
    requested.length === 0 ? command.defaultRoots : requested.map((root) => path.resolve(root))
  const walked = roots.map((root) => {
    const census = command.censusTree(root)
    return {
      root: path.relative(command.repository, root).split(path.sep).join('/') || root,
      files: census.files,
      census,
    }
  })
  const census = command.mergeCensus(walked.map((entry) => entry.census))
  // Only the default roots cover every file an allow-list entry can name.
  const result = command.evaluate(census, command.readAllowList(path.resolve(values.allow)), {
    checkStale: requested.length === 0,
  })
  const summary = walked.map(({ root, files }) => ({ root, files }))
  process.stdout.write(
    values.json
      ? `${JSON.stringify(command.toJson(census, result, summary), null, 2)}\n`
      : command.formatReport(census, result, summary),
  )
  process.exitCode = values.check && !result.passed ? 1 : 0
}
