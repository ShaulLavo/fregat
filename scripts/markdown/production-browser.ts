import { createHash } from 'node:crypto'
import { access, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'
import { chromium, webkit, type Browser, type Page } from 'playwright'

import type {
  ProductionMarkdownReceipt,
  ProductionTimingReceipt,
} from '../../apps/web/test/factories/markdown-production-types'
import { startProductionCdp } from './production-cdp.ts'
import { fixedChunks, mixedWorkload } from './workloads.ts'
import { createScriptError } from '../structured-errors.ts'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const WEB = path.join(ROOT, 'apps/web')
const ENGINES = ['remark', 'tree-sitter'] as const
type Engine = (typeof ENGINES)[number]

type Trial = {
  readonly pair: number
  readonly order: 'AB' | 'BA'
  readonly engine: Engine
  readonly cache: 'cold' | 'warm'
  readonly navigationMs: number
  readonly initializationMs: number
  readonly receipt: ProductionTimingReceipt
  readonly correctness: ProductionMarkdownReceipt
  readonly cpu: { readonly before: unknown; readonly after: unknown } | null
}

export async function buildMarkdownProductionProbe(output: string) {
  const { build, loadConfigFromFile } = await import('vite')
  const loaded = await loadConfigFromFile(
    { command: 'build', mode: 'production' },
    path.join(WEB, 'vite.config.ts'),
    WEB,
  )
  if (!loaded) throw createScriptError('The production web configuration did not load.')
  await build({
    ...loaded.config,
    configFile: false,
    root: WEB,
    mode: 'production',
    define: {
      ...loaded.config.define,
      'import.meta.env.VITE_SERVER_URL': 'undefined',
    },
    build: {
      ...loaded.config.build,
      outDir: path.resolve(output),
      emptyOutDir: true,
      manifest: true,
      sourcemap: true,
      rollupOptions: {
        input: path.join(WEB, 'test/markdown-production.html'),
      },
    },
  })
  const assets = await readdir(path.join(output, 'assets'))
  const wasm = await Promise.all(
    assets
      .filter((file) => file.endsWith('.wasm'))
      .map(async (file) => {
        const bytes = await readFile(path.join(output, 'assets', file))
        return {
          file,
          bytes: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex'),
        }
      }),
  )
  await writeFile(
    path.join(output, 'markdown-probe-build.json'),
    JSON.stringify({ wasm }, null, 2) + '\n',
  )
}

export async function runProductionMarkdownPairs({
  url,
  output,
  trials = 20,
  browserName = 'chromium',
  source = mixedWorkload(2048).source,
}: {
  readonly url: string
  readonly output: string
  readonly trials?: number
  readonly browserName?: 'chromium' | 'webkit'
  readonly source?: string
}) {
  await mkdir(output, { recursive: true })
  const browser = await (browserName === 'webkit' ? webkit : chromium).launch({ headless: true })
  let results: Trial[] = []
  const failures: string[] = []
  const interrupt = () => {
    void browser.close()
  }
  process.once('SIGINT', interrupt)
  process.once('SIGTERM', interrupt)
  try {
    for (let pair = 0; pair < trials; pair += 1) {
      const order = pair % 2 === 0 ? 'AB' : 'BA'
      try {
        results = results.concat(await onePair({ browser, url, pair, order, source, output }))
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error))
        break
      }
      comparePair(
        results.filter((trial) => trial.pair === pair),
        failures,
      )
    }
  } finally {
    process.removeListener('SIGINT', interrupt)
    process.removeListener('SIGTERM', interrupt)
    await browser.close()
  }
  const report = {
    schemaVersion: 1,
    build: 'production',
    timingStatus: 'EXPLORATORY',
    verdict: failures.length > 0 ? 'NOT VERIFIED' : 'INCONCLUSIVE',
    browser: browserName,
    trials,
    sourceBytes: Buffer.byteLength(source),
    sourceSha256: digest(source),
    schedule: 'fixed-24-UTF16',
    rawTrials: results,
    failures,
    missing: [
      'paired confidence intervals and quiet-host qualification',
      'worker CPU and exact main-thread CPU attribution',
      'fully ready highlighting/math/image observation',
      'real virtualized timeline, typing, selection and follow/held-scroll probes',
      'JS live heap, native document allocation counts and WASM high-water reuse',
      'pathological, reference-invalidation and resource workload families',
    ],
  }
  await mkdir(output, { recursive: true })
  await writeFile(
    path.join(output, 'production-browser.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  )
  await writeFile(
    path.join(output, 'raw-production-trials.jsonl'),
    results.map((trial) => JSON.stringify(trial)).join('\n') + '\n',
  )
  return report
}

async function onePair({
  browser,
  url,
  pair,
  order,
  source,
  output,
}: {
  readonly browser: Browser
  readonly url: string
  readonly pair: number
  readonly order: 'AB' | 'BA'
  readonly source: string
  readonly output: string
}) {
  const results: Trial[] = []
  const engines = order === 'AB' ? ENGINES : ENGINES.toReversed()
  for (const engine of engines) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      colorScheme: 'dark',
    })
    try {
      const page = await context.newPage()
      results.push(
        await oneTrial({
          page,
          engine,
          url,
          pair,
          order,
          cache: 'cold',
          source,
          cdp: browser.browserType().name() === 'chromium',
          output,
        }),
      )
      results.push(
        await oneTrial({
          page,
          engine,
          url,
          pair,
          order,
          cache: 'warm',
          source,
          cdp: browser.browserType().name() === 'chromium',
          output,
        }),
      )
      await page.evaluate(() => window.markdownProductionProbe.dispose())
    } finally {
      await context.close()
    }
  }
  return results
}

