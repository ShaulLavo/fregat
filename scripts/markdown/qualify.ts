import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { baselineRows, inspectCandidate, promotionVerdict } from './report'
import { qualificationProvenance } from './provenance'
import { inspectRasterEvidence } from './raster'
import { createScriptError } from '../structured-errors'

const ROOT = path.resolve(import.meta.dirname, '../..')
const SUITES = ['parity', 'stream', 'visual', 'bench', 'qualify'] as const
type Suite = (typeof SUITES)[number]

type TestRun = {
  readonly name: string
  readonly exitCode: number
  readonly tests: number
  readonly passed: number
  readonly failed: number
  readonly log: string
}

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { out: { type: 'string' }, baseline: { type: 'boolean' }, help: { type: 'boolean' } },
  })
  if (values.help) {
    process.stdout.write(
      'bun scripts/markdown/qualify.ts parity|stream|visual|bench|qualify --out DIRECTORY [--baseline]\nBaseline reports preserve known defects. Qualification exits nonzero until candidate and evaluation gates pass.\n',
    )
    return
  }
  const suite = SUITES.find((entry) => entry === positionals[0])
  if (!suite || !values.out)
    throw createScriptError('Choose a Markdown suite and --out DIRECTORY.', {
      internal: { arguments: positionals.length },
    })
  const output = path.resolve(values.out)
  await mkdir(output, { recursive: true })
  const rows = baselineRows()
  await writeFile(path.join(output, 'baseline-checks.json'), `${JSON.stringify(rows, null, 2)}\n`)
  const candidate = await inspectCandidate(ROOT)
  const provenance = await qualificationProvenance(ROOT)
  const runs = await runSuites(suite, output)
  const browser = runs.some((run) => run.name.startsWith('browser-'))
  const promotion = promotionVerdict(rows, browser)
  const report = {
    schemaVersion: 1,
    suite,
    generatedAt: new Date().toISOString(),
    scope: values.baseline ? 'baseline' : 'qualification',
    candidate,
    provenance,
    promotion,
    runs,
  }
  await writeFile(path.join(output, 'qualification.json'), `${JSON.stringify(report, null, 2)}\n`)
  const failedRuns = runs.some((run) => run.exitCode !== 0)
  process.stdout.write(
    `${JSON.stringify({ evidence: output, verdict: promotion.verdict, checks: promotion.counts, testRuns: runs.map(({ name, exitCode, tests }) => ({ name, exitCode, tests })) })}\n`,
  )
  process.exitCode = failedRuns || !values.baseline ? 1 : 0
}

async function runSuites(suite: Suite, output: string): Promise<TestRun[]> {
  const runs: TestRun[] = []
  if (suite === 'parity' || suite === 'stream' || suite === 'qualify') {
    const filter = suite === 'stream' ? 'qualification-stream' : 'qualification'
    runs.push(await runTests('package', 'packages/markdown', ['--project', 'node', filter], output))
  }
  if (suite === 'visual' || suite === 'stream' || suite === 'bench' || suite === 'qualify') {
    const filter = browserFilter(suite)
    runs.push(
      await runTests(
        `browser-${suite}`,
        'apps/web',
        ['--config', 'vitest.browser.config.ts', filter],
        output,
        true,
      ),
    )
  }
  if (suite === 'bench' || suite === 'qualify') {
    const { runMarkdownBenchmarks } = await import('./bench')
    const log = runs.find((run) => run.name.startsWith('browser-'))?.log
    const browserLog = log ? await readFile(log, 'utf8') : undefined
    const report = await runMarkdownBenchmarks({ mode: 'quick', browserLog })
    const { rawSamples, ...summary } = report
    await writeFile(path.join(output, 'benchmark.json'), `${JSON.stringify(summary, null, 2)}\n`)
    await writeFile(
      path.join(output, 'raw-samples.jsonl'),
      rawSamples.map((sample) => JSON.stringify(sample)).join('\n') + '\n',
    )
    if (report.families.some((family) => family.status === 'FAILED')) {
      runs.push({
        name: 'benchmark-output',
        exitCode: 1,
        tests: report.rawSamples.length,
        passed: 0,
        failed: 1,
        log: path.join(output, 'benchmark.json'),
      })
    }
  }
  if (suite === 'visual' || suite === 'qualify') {
    const log = runs.find((run) => run.name.startsWith('browser-'))?.log
    const raster = await inspectRasterEvidence(log ? await readFile(log, 'utf8') : '', ROOT, output)
    await writeFile(path.join(output, 'raster.json'), `${JSON.stringify(raster, null, 2)}\n`)
    const completeMatrix = raster.images.length === 128 && raster.calibration.length === 4
    runs.push({
      name: 'raster-controls',
      exitCode: raster.status === 'passed' && completeMatrix ? 0 : 1,
      tests: raster.images.length,
      passed: raster.images.filter((image) => image.status === 'passed').length,
      failed: completeMatrix
        ? raster.images.filter((image) => image.status === 'failed').length
        : 1,
      log: path.join(output, 'raster.json'),
    })
  }
  return runs
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
    exitCode: result.numTotalTests > 0 ? exitCode : 1,
    tests: result.numTotalTests,
    passed: result.numPassedTests,
    failed: result.numFailedTests,
    log,
  }
}

async function readTestResult(file: string) {
  const content = await Bun.file(file).exists()
  if (!content) return { numTotalTests: 0, numPassedTests: 0, numFailedTests: 0 }
  return parseTestCounts(JSON.parse(await readFile(file, 'utf8')))
}

export function parseTestCounts(value: unknown) {
  if (!value || typeof value !== 'object')
    throw createScriptError('The test report has an invalid shape.', {
      internal: { field: 'report' },
    })
  return {
    numTotalTests: testCount(value, 'numTotalTests'),
    numPassedTests: testCount(value, 'numPassedTests'),
    numFailedTests: testCount(value, 'numFailedTests'),
  }
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
