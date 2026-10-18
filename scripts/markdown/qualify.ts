import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { baselineRows, inspectCandidate, promotionVerdict } from './report'
import {
  createTrustedPromotionContext,
  evaluatePromotion,
  frozenBudgetSha256,
  verifyPromotionArtifacts,
  type TrustedPromotionContext,
} from './promotion'
import { errorMessage } from '../../packages/contracts/src/error-fields'
import { qualificationProvenance } from './provenance'
import { inspectRasterEvidence } from './raster'
import { compareRasterEvidence } from './paired-raster'
import { createScriptError } from '../structured-errors'
import { checkRunExitCode, qualificationExitCode, validateChecksOnly } from './check-exit'

import { blockToHast, createHastProcessor } from '../../packages/markdown/src/utils/hast'
import { createMarkdownSession } from '../../packages/markdown/src/utils/session'
import {
  createTreeSitterMarkdownSession,
  initializeTreeSitterMarkdown,
} from '../../packages/markdown/src/utils/tree-sitter-session'
import { readyRemarkExtensions } from '../../packages/markdown/test/qualification'
import { digestProjection } from './paired-native'

const ROOT = path.resolve(import.meta.dirname, '../..')
const SUITES = ['parity', 'stream', 'fuzz', 'visual', 'bench', 'qualify'] as const
type Suite = (typeof SUITES)[number]
export type QualificationMode = 'baseline' | 'candidate' | 'paired'

type TestRun = {
  readonly name: string
  readonly exitCode: number
  readonly tests: number
  readonly passed: number
  readonly failed: number
  readonly pending: number
  readonly todo: number
  readonly log: string
}

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      out: { type: 'string' },
      baseline: { type: 'boolean' },
      candidate: { type: 'boolean' },
      'inspect-only': { type: 'boolean' },
      'checks-only': { type: 'boolean' },
      browser: { type: 'string', default: 'chromium' },
      'promotion-receipts': { type: 'string' },
      'evaluation-receipt': { type: 'string' },
      'evaluation-ledger': { type: 'string' },
      help: { type: 'boolean' },
    },
  })
  if (values.help) {
    process.stdout.write(
      'bun scripts/markdown/qualify.ts parity|stream|fuzz|visual|bench|qualify --out DIRECTORY [--baseline|--candidate] [--inspect-only|--checks-only] [--browser chromium|webkit] [--promotion-receipts JSON --evaluation-receipt JSON --evaluation-ledger DIRECTORY]\nDefault runs paired engines. Availability inspection executes actual native/adapter probes; readiness requires complete trusted promotion receipts. Native source timings remain exploratory.\n',
    )
    return
  }
  const suite = SUITES.find((entry) => entry === positionals[0])
  if (!suite || !values.out)
    throw createScriptError('Choose a Markdown suite and --out DIRECTORY.', {
      internal: { arguments: positionals.length },
    })
  validateChecksOnly({
    checksOnly: values['checks-only'],
    baseline: values.baseline,
    inspectOnly: values['inspect-only'],
    receipts: values['promotion-receipts'],
    evaluationReceipt: values['evaluation-receipt'],
    evaluationLedger: values['evaluation-ledger'],
  })
  if (values.browser !== 'chromium' && values.browser !== 'webkit')
    throw createScriptError('Choose chromium or webkit for Markdown browser checks.')
  const mode = qualificationMode(values)
  const output = path.resolve(values.out)
  await mkdir(output, { recursive: true })
  const rows = baselineRows()
  await writeFile(path.join(output, 'baseline-checks.json'), `${JSON.stringify(rows, null, 2)}\n`)
  const candidate = await inspectCandidate(ROOT)
  const provenance = await qualificationProvenance(ROOT)
  const runs = values['inspect-only'] ? [] : await runSuites(suite, output, mode, values.browser)
  const browser = runs.some((run) => run.name.startsWith('browser-'))
  const evaluated = await suppliedPromotion({
    receipts: values['promotion-receipts'],
    evaluationReceipt: values['evaluation-receipt'],
    evaluationLedger: values['evaluation-ledger'],
  })
  const promotion = promotionVerdict(rows, browser, {
    candidate,
    promotion: evaluated,
    executionFailures: runs
      .filter((run) => run.exitCode !== 0)
      .map((run) => `${run.name}: required execution failed or produced no executed cases.`),
  })
  const exitCode = qualificationExitCode({
    checksOnly: values['checks-only'] ?? false,
    mode,
    candidateAvailable: candidate.status === 'available-unqualified',
    verdict: promotion.verdict,
    runs,
    expectedRuns: qualificationTestPlan(suite, mode, values.browser).length,
  })
  const checkExitCode = qualificationExitCode({
    checksOnly: true,
    mode,
    candidateAvailable: candidate.status === 'available-unqualified',
    verdict: promotion.verdict,
    runs,
    expectedRuns: qualificationTestPlan(suite, mode, values.browser).length,
  })
  const report = {
    schemaVersion: 1,
    reportScope: values['checks-only'] ? 'checks-only' : 'promotion',
    checkExecution: { status: checkExitCode === 0 ? 'PASSED' : 'FAILED', exitCode: checkExitCode },
    exitCode,
    suite,
    generatedAt: new Date().toISOString(),
    scope: mode,
    testExecution: values['inspect-only'] ? 'NOT_EXECUTED' : 'EXECUTED',
    candidate: {
      ...candidate,
      status: promotion.verdict === 'VERIFIED' ? 'verified' : candidate.status,
    },
    gateEvidence: evaluated,
    provenance,
    promotion,
    runs,
  }
  await writeFile(path.join(output, 'qualification.json'), `${JSON.stringify(report, null, 2)}\n`)
  process.stdout.write(
    `${JSON.stringify({ evidence: output, verdict: promotion.verdict, reportScope: report.reportScope, checkExecution: report.checkExecution, baselineExpectations: promotion.counts, testRuns: runs.map(({ name, exitCode, tests, passed, failed, pending, todo }) => ({ name, exitCode, declared: tests, executed: passed + failed, passed, failed, pending, todo })) })}\n`,
  )
  process.exitCode = exitCode
}