async function oneTrial({
  page,
  engine,
  url,
  pair,
  order,
  cache,
  source,
  cdp,
  output,
}: {
  readonly page: Page
  readonly engine: Engine
  readonly url: string
  readonly pair: number
  readonly order: 'AB' | 'BA'
  readonly cache: 'cold' | 'warm'
  readonly source: string
  readonly cdp: boolean
  readonly output: string
}): Promise<Trial> {
  const errors: string[] = []
  const consoleMessages: { type: string; text: string }[] = []
  const onError = (error: Error) => {
    errors.push(error.message)
    process.stderr.write(`Production probe page error: ${error.message}\n`)
  }
  const onConsole = (message: import('playwright').ConsoleMessage) => {
    consoleMessages.push({ type: message.type(), text: message.text() })
  }
  page.on('pageerror', onError)
  page.on('console', onConsole)
  const target = new URL(url)
  target.searchParams.set('engine', engine)
  const started = performance.now()
  const instrumentation = cdp ? await startProductionCdp(page) : null
  try {
    if (cache === 'cold') await page.goto(target.href, { waitUntil: 'load' })
    await page.waitForFunction(() => Boolean(window.markdownProductionProbe))
    const initialized = await withDeadline(
      page.evaluate(async () => {
        return await window.markdownProductionProbe.ready
      }),
      'parser initialization',
    )
    const navigationMs = cache === 'cold' ? performance.now() - started : 0
    const chunks = Array.from(fixedChunks(source, 24), (frame) => frame.text)
    const cpuBefore = await instrumentation?.read()
    const receipt: ProductionTimingReceipt = await withDeadline(
      page.evaluate(
        async ({ source, chunks }) => {
          return await window.markdownProductionProbe.time(source, chunks)
        },
        { source, chunks },
      ),
      'timing replay',
    )
    const cpuAfter = await instrumentation?.read()
    const correctness = await withDeadline(
      page.evaluate(
        async ({ source, chunks }) => await window.markdownProductionProbe.run(source, chunks),
        { source, chunks },
      ),
      'correctness replay',
    )
    if (errors.length > 0)
      throw createScriptError('The production Markdown probe reported a page error.', {
        internal: { errors: errors.length, engine, pair },
      })
    if (initialized.engine !== engine)
      throw createScriptError('The production Markdown probe selected another parser.', {
        internal: { engine, pair },
      })
    return {
      pair,
      order,
      engine,
      cache,
      navigationMs,
      initializationMs: initialized.initializationMs,
      receipt,
      correctness,
      cpu: instrumentation ? { before: cpuBefore, after: cpuAfter } : null,
    }
  } catch (error) {
    const prefix = path.join(output, `failure-${pair}-${engine}-${cache}`)
    await writeFile(`${prefix}.json`, JSON.stringify({ errors, consoleMessages }, null, 2) + '\n')
    await Promise.allSettled([
      page.screenshot({ path: `${prefix}.png`, timeout: 5000 }),
      withDeadline(page.content(), 'failure DOM capture', 5000).then((html) =>
        writeFile(`${prefix}.html`, html),
      ),
    ])
    throw error
  } finally {
    page.removeListener('pageerror', onError)
    page.removeListener('console', onConsole)
    await instrumentation?.close()
  }
}

