import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

import { isTestFile } from './web-design-census.mjs'

const REPOSITORY = path.resolve(import.meta.dirname, '../..')
// The design census's roots plus the tree fork, which holds React the design census does not read.
const DEFAULT_ROOTS = [
  'apps/web/src',
  'packages/markdown/src',
  'packages/tree/src',
  'packages/ui/src',
].map((root) => path.join(REPOSITORY, root))
const DEFAULT_ALLOW = path.join(REPOSITORY, 'scripts/lint/react-compiler-allow.json')
const LIST_CAP = 40

// Loaded from apps/web, where it is installed unhoisted: the census must run the exact compiler
// the build runs, because another version reports a different set of bailouts.
const { transformSync } = createRequire(path.join(REPOSITORY, 'apps/web/package.json'))(
  'oxc-transform-react',
)

/**
 * Every measure the census reports. `limit` gates: a hit over it fails `--check` unless the
 * allow-list excuses it. `histogramOnly` reports and never fails.
 */
export const TARGETS = {
  bailouts: { title: 'whole-file bailouts', limit: 0, listed: true },
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

export function causeOf(message) {
  const match = CAUSES.find(([prefix]) => message.startsWith(prefix))
  return match ? match[1] : null
}

function emptyCensus() {
  return {
    files: 0,
    hits: Object.fromEntries(MEASURES.map((measure) => [measure, []])),
  }
}

function mergeCensus(censuses) {
  const merged = emptyCensus()
  for (const census of censuses) {
    merged.files += census.files
    for (const measure of MEASURES) merged.hits[measure].push(...census.hits[measure])
  }
  return merged
}

/** Compiles one source and files each diagnostic under the measures it belongs to. */
export function censusSource(file, source) {
  const census = emptyCensus()
  census.files = 1
  const result = transformSync(file, source, {
    jsx: { runtime: 'automatic' },
    reactCompiler: {},
  })
  const memoized = /\b_c\(\d+\)/.test(result.code)
  const lineAt = lineLocator(source)
  const diagnostics = result.errors.map((error) => ({
    file,
    line: lineAt(error.labels?.[0]?.start ?? 0),
    message: error.message,
    value: causeOf(error.message),
  }))
  census.hits.coverage.push({ file, line: 1, value: outcome(memoized, diagnostics.length > 0) })
  for (const hit of diagnostics) record(census, hit, memoized)
  return census
}

function record(census, hit, memoized) {
  if (isTestFile(hit.file)) {
    census.hits.testBailouts.push({ ...hit, value: hit.value ?? 'unclassified' })
    return
  }
  if (hit.value === null) {
    census.hits.unclassified.push({ ...hit, value: hit.message.split('\n')[0].slice(0, 120) })
    return
  }
  census.hits.causes.push(hit)
  if (!memoized) census.hits.bailouts.push(hit)
}

function outcome(memoized, diagnosed) {
  if (memoized) return diagnosed ? 'memoized, partly refused' : 'memoized'
  return diagnosed ? 'refused' : 'nothing to memoize'
}

function lineLocator(source) {
  const starts = [0]
  for (let index = source.indexOf('\n'); index !== -1; index = source.indexOf('\n', index + 1))
    starts.push(index + 1)
  return (offset) => {
    let line = 0
    while (line + 1 < starts.length && starts[line + 1] <= offset) line += 1
    return line + 1
  }
}

function sourceFiles(root) {
  return fs
    .readdirSync(root, { recursive: true, withFileTypes: true })
    .filter(
      (entry) => entry.isFile() && /\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts'),
    )
    .map((entry) => path.join(entry.parentPath, entry.name))
    .filter((file) => !file.includes(`${path.sep}node_modules${path.sep}`))
    .sort()
}

function censusTree(root) {
  return mergeCensus(
    sourceFiles(root).map((file) =>
      censusSource(posix(path.relative(REPOSITORY, file)), fs.readFileSync(file, 'utf8')),
    ),
  )
}

function posix(value) {
  return value.split(path.sep).join('/')
}

function histogram(hits) {
  const counts = new Map()
  for (const hit of hits) counts.set(hit.value, (counts.get(hit.value) ?? 0) + 1)
  return counts
}

function readAllowList(file) {
  if (!fs.existsSync(file)) return []
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function validateAllowEntries(value) {
  if (!Array.isArray(value))
    return ['the allow-list must be a JSON array of { file, cause, reason } entries']
  return value.flatMap(entryProblems)
}

function entryProblems(entry, index) {
  const label = `allow[${index}]`
  if (!entry || typeof entry !== 'object') return [`${label}: entry must be an object`]
  const problems = []
  if (typeof entry.file !== 'string' || entry.file === '') problems.push(`${label}: missing "file"`)
  if (typeof entry.cause !== 'string' || entry.cause === '')
    problems.push(`${label}: missing "cause"`)
  if (typeof entry.reason !== 'string' || entry.reason.trim() === '')
    problems.push(
      `${label} (${entry.file ?? '?'} ${entry.cause ?? '?'}): an exception without a reason is itself a violation`,
    )
  return problems
}

function allowKey(file, cause) {
  return `${file} :: ${cause}`
}

/** An exception matching nothing is a claim about code that no longer exists. */
function staleEntries(entries, hits) {
  if (!Array.isArray(entries)) return []
  const seen = new Set(hits.map((hit) => allowKey(hit.file, hit.value)))
  return entries
    .filter((entry) => entryProblems(entry, 0).length === 0)
    .filter((entry) => !seen.has(allowKey(entry.file, entry.cause)))
    .map((entry) => `${entry.file} :: ${entry.cause}: stale, no such bailout remains`)
}

export function evaluate(census, allowEntries = [], { checkStale = true } = {}) {
  const allowProblems = validateAllowEntries(allowEntries)
  if (checkStale) allowProblems.push(...staleEntries(allowEntries, census.hits.bailouts))
  const allow = new Set(
    (Array.isArray(allowEntries) ? allowEntries : [])
      .filter((entry) => entryProblems(entry, 0).length === 0)
      .map((entry) => allowKey(entry.file, entry.cause)),
  )
  const offenders = {
    bailouts: census.hits.bailouts.filter((hit) => !allow.has(allowKey(hit.file, hit.value))),
    unclassified: census.hits.unclassified,
  }
  const failures = Object.entries(offenders)
    .filter(([measure, hits]) => hits.length > TARGETS[measure].limit)
    .map(([measure, hits]) => ({ measure, title: TARGETS[measure].title, count: hits.length }))
  return {
    offenders,
    failures,
    allowProblems,
    passed: failures.length === 0 && allowProblems.length === 0,
  }
}

function toJson(census, result, roots) {
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

function formatHistogram(title, hits) {
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

function formatList(title, hits) {
  if (hits.length === 0) return `${title}: none`
  const shown = hits.slice(0, LIST_CAP).map((hit) => `  ${hit.file}:${hit.line}  ${hit.value}`)
  if (hits.length > LIST_CAP) shown.push(`  … and ${hits.length - LIST_CAP} more`)
  return `${title}: ${hits.length}\n${shown.join('\n')}`
}

function formatGate(result) {
  const lines = result.allowProblems.map((problem) => `  allow-list  ${problem}`)
  for (const failure of result.failures)
    lines.push(`  ${failure.title}: ${failure.count} over target`)
  if (lines.length === 0) return 'gate: every measure is on target'
  return `gate: ${lines.length} measure(s) off target\n${lines.join('\n')}`
}

function formatReport(census, result, roots) {
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

function walkRoots(roots) {
  return roots.map((root) => {
    const census = censusTree(root)
    return { root: posix(path.relative(REPOSITORY, root)) || root, files: census.files, census }
  })
}

function main() {
  const { values } = parseArgs({
    options: {
      allow: { type: 'string', default: DEFAULT_ALLOW },
      check: { type: 'boolean', default: false },
      json: { type: 'boolean', default: false },
      // Repeatable, and any `--root` replaces the defaults rather than adding to them.
      root: { type: 'string', multiple: true },
    },
  })
  const requested = values.root ?? []
  const roots = requested.length === 0 ? DEFAULT_ROOTS : requested.map((root) => path.resolve(root))
  const walked = walkRoots(roots)
  const census = mergeCensus(walked.map((entry) => entry.census))
  // A narrowed run cannot see the files most entries name, so staleness is a whole-surface check.
  const result = evaluate(census, readAllowList(path.resolve(values.allow)), {
    checkStale: requested.length === 0,
  })
  const summary = walked.map(({ root, files }) => ({ root, files }))
  const output = values.json
    ? `${JSON.stringify(toJson(census, result, summary), null, 2)}\n`
    : formatReport(census, result, summary)
  process.stdout.write(output)
  process.exitCode = values.check && !result.passed ? 1 : 0
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main()