async function runSuites(
  suite: Suite,
  output: string,
  mode: QualificationMode,
  browserName: 'chromium' | 'webkit',
): Promise<TestRun[]> {
  const runs: TestRun[] = []
  for (const plan of qualificationTestPlan(suite, mode, browserName)) {
    runs.push(await runTests(plan.name, plan.directory, plan.flags, output, plan.browser))
  }
  if (suite === 'fuzz' || suite === 'qualify') runs.push(await runFuzzChecks(output, mode))
  if (suite === 'bench' || suite === 'qualify') {
    if (mode !== 'baseline') {
      const { runPairedNative } = await import('./paired-native')
      const report = await runPairedNative({ mode: 'quick' })
      await writeFile(
        path.join(output, 'paired-native.json'),
        `${JSON.stringify(report, null, 2)}\n`,
      )
      const pairs = report.workloads.flatMap((entry) => entry.pairs)
      const mismatched = pairs.filter((pair) => pair.mismatchedRevisions.length > 0).length
      const tests = pairs.length + 1
      runs.push({
        name: 'paired-native-output',
        exitCode: report.status === 'FAILED' || pairs.length === 0 ? 1 : 0,
        tests,
        passed: pairs.length - mismatched + (report.status === 'FAILED' ? 0 : 1),
        failed: mismatched + (report.status === 'FAILED' ? 1 : 0),
        pending: 0,
        todo: 0,
        log: path.join(output, 'paired-native.json'),
      })
    } else {
      const { runMarkdownBenchmarks } = await import('./bench')
      const browserLog = await browserLogs(runs)
      const report = await runMarkdownBenchmarks({ mode: 'quick', browserLog })
      const { rawSamples, ...summary } = report
      await writeFile(path.join(output, 'benchmark.json'), `${JSON.stringify(summary, null, 2)}\n`)
      await writeFile(
        path.join(output, 'raw-samples.jsonl'),
        rawSamples.map((sample) => JSON.stringify(sample)).join('\n') + '\n',
      )
      if (report.families.some((family) => family.status === 'FAILED'))
        runs.push({
          name: 'benchmark-output',
          exitCode: 1,
          tests: report.rawSamples.length,
          passed: 0,
          failed: 1,
          pending: 0,
          todo: 0,
          log: path.join(output, 'benchmark.json'),
        })
    }
  }
  if (suite === 'visual' || suite === 'qualify') {
    const raster = await inspectRasterEvidence(await browserLogs(runs), ROOT, output)
    await writeFile(path.join(output, 'raster.json'), `${JSON.stringify(raster, null, 2)}\n`)
    if (mode !== 'baseline') {
      const paired = await compareRasterEvidence(
        await engineBrowserLog(runs, 'remark'),
        await engineBrowserLog(runs, 'tree-sitter'),
        ROOT,
        output,
      )
      await writeFile(
        path.join(output, 'paired-raster.json'),
        `${JSON.stringify(paired, null, 2)}\n`,
      )
      runs.push({
        name: 'paired-raster',
        exitCode: paired.status === 'passed' ? 0 : 1,
        tests: 128,
        passed: paired.compared.filter((pair) => pair.status === 'passed').length,
        failed: paired.compared.filter((pair) => pair.status !== 'passed').length,
        pending: Math.max(0, 128 - paired.compared.length),
        todo: 0,
        log: path.join(output, 'paired-raster.json'),
      })
    }
    const engines = mode === 'baseline' ? 1 : 2
    const completeMatrix =
      raster.images.length === 128 * engines && raster.calibration.length === 4 * engines
    runs.push({
      name: 'raster-controls',
      exitCode: raster.status === 'passed' && completeMatrix ? 0 : 1,
      tests: 128 * engines,
      passed: raster.images.filter((image) => image.status === 'passed').length,
      failed: raster.images.filter((image) => image.status === 'failed').length,
      pending: Math.max(0, 128 * engines - raster.images.length),
      todo: 0,
      log: path.join(output, 'raster.json'),
    })
  }
  return runs
}

