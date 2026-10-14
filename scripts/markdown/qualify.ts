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

const ROOT = path.resolve(import.meta.dirname, '../..')
const SUITES = ['parity', 'stream', 'visual', 'bench', 'qualify'] as const
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
      'promotion-receipts': { type: 'string' },
      'evaluation-receipt': { type: 'string' },
      'evaluation-ledger': { type: 'string' },
      help: { type: 'boolean' },
    },
  })
  if (values.help) {
    process.stdout.write(
      'bun scripts/markdown/qualify.ts parity|stream|visual|bench|qualify --out DIRECTORY [--baseline|--candidate] [--inspect-only] [--promotion-receipts JSON --evaluation-receipt JSON --evaluation-ledger DIRECTORY]\nDefault runs paired engines. Availability inspection executes actual native/adapter probes; readiness requires complete trusted promotion receipts. Native source timings remain exploratory.\n',
    )
    return
  }
  const suite = SUITES.find((entry) => entry === positionals[0])
  if (!suite || !values.out)
    throw createScriptError('Choose a Markdown suite and --out DIRECTORY.', {
      internal: { arguments: positionals.length },
    })
  const mode = qualificationMode(values)
  const output = path.resolve(values.out)
  await mkdir(output, { recursive: true })
  const rows = baselineRows()
  await writeFile(path.join(output, 'baseline-checks.json'), `${JSON.stringify(rows, null, 2)}\n`)
  const candidate = await inspectCandidate(ROOT)
  const provenance = await qualificationProvenance(ROOT)
  const runs = values['inspect-only'] ? [] : await runSuites(suite, output, mode)
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
  const report = {
    schemaVersion: 1,
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
  const failedRuns = runs.some((run) => run.exitCode !== 0)
  process.stdout.write(
    `${JSON.stringify({ evidence: output, verdict: promotion.verdict, checks: promotion.counts, testRuns: runs.map(({ name, exitCode, tests }) => ({ name, exitCode, tests })) })}\n`,
  )
  process.exitCode = failedRuns || (mode !== 'baseline' && promotion.verdict !== 'VERIFIED') ? 1 : 0
}

async function runSuites(
  suite: Suite,
  output: string,
  mode: QualificationMode,
): Promise<TestRun[]> {
  const runs: TestRun[] = []
  for (const plan of qualificationTestPlan(suite, mode)) {
    runs.push(await runTests(plan.name, plan.directory, plan.flags, output, plan.browser))
  }
  if (suite === 'bench' || suite === 'qualify') {
    if (mode !== 'baseline') {
      const { runPairedNative } = await import('./paired-native')
      const report = await runPairedNative({ mode: 'quick' })
      await writeFile(
        path.join(output, 'paired-native.json'),
        `${JSON.stringify(report, null, 2)}\n`,
      )
      if (report.status === 'FAILED')
        runs.push({
          name: 'paired-native-output',
          exitCode: 1,
          tests: report.workloads.reduce((sum, entry) => sum + entry.pairs.length, 0),
          passed: 0,
          failed: 1,
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
        tests: paired.compared.length,
        passed: paired.compared.filter((pair) => pair.status === 'passed').length,
        failed: paired.status === 'passed' ? 0 : 1,
        pending: 0,
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
      tests: raster.images.length,
      passed: raster.images.filter((image) => image.status === 'passed').length,
      failed: completeMatrix
        ? raster.images.filter((image) => image.status === 'failed').length
        : 1,
      pending: 0,
      todo: 0,
      log: path.join(output, 'raster.json'),
    })
  }
  return runs
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

export function qualificationTestPlan(suite: Suite, mode: QualificationMode) {
  const engines =
    mode === 'paired' ? ['remark', 'tree-sitter'] : [mode === 'baseline' ? 'remark' : 'tree-sitter']
  const selected =
    mode === 'candidate' && (suite === 'visual' || suite === 'qualify')
      ? ['remark', 'tree-sitter']
      : engines
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
    if (suite === 'visual' || suite === 'stream' || suite === 'bench' || suite === 'qualify')
      plans.push({
        name: `browser-${engine}-${suite}`,
        directory: 'apps/web',
        flags: [
          '--config',
          'vitest.markdown-qualification.config.ts',
          '--mode',
          engine === 'tree-sitter' ? 'candidate' : 'baseline',
          browserFilter(suite),
        ],
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

function browserFilter(suite: Suite): string {
  if (suite === 'visual') return 'qualification.browser.tsx'
  if (suite === 'stream') return 'qualification-stream'
  if (suite === 'bench') return 'qualification-bench'
  return 'qualification'
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
    env.VITEST_BROWSER_PORT = String(await freePort())
    env.VITEST_BROWSER_FILE_SERVER_PORT = String(await freePort())
  }
  const args = ['node', path.join(ROOT, 'node_modules/vitest/vitest.mjs'), 'run'].concat(flags, [
    '--reporter=default',
    '--reporter=json',
    `--outputFile=${jsonFile}`,
  ])
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
    exitCode:
      result.numPassedTests + result.numFailedTests > 0 && result.numTotalTests > 0 ? exitCode : 1,
    tests: result.numTotalTests,
    passed: result.numPassedTests,
    failed: result.numFailedTests,
    pending: result.numPendingTests,
    todo: result.numTodoTests,
    log,
  }
}

async function readTestResult(file: string) {
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
  const accounted =
    counts.numPassedTests + counts.numFailedTests + counts.numPendingTests + counts.numTodoTests
  if (accounted > counts.numTotalTests)
    throw createScriptError('The test report has inconsistent counts.', {
      internal: { total: counts.numTotalTests, accounted },
    })
  return counts
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