async function withDeadline<T>(promise: Promise<T>, operation: string, milliseconds = 45_000) {
  let timer: ReturnType<typeof setTimeout> | undefined
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          createScriptError('The production probe timed out.', {
            internal: { operation, milliseconds },
          }),
        ),
      milliseconds,
    )
  })
  try {
    return await Promise.race([promise, expired])
  } finally {
    clearTimeout(timer)
  }
}

function comparePair(trials: readonly Trial[], failures: string[]) {
  for (const cache of ['cold', 'warm']) {
    const baseline = trials.find((trial) => trial.engine === 'remark' && trial.cache === cache)
    const candidate = trials.find(
      (trial) => trial.engine === 'tree-sitter' && trial.cache === cache,
    )
    if (!baseline || !candidate) {
      failures.push(`${cache}: a paired trial is missing`)
      continue
    }
    const first = baseline.correctness.final
    const second = candidate.correctness.final
    const same =
      JSON.stringify({ text: first.text, elements: first.elements }) ===
      JSON.stringify({ text: second.text, elements: second.elements })
    if (!same) failures.push(`pair ${baseline.pair} ${cache}: completed DOM projections differ`)
    if (first.text.length === 0 || second.text.length === 0)
      failures.push(`pair ${baseline.pair} ${cache}: completed projection is empty`)
    if (baseline.receipt.frames.length !== candidate.receipt.frames.length)
      failures.push(`pair ${baseline.pair} ${cache}: update coverage differs`)
  }
}

function digest(source: string) {
  return createHash('sha256').update(source).digest('hex')
}

export async function main() {
  const { values } = parseArgs({
    options: {
      url: { type: 'string' },
      out: { type: 'string' },
      build: { type: 'string' },
      directory: { type: 'string' },
      port: { type: 'string' },
      trials: { type: 'string', default: '20' },
      browser: { type: 'string', default: 'chromium' },
    },
  })
  if (values.build) await buildMarkdownProductionProbe(values.build)
  if (!values.url && !values.directory) return
  if (!values.out) throw createScriptError('Choose an output directory for the production probe.')
  const trials = Number(values.trials)
  if (!Number.isInteger(trials) || trials < 1)
    throw createScriptError('The production trial count must be a positive integer.')
  const browserName = values.browser === 'webkit' ? 'webkit' : 'chromium'
  const port = Number(values.port)
  if (values.directory && (!Number.isInteger(port) || port < 1 || port > 65535))
    throw createScriptError('Choose an explicit free loopback port for the production probe.', {
      internal: { boundary: 'production-port' },
    })
  await mkdir(values.out, { recursive: true })
  const gateway = values.directory
    ? await (
        await import('./production-server.ts')
      ).serveMarkdownProductionProbe(values.directory, port)
    : null
  let report: Awaited<ReturnType<typeof runProductionMarkdownPairs>>
  try {
    await writeFile(
      path.join(values.out, 'resource-ownership.json'),
      JSON.stringify(
        {
          pid: process.pid,
          created: gateway?.resources ?? null,
          browser: 'owned Playwright launch',
          preserved: 'all pre-existing services and caches',
        },
        null,
        2,
      ) + '\n',
    )
    report = await runProductionMarkdownPairs({
      url: values.url ?? gateway?.url ?? '',
      output: values.out,
      trials,
      browserName,
    })
  } finally {
    await gateway?.close()
    if (gateway)
      await writeFile(
        path.join(values.out, 'cleanup.json'),
        JSON.stringify(
          {
            workspaceAbsent: await absent(gateway.resources.workspace),
            stateHomeAbsent: await absent(gateway.resources.stateHome),
            listenerStopped: true,
          },
          null,
          2,
        ) + '\n',
      )
  }
  process.stdout.write(
    JSON.stringify({ verdict: report.verdict, failures: report.failures.length }) + '\n',
  )
  if (report.failures.length > 0) process.exitCode = 1
}

async function absent(file: string) {
  try {
    await access(file)
    return false
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
      return true
    throw error
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await main()