async function runFuzzChecks(output: string, mode: QualificationMode): Promise<TestRun> {
  const report = await runSeededFuzz(mode !== 'baseline')
  const log = path.join(output, 'seeded-fuzz.json')
  await writeFile(log, `${JSON.stringify(report, null, 2)}\n`)
  return {
    name: 'seeded-edit-fuzz',
    exitCode: report.failures > 0 ? 1 : 0,
    tests: report.cases.length,
    passed: report.cases.length - report.failures,
    failed: report.failures,
    pending: 0,
    todo: 0,
    log,
  }
}

const ATOMS = [
  '*',
  '**',
  '_',
  '`',
  '```\n',
  '[x]',
  '(https://example.test/a)',
  '\n\n',
  '> ',
  '- ',
  '[x]: /target\n',
  '| a | b |\n|---|---|\n',
  '&amp;',
  '\r\n',
  'אבג',
  '🧑‍💻',
  '$x$',
]
type Edit = { readonly source: string; readonly operation: string }
type Factory = typeof createMarkdownSession

type FuzzFailure = {
  readonly engine: 'remark' | 'tree-sitter' | 'paired'
  readonly live: boolean
  readonly revision: number
  readonly expected: string
  readonly observed: string
}

export function seededEdits(seed: number, count: number): Edit[] {
  let state = seed >>> 0
  const random = (limit: number) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return Math.floor((state / 0x1_0000_0000) * limit)
  }
  const edits: Edit[] = [{ source: 'A **seeded** message.\n\n', operation: 'initial' }]
  for (let index = 0; index < count; index += 1) {
    const source = edits.at(-1)?.source ?? ''
    const position = random(source.length + 1)
    const kind = random(4)
    if (kind === 0 && edits.length > 1) {
      edits.push({ source: edits[edits.length - 2].source, operation: 'undo' })
      continue
    }
    if (kind === 1 || source.length > 4096) {
      const end = position + 1 + random(16)
      edits.push({
        source: source.slice(0, position) + source.slice(end),
        operation: `delete ${position}:${end}`,
      })
      continue
    }
    const atom = ATOMS[random(ATOMS.length)]
    edits.push({
      source: source.slice(0, position) + atom + source.slice(position),
      operation: `insert ${position} ${JSON.stringify(atom)}`,
    })
  }
  return edits
}

function project(
  session: ReturnType<Factory>,
  processor: ReturnType<typeof createHastProcessor>,
  source: string,
  live: boolean,
) {
  return digestProjection({
    type: 'root',
    children: session
      .update(source, { heal: live })
      .flatMap((block) => blockToHast(block, processor).children),
  })
}

function freshDigest(
  factory: Factory,
  processor: ReturnType<typeof createHastProcessor>,
  source: string,
  live: boolean,
) {
  const session = factory()
  try {
    return project(session, processor, source, live)
  } finally {
    session.update('', { heal: false })
    if ('dispose' in session && typeof session.dispose === 'function') session.dispose()
  }
}

