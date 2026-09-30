import type { Hit, Roots } from './census-report.ts'
type Census = { files: number; hits: Record<string, Hit[]> }
type Diagnostic = Omit<Hit, 'value'> & { value: string | null; message: string }
type AllowEntry = { file: string; cause: string; reason: string }
import fs from 'node:fs'
import path from 'node:path'

import { isTestFile } from './web-design-census.ts'
import {
  formatGate,
  formatHistogram,
  formatList,
  histogram,
  runCensusIfMain,
} from './census-report.ts'
import { compileLikeBuild } from './react-compiler.ts'

const REPOSITORY = path.resolve(import.meta.dirname, '../..')
// The design census's roots plus the tree fork, which holds React the design census does not read.
const DEFAULT_ROOTS = [
  'apps/web/src',
  'packages/markdown/src',
  'packages/tree/src',
  'packages/ui/src',
].map((root) => path.join(REPOSITORY, root))
const DEFAULT_ALLOW = path.join(REPOSITORY, 'scripts/lint/react-compiler-allow.json')

/**
 * Every measure the census reports. `limit` gates: a hit over it fails `--check` unless the
 * allow-list excuses it. `histogramOnly` reports and never fails.
 */
export const TARGETS: Record<
  string,
  { title: string; limit?: number; listed?: boolean; histogram?: boolean; histogramOnly?: boolean }
> = {
  // Every refusal gates, not only a file with no memoized sibling: a component that depends on
  // the compiler for a memo loses it silently when it shares a file with one that compiles.
  bailouts: { title: 'refused components', limit: 0, listed: true },
  unclassified: { title: 'unclassified diagnostics', limit: 0, listed: true },
  causes: { title: 'diagnostic causes', histogram: true, histogramOnly: true },
  // Never gated: most files that emit no `_c()` are correct, and a ratio would fire on a
  // refactor that deleted dead code. It is the denominator for the bailout count.
  coverage: { title: 'files by compiler outcome', histogram: true, histogramOnly: true },
  testBailouts: { title: 'diagnostics in tests', histogram: true, histogramOnly: true },
}

const MEASURES = Object.keys(TARGETS)

/** The compiler's messages, matched by prefix. An unmatched message fails the gate. */
const CAUSES = [
  ['Cannot access refs during render', 'refs-during-render'],
  ['Use of incompatible library', 'incompatible-library'],
  ['Existing memoization could not be preserved', 'manual-memo-not-preserved'],
  ['React rule suppression prevents optimization', 'rule-suppression'],
  ['Logical assignment operators', 'logical-assignment'],
  ['[PruneHoistedContexts]', 'hoisted-function'],
  ['`try`/`finally` without `catch`', 'try-finally'],
  ['(BuildHIR::lowerStatement) Handle TryStatement with a finalizer', 'try-finally'],
  ['(BuildHIR::lowerStatement) Support ThrowStatement inside of try/catch', 'throw-in-try'],
  ['(BuildHIR::node.lowerReorderableExpression)', 'unreorderable-expression'],
  ['This value cannot be modified', 'immutable-write'],
  ['Cannot reassign variable', 'reassignment'],
]

export function causeOf(message: string) {
  const match = CAUSES.find(([prefix]) => message.startsWith(prefix))
  return match ? match[1] : null
}

function emptyCensus(): Census {
  return {
    files: 0,
    hits: Object.fromEntries(MEASURES.map((measure) => [measure, []])),
  }
}

function mergeCensus(censuses: readonly Census[]) {
  const merged = emptyCensus()
  for (const census of censuses) {
    merged.files += census.files
    for (const measure of MEASURES) merged.hits[measure].push(...census.hits[measure])
  }
  return merged
}

/** Compiles one source and files each diagnostic under the measures it belongs to. */
export function censusSource(file: string, source: string) {
  const census = emptyCensus()
  census.files = 1
  const result = compileLikeBuild(file, source)
  const memoized = /\b_c\(\d+\)/.test(result.code)
  const lineAt = lineLocator(source)
  const diagnostics = result.errors.map((error) => ({
    file,
    line: lineAt(error.labels?.[0]?.start ?? 0),
    message: error.message,
    value: causeOf(error.message),
  }))
  census.hits.coverage.push({ file, line: 1, value: outcome(memoized, diagnostics.length > 0) })
  for (const hit of diagnostics) record(census, hit)
  return census
}

function record(census: Census, hit: Diagnostic) {
  if (isTestFile(hit.file)) {
    census.hits.testBailouts.push({ ...hit, value: hit.value ?? 'unclassified' })
    return
  }
  if (hit.value === null) {
    census.hits.unclassified.push({ ...hit, value: hit.message.split('\n')[0].slice(0, 120) })
    return
  }
  census.hits.causes.push({ ...hit, value: hit.value })
  census.hits.bailouts.push({ ...hit, value: hit.value })
}

function outcome(memoized: boolean, diagnosed: boolean) {
  if (memoized) return diagnosed ? 'memoized, partly refused' : 'memoized'
  return diagnosed ? 'refused' : 'nothing to memoize'
}

