import type {} from './src/geometry.ts'
import type { Browser } from '@playwright/test'
import type { Route, CDPSession, Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { chromium } from '@playwright/test'
import { build } from 'vite'
import { loadCorePackage } from './core-package.ts'
import { fail } from './errors.ts'

// E036 step 1: row geometry path mix and measured-path cost per click, caret move and keystroke.
// Each fixture runs one counting pass (diagnostics and rect-read counters on) and `repetitions`
// timing passes (both off), every pass in a fresh browser context.
const root = dirname(fileURLToPath(import.meta.url))
const { values } = parseArgs({
  options: {
    output: { type: 'string' },
    fixtures: {
      type: 'string',
      default: 'go-tabs,go-spaces,go-tabs-long,go-spaces-long,markdown,unicode',
    },
    repetitions: { type: 'string', default: '3' },
    'font-check': { type: 'string' },
    'core-directory': { type: 'string', default: resolve(root, '../../packages/editor') },
  },
})
if (!values.output) fail('--output is required')
const fixtures = values.fixtures.split(',')
function isFixture(fixture: string): fixture is GeometryFixture {
  return ['go-tabs', 'go-spaces', 'go-tabs-long', 'go-spaces-long', 'markdown', 'unicode'].includes(
    fixture,
  )
}
if (!fixtures.every(isFixture)) fail('Invalid geometry fixture')
const repetitions = Number(values.repetitions)
if (!Number.isSafeInteger(repetitions) || repetitions < 1) fail('Invalid repetitions')
const workloads = ['click', 'arrow-down', 'arrow-right', 'typing']
const viewport = { width: 1000, height: 700 }
const metricNames = [
  'LayoutCount',
  'RecalcStyleCount',
  'LayoutDuration',
  'RecalcStyleDuration',
  'ScriptDuration',
  'TaskDuration',
]

await mkdir('/work/tmp', { recursive: true })
const directory = await mkdtemp('/work/tmp/editor-e036-build-')
const core = await loadCorePackage(values['core-directory'])
const git = (args: readonly string[]) =>
  execFileSync('git', args, { cwd: core.directory, encoding: 'utf8' })
let browser: Browser | undefined
type GeometryFixture = Parameters<typeof __geometry.open>[0]
type Run = Awaited<ReturnType<typeof run>>
type Pass = Awaited<ReturnType<typeof pass>>
type FixtureResult = {
  fixture: string
  rowMix: Pass['rowMix']
  counting: Pass
  timing: ReturnType<typeof mergeTiming>
}
const result: {
  commit: string
  dirtyFiles: number
  repetitions: number
  viewport: typeof viewport
  fixtures: FixtureResult[]
  browser?: string
  fonts?: Awaited<ReturnType<typeof fontCheck>>[]
} = {
  commit: git(['rev-parse', 'HEAD']).trim(),
  dirtyFiles: git(['status', '--short']).split('\n').filter(Boolean).length,
  repetitions,
  viewport,
  fixtures: [],
}
try {
  await build({
    root,
    configFile: false,
    logLevel: 'error',
    resolve: { alias: core.aliases },
    worker: { format: 'es' },
    build: { outDir: directory, rolldownOptions: { input: resolve(root, 'geometry.html') } },
  })
  browser = await chromium.launch({ headless: true, env: { ...process.env, TMPDIR: directory } })
  result.browser = activeBrowser().version()
  if (values['font-check']) {
    result.fonts = []
    for (const font of values['font-check'].split(',')) result.fonts.push(await fontCheck(font))
    fixtures.length = 0
  }
  for (const fixture of fixtures) {
    const counting = await pass(fixture, true)
    const timing = []
    for (let repetition = 0; repetition < repetitions; repetition++)
      timing.push(await pass(fixture, false))
    const row = { fixture, rowMix: counting.rowMix, counting, timing: mergeTiming(timing) }
    result.fixtures.push(row)
    console.log(JSON.stringify(summary(row)))
  }
  await mkdir(dirname(resolve(values.output)), { recursive: true })
  await writeFile(values.output, JSON.stringify(result, null, 2) + '\n')
  await writeFile(
    values.output.replace(/\.json$/, '') + '.summary.json',
    JSON.stringify(result.fixtures.map(summary), null, 2) + '\n',
  )
} finally {
  await browser?.close()
  await rm(directory, { recursive: true, force: true })
}

async function asset(route: Route) {
  const path = resolve(directory, '.' + new URL(route.request().url()).pathname)
  if (!path.startsWith(directory + sep)) return route.abort()
  const types: Record<string, string> = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
  }
  await route.fulfill({
    body: await readFile(path),
    contentType: types[extname(path)] ?? 'application/octet-stream',
  })
}