function fuzzSeed(
  edits: readonly Edit[],
  processor: ReturnType<typeof createHastProcessor>,
  live: boolean,
  paired: boolean,
) {
  const remark = createMarkdownSession()
  const candidate = paired ? createTreeSitterMarkdownSession() : null
  try {
    for (const [revision, edit] of edits.entries()) {
      const failure = fuzzRevision({ remark, candidate, processor, edit, live, revision })
      if (failure) return { failure, replay: edits.slice(0, revision + 1) }
    }
    return { failure: null, replay: [] }
  } finally {
    remark.update('', { heal: false })
    candidate?.update('', { heal: false })
  }
}

function fuzzRevision(input: {
  readonly remark: ReturnType<Factory>
  readonly candidate: ReturnType<typeof createTreeSitterMarkdownSession> | null
  readonly processor: ReturnType<typeof createHastProcessor>
  readonly edit: Edit
  readonly live: boolean
  readonly revision: number
}): FuzzFailure | null {
  const { remark, candidate, processor, edit, live, revision } = input
  const baseline = project(remark, processor, edit.source, live)
  const baselineFresh = freshDigest(createMarkdownSession, processor, edit.source, live)
  if (baseline !== baselineFresh)
    return { engine: 'remark', live, revision, expected: baselineFresh, observed: baseline }
  if (!candidate) return null
  const observed = project(candidate, processor, edit.source, live)
  const fresh = freshDigest(createTreeSitterMarkdownSession, processor, edit.source, live)
  if (observed !== fresh)
    return { engine: 'tree-sitter', live, revision, expected: fresh, observed }
  if (observed !== baseline)
    return { engine: 'paired', live, revision, expected: baseline, observed }
  return null
}

function fuzzProfile(
  seed: number,
  edits: readonly Edit[],
  processor: ReturnType<typeof createHastProcessor>,
  live: boolean,
  paired: boolean,
) {
  const result = fuzzSeed(edits, processor, live, paired)
  const executedRevisions = result.failure ? result.failure.revision + 1 : edits.length
  return {
    seed,
    live,
    declaredRevisions: edits.length,
    executedRevisions,
    unexecutedRevisions: edits.length - executedRevisions,
    ...result,
  }
}

export async function runSeededFuzz(paired: boolean, seeds = 64, operations = 64) {
  if (paired) await initializeTreeSitterMarkdown()
  const processor = createHastProcessor(await readyRemarkExtensions())
  const cases = Array.from({ length: seeds }, (_, index) => index + 176).flatMap((seed) => {
    const edits = seededEdits(seed, operations)
    return [false, true].map((live) => fuzzProfile(seed, edits, processor, live, paired))
  })
  return {
    schemaVersion: 1,
    scope: 'development-seeded-edit-fuzz',
    verdict: 'NOT VERIFIED',
    profile: 'adversarial UTF-16 edits; completed and healed live output',
    seeds,
    operationsPerSeed: operations,
    maxSourceUnits: 4096 + Math.max(...ATOMS.map((atom) => atom.length)),
    cases,
    failures: cases.filter((entry) => entry.failure !== null).length,
    limitation:
      'First-failing operation-prefix replays are retained. Source/delimiter minimization remains a separate gate.',
  }
}

export function qualificationMode(values: {
  readonly baseline?: boolean
  readonly candidate?: boolean
}): QualificationMode {
  if (values.baseline && values.candidate)
    throw createScriptError('Choose one explicit Markdown engine mode.', {
      internal: { argument: 'baseline or candidate' },
    })
  if (values.baseline) return 'baseline'
  if (values.candidate) return 'candidate'
  return 'paired'
}