function lineLocator(source: string) {
  const starts = [0]
  for (let index = source.indexOf('\n'); index !== -1; index = source.indexOf('\n', index + 1))
    starts.push(index + 1)
  return (offset: number) => {
    let line = 0
    while (line + 1 < starts.length && starts[line + 1] <= offset) line += 1
    return line + 1
  }
}

function sourceFiles(root: string) {
  return fs
    .readdirSync(root, { recursive: true, withFileTypes: true })
    .filter(
      (entry) => entry.isFile() && /\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts'),
    )
    .map((entry) => path.join(entry.parentPath, entry.name))
    .filter((file) => !file.includes(`${path.sep}node_modules${path.sep}`))
    .sort()
}

function censusTree(root: string) {
  return mergeCensus(
    sourceFiles(root).map((file) =>
      censusSource(posix(path.relative(REPOSITORY, file)), fs.readFileSync(file, 'utf8')),
    ),
  )
}

function posix(value: string) {
  return value.split(path.sep).join('/')
}

function readAllowList(file: string) {
  if (!fs.existsSync(file)) return []
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function validateAllowEntries(value: unknown) {
  if (!Array.isArray(value))
    return ['the allow-list must be a JSON array of { file, cause, reason } entries']
  return value.flatMap(entryProblems)
}

function entryProblems(entry: unknown, index: number) {
  const label = `allow[${index}]`
  if (!entry || typeof entry !== 'object') return [`${label}: entry must be an object`]
  const file = 'file' in entry ? entry.file : undefined
  const cause = 'cause' in entry ? entry.cause : undefined
  const reason = 'reason' in entry ? entry.reason : undefined
  const problems = []
  if (typeof file !== 'string' || file === '') problems.push(`${label}: missing "file"`)
  if (typeof cause !== 'string' || cause === '') problems.push(`${label}: missing "cause"`)
  if (typeof reason !== 'string' || reason.trim() === '')
    problems.push(
      `${label} (${file ?? '?'} ${cause ?? '?'}): an exception without a reason is itself a violation`,
    )
  return problems
}

function allowKey(file: string, cause: string) {
  return `${file} :: ${cause}`
}

/** An exception matching nothing is a claim about code that no longer exists. */
function staleEntries(entries: unknown, hits: Hit[]) {
  if (!Array.isArray(entries)) return []
  const seen = new Set(hits.map((hit) => allowKey(hit.file, hit.value)))
  return entries
    .filter((entry): entry is AllowEntry => entryProblems(entry, 0).length === 0)
    .filter((entry) => !seen.has(allowKey(entry.file, entry.cause)))
    .map((entry) => `${entry.file} :: ${entry.cause}: stale, no such bailout remains`)
}

export function evaluate(census: Census, allowEntries: unknown = [], { checkStale = true } = {}) {
  const allowProblems = validateAllowEntries(allowEntries)
  if (checkStale) allowProblems.push(...staleEntries(allowEntries, census.hits.bailouts))
  const allow = new Set(
    (Array.isArray(allowEntries) ? allowEntries : [])
      .filter((entry): entry is AllowEntry => entryProblems(entry, 0).length === 0)
      .map((entry) => allowKey(entry.file, entry.cause)),
  )
  const offenders = {
    bailouts: census.hits.bailouts.filter((hit) => !allow.has(allowKey(hit.file, hit.value))),
    unclassified: census.hits.unclassified,
  }
  const failures = Object.entries(offenders)
    .filter(([measure, hits]) => hits.length > (TARGETS[measure].limit ?? 0))
    .map(([measure, hits]) => ({ measure, title: TARGETS[measure].title, count: hits.length }))
  return {
    offenders,
    failures,
    allowProblems,
    passed: failures.length === 0 && allowProblems.length === 0,
  }
}

function toJson(census: Census, result: ReturnType<typeof evaluate>, roots: Roots) {
  return {
    roots,
    files: census.files,
    measures: Object.fromEntries(
      MEASURES.map((measure) => [measure, Object.fromEntries(histogram(census.hits[measure]))]),
    ),
    totals: Object.fromEntries(MEASURES.map((measure) => [measure, census.hits[measure].length])),
    violations: result.offenders,
    failures: result.failures,
    allowProblems: result.allowProblems,
    passed: result.passed,
  }
}

function formatReport(census: Census, result: ReturnType<typeof evaluate>, roots: Roots) {
  const described = roots.map(({ root, files }) => `${root} ${files}`).join(', ')
  return [
    `React Compiler census — ${census.files} .ts/.tsx files: ${described}`,
    '',
    ...MEASURES.filter((measure) => TARGETS[measure].histogram).map(
      (measure) => `${formatHistogram(TARGETS[measure].title, census.hits[measure])}\n`,
    ),
    `${formatList(`${TARGETS.bailouts.title} outside the allow-list`, result.offenders.bailouts)}\n`,
    `${formatList(TARGETS.unclassified.title, census.hits.unclassified)}\n`,
    formatGate(result),
    '',
  ].join('\n')
}

runCensusIfMain(import.meta.url, {
  repository: REPOSITORY,
  defaultRoots: DEFAULT_ROOTS,
  defaultAllow: DEFAULT_ALLOW,
  censusTree,
  mergeCensus,
  readAllowList,
  evaluate,
  toJson,
  formatReport,
})