async function pass(fixture: GeometryFixture, diagnostics: boolean) {
  const context = await activeBrowser().newContext({ viewport })
  const errors: string[] = []
  try {
    await context.route('http://geometry.local/**', asset)
    const page = await context.newPage()
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto('http://geometry.local/geometry.html')
    const cdp = await context.newCDPSession(page)
    await cdp.send('Performance.enable')
    const open = await page.evaluate(
      ({ fixture, diagnostics }) => __geometry.open(fixture, diagnostics),
      { fixture, diagnostics },
    )
    await page.evaluate(() => __geometry.settle())
    if (fixture === 'markdown')
      await page.locator('#view-0 .editor-inline-marker').first().waitFor({ timeout: 10_000 })
    if (diagnostics) await page.screenshot({ path: `${values.output}.${fixture}.png` })
    const rowMix = await page.evaluate(() => __geometry.rowMix())
    const runs: Record<string, Run> = {}
    for (const workload of workloads) runs[workload] = await run(page, cdp, workload)
    await page.evaluate(() => __geometry.dispose())
    if (errors.length) fail(`Browser errors (${fixture}): ${errors.join('; ')}`)
    return { open, rowMix, runs }
  } finally {
    await context.close()
  }
}

async function fontCheck(font: string) {
  const context = await activeBrowser().newContext({ viewport })
  try {
    await context.route('http://geometry.local/**', asset)
    const page = await context.newPage()
    await page.goto('http://geometry.local/geometry.html')
    await page.evaluate(
      (font: string | undefined) => __geometry.open('go-spaces', false, font),
      font,
    )
    await page.evaluate(() => __geometry.settle())
    await page.screenshot({ path: `${values.output}.font-${font.replace(/\W+/g, '_')}.png` })
    const errors = await page.evaluate(() => __geometry.hitTestErrors())
    const probe = await page.evaluate((font: string) => __geometry.monospaceProbeCost(font), font)
    const row = { font, ...errors, probe }
    console.log(JSON.stringify(row))
    return row
  } finally {
    await context.close()
  }
}

async function metrics(cdp: CDPSession) {
  const { metrics } = await cdp.send('Performance.getMetrics')
  return Object.fromEntries(
    metrics
      .filter((metric: { name: string }) => metricNames.includes(metric.name))
      .map((m) => [m.name, m.value]),
  )
}

async function frames(page: Page) {
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  )
  await page.evaluate(() => __geometry.settle())
}

/** Puts the caret on a mounted row without counting it, then runs the workload's input. */
async function run(page: Page, cdp: CDPSession, workload: string) {
  await page.mouse.move(450, 300)
  await page.mouse.wheel(0, -100_000)
  await frames(page)
  const points = await page.evaluate(() => __geometry.rowPoints())
  if (points.length < 20) fail(`Only ${points.length} rows mounted`)
  if (workload !== 'click') {
    const row = points[4]
    await page.mouse.click(row.left + 200, (row.top + row.bottom) / 2)
    if (workload === 'arrow-right') await page.keyboard.press('Home')
    if (workload === 'typing') await page.keyboard.press('End')
    await frames(page)
  }
  const before = await metrics(cdp)
  await page.evaluate(() => __geometry.begin())
  const operations = await drive(page, workload)
  await frames(page)
  const after = await metrics(cdp)
  const taken = await page.evaluate(() => __geometry.take())
  const layout = Object.fromEntries(metricNames.map((name) => [name, after[name] - before[name]]))
  const inputs = taken.events.flatMap((event) =>
    event.appliedAt === null ? [] : [{ ...event, appliedAt: event.appliedAt }],
  )
  return {
    operations,
    applied: inputs.length,
    counts: taken.counts,
    layout,
    inputToApplied: inputs.map((event) => event.appliedAt - event.at),
    dispatchToApplied: inputs.map((event) => event.appliedAt - event.dispatchAt),
    inputToFrame: inputs.flatMap((event) =>
      event.frameAt === null ? [] : [event.frameAt - event.at],
    ),
  }
}