export function qualificationTestPlan(
  suite: Suite,
  mode: QualificationMode,
  browser: 'chromium' | 'webkit' = 'chromium',
) {
  const engines =
    mode === 'paired' ? ['remark', 'tree-sitter'] : [mode === 'baseline' ? 'remark' : 'tree-sitter']
  const selected =
    mode === 'candidate' && (suite === 'visual' || suite === 'qualify')
      ? ['remark', 'tree-sitter']
      : engines
  if (suite === 'fuzz') return []
  return selected.flatMap((engine) => {
    const plans: { name: string; directory: string; flags: string[]; browser: boolean }[] = []
    if (suite === 'parity' || suite === 'stream' || suite === 'qualify') {
      const flags =
        engine === 'tree-sitter'
          ? ['--project', 'node', 'qualification-candidate']
          : [
              '--project',
              'node',
              suite === 'stream' ? 'qualification-stream' : 'qualification',
              '--exclude',
              '**/qualification-candidate.test.ts',
            ]
      plans.push({
        name: `package-${engine}`,
        directory: 'packages/markdown',
        flags,
        browser: false,
      })
    }
    if (
      suite === 'parity' ||
      suite === 'visual' ||
      suite === 'stream' ||
      suite === 'bench' ||
      suite === 'qualify'
    )
      plans.push({
        name: `browser-${engine}-${suite}`,
        directory: 'apps/web',
        flags: [
          '--config',
          'vitest.markdown-qualification.config.ts',
          '--mode',
          (engine === 'tree-sitter' ? 'candidate' : 'baseline') +
            (browser === 'webkit' ? '-webkit' : ''),
        ].concat(browserFilters(suite)),
        browser: true,
      })
    return plans
  })
}

async function browserLogs(runs: readonly TestRun[]) {
  return (
    await Promise.all(
      runs.filter((run) => run.name.startsWith('browser-')).map((run) => readFile(run.log, 'utf8')),
    )
  ).join('\n')
}

async function engineBrowserLog(runs: readonly TestRun[], engine: 'remark' | 'tree-sitter') {
  return (
    await Promise.all(
      runs
        .filter((run) => run.name.startsWith(`browser-${engine}-`))
        .map((run) => readFile(run.log, 'utf8')),
    )
  ).join('\n')
}

async function suppliedPromotion(options: {
  readonly receipts?: string
  readonly evaluationReceipt?: string
  readonly evaluationLedger?: string
}) {
  const missing = {
    verdict: 'NOT VERIFIED' as const,
    gates: [],
    findings: ['Trusted complete promotion receipts have not been supplied.'],
  }
  if (!options.receipts) return missing
  try {
    const directory = path.dirname(path.resolve(options.receipts))
    const input: unknown = JSON.parse(await readFile(options.receipts, 'utf8'))
    const artifacts = await verifyPromotionArtifacts(input, directory)
    let context: TrustedPromotionContext | undefined
    if (options.evaluationReceipt && options.evaluationLedger)
      context = await createTrustedPromotionContext({
        root: ROOT,
        evaluationReceipt: path.resolve(options.evaluationReceipt),
        evaluationLedger: path.resolve(options.evaluationLedger),
        evidenceDirectory: directory,
      })
    return evaluatePromotion(input, await frozenBudgetSha256(), artifacts, context)
  } catch (failure) {
    return {
      ...missing,
      findings: [`Trusted promotion evidence could not be established: ${errorMessage(failure)}`],
    }
  }
}

function browserFilters(suite: Suite): string[] {
  if (suite === 'parity')
    return [
      'qualification-semantics',
      'qualification-layout',
      'qualification-state',
      'qualification-production',
    ]
  if (suite === 'visual') return ['qualification.browser.tsx']
  if (suite === 'stream') return ['qualification-stream']
  if (suite === 'bench') return ['qualification-bench']
  return ['qualification']
}