async function drive(page: Page, workload: string) {
  if (workload === 'arrow-down' || workload === 'arrow-right') {
    const key = workload === 'arrow-down' ? 'ArrowDown' : 'ArrowRight'
    for (let index = 0; index < 60; index++) await page.keyboard.press(key)
    return 60
  }
  if (workload === 'typing') {
    await page.keyboard.type('x'.repeat(24))
    return 24
  }
  let operations = 0
  for (let screen = 0; screen < 3; screen++) {
    const rows = await page.evaluate(() => __geometry.rowPoints())
    for (let index = 0; index < 20; index++) {
      const row = rows[index]
      await page.mouse.click(row.left + 20 + ((index * 53) % 420) + 0.5, (row.top + row.bottom) / 2)
      operations += 1
    }
    await page.mouse.move(450, 300)
    await page.mouse.wheel(0, 1200)
    await frames(page)
  }
  return operations
}

function mergeTiming(passes: readonly Pass[]): Record<string, Omit<Run, 'counts'>> {
  const merged: Record<string, Omit<Run, 'counts'>> = {}
  for (const workload of workloads) {
    const runs = passes.map((pass) => pass.runs[workload])
    merged[workload] = {
      operations: runs.reduce((sum, run) => sum + run.operations, 0),
      applied: runs.reduce((sum, run) => sum + run.applied, 0),
      layout: Object.fromEntries(
        metricNames.map((name) => [name, runs.reduce((sum, run) => sum + run.layout[name], 0)]),
      ),
      inputToApplied: runs.flatMap((run) => run.inputToApplied),
      dispatchToApplied: runs.flatMap((run) => run.dispatchToApplied),
      inputToFrame: runs.flatMap((run) => run.inputToFrame),
    }
  }
  return merged
}

function summary(row: FixtureResult) {
  const workloadSummary: Record<string, unknown> = {}
  for (const workload of workloads) {
    const counted = row.counting.runs[workload]
    const timed = row.timing[workload]
    const per = (value: number, operations: number) => round(value / operations)
    workloadSummary[workload] = {
      operations: counted.operations,
      buildsPerOp: Object.fromEntries(
        Object.entries(counted.counts.builds).map(([path, value]) => [
          path,
          per(value, counted.operations),
        ]),
      ),
      sweepsPerOp: per(counted.counts.sweeps, counted.operations),
      sweptBoundariesPerOp: per(counted.counts.sweptBoundaries, counted.operations),
      rectReadsPerOp: per(counted.counts.rectReads, counted.operations),
      layoutsPerOp: per(timed.layout.LayoutCount, timed.operations),
      layoutMsPerOp: per(timed.layout.LayoutDuration * 1000, timed.operations),
      scriptMsPerOp: per(timed.layout.ScriptDuration * 1000, timed.operations),
      taskMsPerOp: per(timed.layout.TaskDuration * 1000, timed.operations),
      appliedMean: round(mean(timed.dispatchToApplied)),
      appliedP50: round(quantile(timed.dispatchToApplied, 0.5)),
      appliedP95: round(quantile(timed.dispatchToApplied, 0.95)),
      frameP50: round(quantile(timed.inputToFrame, 0.5)),
      frameP95: round(quantile(timed.inputToFrame, 0.95)),
      appliedRatio: round(timed.applied / timed.operations),
    }
  }
  return { fixture: row.fixture, rowMix: row.rowMix, workloads: workloadSummary }
}

function mean(values: readonly number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null
}

function quantile(values: number[], q: number) {
  if (!values.length) return null
  const sorted = values.toSorted((left: number, right: number) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]
}

function round(value: number | null) {
  return value === null ? null : Math.round(value * 1000) / 1000
}

function activeBrowser(): Browser {
  if (!browser) fail('Browser has not started')
  return browser
}