async function runTests(
  name: string,
  directory: string,
  flags: readonly string[],
  output: string,
  browser = false,
): Promise<TestRun> {
  const jsonFile = path.join(output, `${name}-${randomUUID()}-tests.json`)
  const env = { ...process.env }
  if (browser) {
    env.VITEST_BROWSER_PORT ??= String(await freePort())
    env.VITEST_BROWSER_FILE_SERVER_PORT ??= String(await freePort())
  }
  const args = [
    'node',
    path.join(ROOT, 'node_modules/vitest/vitest.mjs'),
    'run',
    '--maxWorkers=2',
  ].concat(flags, ['--reporter=default', '--reporter=json', `--outputFile=${jsonFile}`])
  const child = Bun.spawn(args, {
    cwd: path.join(ROOT, directory),
    env,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  let interrupted = false
  const terminate = () => {
    interrupted = true
    child.kill('SIGTERM')
  }
  process.once('SIGINT', terminate)
  process.once('SIGTERM', terminate)
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  process.removeListener('SIGINT', terminate)
  process.removeListener('SIGTERM', terminate)
  const log = path.join(output, `${name}.log`)
  await writeFile(log, stdout + stderr)
  if (interrupted)
    throw createScriptError('Markdown test execution was interrupted.', {
      internal: { suite: name },
      fix: 'Run the suite again when its execution host is available.',
    })
  const result = await readTestResult(jsonFile)
  return {
    name,
    exitCode: checkRunExitCode(exitCode, {
      tests: result.numTotalTests,
      passed: result.numPassedTests,
      failed: result.numFailedTests,
    }),
    tests: result.numTotalTests,
    passed: result.numPassedTests,
    failed: result.numFailedTests,
    pending: result.numPendingTests,
    todo: result.numTodoTests,
    log,
  }
}

export async function readTestResult(file: string) {
  const content = await Bun.file(file).exists()
  if (!content)
    return {
      numTotalTests: 0,
      numPassedTests: 0,
      numFailedTests: 0,
      numPendingTests: 0,
      numTodoTests: 0,
    }
  return parseTestCounts(JSON.parse(await readFile(file, 'utf8')))
}

export function parseTestCounts(value: unknown) {
  if (!value || typeof value !== 'object')
    throw createScriptError('The test report has an invalid shape.', {
      internal: { field: 'report' },
    })
  const counts = {
    numTotalTests: testCount(value, 'numTotalTests'),
    numPassedTests: testCount(value, 'numPassedTests'),
    numFailedTests: testCount(value, 'numFailedTests'),
    numPendingTests: testCount(value, 'numPendingTests'),
    numTodoTests: testCount(value, 'numTodoTests'),
  }
  const rows = assertionStatuses(value)
  if (rows.length > counts.numTotalTests)
    throw createScriptError('The test assertion denominator exceeds the declared total.', {
      internal: { declared: counts.numTotalTests, assertions: rows.length },
    })
  counts.numPassedTests = Math.max(
    counts.numPassedTests,
    rows.filter((status) => status === 'passed').length,
  )
  counts.numFailedTests = Math.max(
    counts.numFailedTests,
    rows.filter((status) => status === 'failed').length,
  )
  counts.numPendingTests = Math.max(
    counts.numPendingTests,
    rows.filter((status) => status === 'pending' || status === 'skipped' || status === 'disabled')
      .length,
  )
  counts.numTodoTests = Math.max(
    counts.numTodoTests,
    rows.filter((status) => status === 'todo').length,
  )
  const accounted =
    counts.numPassedTests + counts.numFailedTests + counts.numPendingTests + counts.numTodoTests
  if (accounted > counts.numTotalTests)
    throw createScriptError('The test report has inconsistent counts.', {
      internal: { total: counts.numTotalTests, accounted },
    })
  counts.numPendingTests += counts.numTotalTests - accounted
  return counts
}

function assertionStatuses(value: object): string[] {
  const results: unknown = Reflect.get(value, 'testResults')
  if (results === undefined) return []
  if (!Array.isArray(results)) throw createScriptError('The test report has invalid suite rows.')
  return results.flatMap(suiteAssertionStatuses)
}

function suiteAssertionStatuses(value: unknown): string[] {
  if (!value || typeof value !== 'object')
    throw createScriptError('The test report has an invalid suite row.')
  const results: unknown = Reflect.get(value, 'assertionResults')
  if (!Array.isArray(results))
    throw createScriptError('The test report has invalid assertion rows.')
  return results.map(assertionStatus)
}

function assertionStatus(value: unknown): string {
  if (!value || typeof value !== 'object')
    throw createScriptError('The test report has an invalid assertion row.')
  const status: unknown = Reflect.get(value, 'status')
  if (
    typeof status !== 'string' ||
    !['passed', 'failed', 'pending', 'skipped', 'disabled', 'todo'].includes(status)
  )
    throw createScriptError('The test report has an invalid assertion status.')
  return status
}

function testCount(record: object, field: string): number {
  const value: unknown = Reflect.get(record, field)
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw createScriptError('The test report has an invalid count.', { internal: { field } })
  return value
}

function freePort(): Promise<number> {
  const server = net.createServer()
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolvePort(server, resolve, reject))
  })
}

function resolvePort(
  server: net.Server,
  resolve: (port: number) => void,
  reject: (error: unknown) => void,
) {
  const address = server.address()
  if (!address || typeof address === 'string') {
    server.close()
    reject(
      createScriptError('The browser test could not reserve a loopback port.', {
        internal: { addressType: typeof address },
      }),
    )
    return
  }
  server.close(() => resolve(address.port))
}

if (import.meta.main) await main()
