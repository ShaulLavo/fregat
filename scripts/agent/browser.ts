#!/usr/bin/env bun
import { copyFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { parseArgs } from 'node:util'
import type { Browser, Page } from 'playwright'

import { createEvidence, type Evidence } from './evidence'
import { formatLogEvent, readLogs } from './logs'
import { attachObserver, observedProblems, serializable } from './observe.mjs'
import { scenarioNamed, scenarios, type Scenario } from './scenarios/index'
import { waitForApp } from './selectors'
import { compareTraceSummaries, formatTraceSummary, summarizeTrace } from './trace-summary'
import { captureTraceSources } from './trace-source-maps'
import { captureSize, type CaptureSize } from './capture-options'
import {
  openStaticPreview,
  routeStaticPreview,
  staticPreviewLayout,
  STATIC_PREVIEW_URL,
} from './static-preview'
import { alignProductWallpaper, routeProductWallpaper } from './product-wallpaper'
import { createScriptError } from '../structured-errors'
import { isolateProductTerminals } from './product-terminal'
import { captureBrowserRenderer } from './browser-renderer'
import { startIsolatedServer, type IsolatedServer } from './isolated-server'
import { devStateHome } from '../state-home'

const PRODUCT_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36'
const DEFAULT_URL = `http://localhost:${process.env.WEB_PORT ?? '5173'}/`
const DEFAULT_FILE = 'use-events.ts'
const DEFAULT_WORKSPACE = 'work/projects/platform'
const HELP = `bun run agent:browser <verb> [options]

Verbs
  look [--url U] [--selector S] [--doctor]   open, wait for ready, screenshot, report errors
  scenario <name> [--url U] [--file F]        drive a named scenario with a screenshot per step
  trace <name> [--compare DIR]                record a Chrome trace around a scenario and summarise it
  renders <name>                              count component renders during a scenario (bippy)
  caches [--url U]                            dump every query and mutation in the page's query clients
  list                                        print the scenario names

Options
  --url        page to open (default: the dev server, ${DEFAULT_URL})
  --file       file name a scenario opens through the command palette (default: ${DEFAULT_FILE})
  --workspace  root-relative folder to open when the URL names no workspace (default: ${DEFAULT_WORKSPACE})
  --selector   CSS selector to screenshot in addition to the page
  --no-console omit console listeners for a capture-overhead control
  --headed     show the browser
  --engine     chromium (default), firefox or webkit; trace needs chromium
  --doctor     exit non-zero when the app is not healthy
  --compare    an earlier trace evidence directory to diff against
  --site       check a landing page document instead of app readiness (look)
  --static-dir serve built assets through browser routes for look, without a server
  --width      viewport width, 320–4096 CSS pixels (look/scenario)
  --height     viewport height, 240–4096 CSS pixels (look/scenario)
  --scale      device pixel ratio, 1–3 (look/scenario)
  --product-wallpaper image override for a real product scenario capture
  --shared-dev drive the running dev API server instead of a throwaway one

Against the dev page, every run starts its own API server with temp state and removes it after.
scenario, trace and renders refuse a production URL unless the scenario is declared readOnly.
Evidence lands under /work/tmp/fregat-evidence/<stamp>-<verb>-<label>/.`

type Options = CaptureSize & {
  readonly consoleCapture: boolean
  readonly site: boolean
  readonly productCapture: boolean
  readonly staticDir: string | undefined
  readonly productWallpaper: string | undefined
  readonly compare: string | undefined
  readonly doctor: boolean
  readonly engine: Engine
  readonly file: string
  readonly headed: boolean
  readonly selector: string | undefined
  readonly url: string
  readonly workspace: string
  readonly server?: IsolatedServer
  readonly notifications?: boolean
}

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      compare: { type: 'string' },
      'no-console': { type: 'boolean', default: false },
      'static-dir': { type: 'string' },
      site: { type: 'boolean', default: false },
      'product-wallpaper': { type: 'string' },
      width: { type: 'string' },
      height: { type: 'string' },
      scale: { type: 'string' },
      doctor: { type: 'boolean', default: false },
      engine: { type: 'string', default: 'chromium' },
      file: { type: 'string' },
      headed: { type: 'boolean', default: false },
      'shared-dev': { type: 'boolean', default: false },
      selector: { type: 'string' },
      url: { type: 'string', default: DEFAULT_URL },
      workspace: { type: 'string', default: DEFAULT_WORKSPACE },
    },
  })
  const [verb, name] = positionals
  if (values.site && (verb !== 'look' || values.doctor))
    throw createScriptError('--site is only supported by look without --doctor.')
  if (values['static-dir'] && (verb !== 'look' || values.doctor))
    throw createScriptError('--static-dir is only supported by look without --doctor.')
  if (values['product-wallpaper'] && verb !== 'scenario')
    throw createScriptError('--product-wallpaper is only supported by scenario.')
  if ((values.width || values.height || values.scale) && verb !== 'look' && verb !== 'scenario')
    throw createScriptError(
      '--width, --height and --scale are only supported by look and scenario.',
    )
  if (!isEngine(values.engine))
    throw createScriptError(`--engine must be one of ${ENGINES.join(', ')}.`)
  if (values.engine !== 'chromium' && verb === 'trace')
    throw createScriptError('trace records a Chrome trace and needs --engine chromium.')
  const options: Options = {
    ...captureSize(values),
    consoleCapture: !values['no-console'],
    site: values.site || Boolean(values['static-dir']),
    productCapture:
      name === 'editor-product' ||
      name === 'terminal-tabs' ||
      name === 'bottom-panel-persistence' ||
      name === 'git-stage-settles' ||
      name === 'workbench-list-focus' ||
      name === 'editor-external-edit' ||
      Boolean(name?.startsWith('editor-syntax-')) ||
      Boolean(name?.startsWith('editor-split-')) ||
      Boolean(values['product-wallpaper']),
    staticDir: values['static-dir'],
    productWallpaper: values['product-wallpaper'],
    compare: values.compare,
    doctor: values.doctor,
    engine: values.engine,
    file: values.file ?? (name === 'editor-product' ? 'plugins.ts' : DEFAULT_FILE),
    headed: values.headed,
    selector: values.selector,
    url: values['static-dir'] ? STATIC_PREVIEW_URL : values.url,
    workspace: values.workspace,
  }
  const scenario = name && verb !== 'look' && verb !== 'caches' ? scenarioNamed(name) : undefined
  // trace and renders drive the scenario too, so the guard covers every verb that takes one.
  if (scenario && !scenario.surface && !scenario.readOnly && isProduction(options.url))
    throw createScriptError(
      `Scenario ${scenario.name} writes state, so it does not run against production (${options.url}). Drop --url to run it against the dev page with a throwaway server.`,
    )
  if (!needsIsolatedServer(verb, scenario, options, values['shared-dev']))
    return runVerb(verb, scenario, options, values['shared-dev'])
  const prepared = await scenario?.prepareServer?.()
  const server = await startIsolatedServer(new URL(options.url), {
    pathPrefix: prepared?.pathPrefix,
  })
  process.env.PORT = String(server.port)
  process.env.OBSERVABILITY_DIR = server.logs
  process.env.PLATFORM_HOME = server.home
  try {
    return await runVerb(verb, scenario, { ...options, server }, false)
  } finally {
    await server.stop()
  }
}

function runVerb(
  verb: string | undefined,
  scenario: Scenario | undefined,
  options: Options,
  sharedDev: boolean,
) {
  if (sharedDev) process.env.PLATFORM_HOME ??= devStateHome
  if (verb === 'look') return look(options)
  if (verb === 'scenario' && scenario) return runScenario(scenario, options)
  if (verb === 'trace' && scenario) return traceScenario(scenario, options)
  if (verb === 'renders' && scenario) return countRenders(scenario, options)
  if (verb === 'caches') return dumpCaches(options)
  if (verb === 'list') {
    for (const scenario of scenarios) console.log(`${scenario.name}\t${scenario.description}`)
    return 0
  }
  console.log(HELP)
  return verb ? 1 : 0
}

const SERVER_VERBS = new Set(['look', 'scenario', 'trace', 'renders', 'caches'])

// Only the dev page gets a throwaway server: production serves its own API, and a static or
// site capture has none.
function needsIsolatedServer(
  verb: string | undefined,
  scenario: Scenario | undefined,
  options: Options,
  sharedDev: boolean,
) {
  if (sharedDev || !verb || !SERVER_VERBS.has(verb)) return false
  // Site and demo scenarios answer from a static preview or the demo's mock backend.
  if (options.site || options.staticDir || scenario?.surface) return false
  return isDevPage(options.url)
}

function isDevPage(url: string) {
  const parsed = new URL(url)
  return isLoopback(url) && parsed.port === (process.env.WEB_PORT ?? '5173')
}

// The mesh, or production's own port, which serves the page under /platform.
function isProduction(url: string) {
  return !isLoopback(url) || /^\/platform(\/|$)/.test(new URL(url).pathname)
}

async function look(options: Options) {
  const evidence = await createEvidence(
    'look',
    `${new URL(options.url).pathname}-${options.width}x${options.height}`,
  )
  return withPage(options, evidence, async (page, observed) => {
    const ready = options.site
      ? await openStaticPreview(page, options.url)
      : await open(page, options.url)
    if (options.site) await evidence.json('layout.json', await staticPreviewLayout(page))
    await page.screenshot({ path: evidence.file('page.png'), fullPage: false })
    if (options.selector) {
      await page
        .locator(options.selector)
        .first()
        .screenshot({ path: evidence.file('selector.png') })
    }
    const health = options.site
      ? { ok: ready, reasons: ready ? [] : ['main, fonts or images did not become ready'] }
      : await doctor(page, options.url, ready)
    const problems = observedProblems(observed, { loopback: !isLoopback(options.url) })
    await evidence.json('observed.json', { health, problems, ...serializable(observed) })
    const lines = [
      `# look ${options.url}`,
      '',
      `screenshot: ${evidence.file('page.png')}`,
      `ready: ${ready ? 'yes' : 'no'}`,
      `health: ${health.ok ? 'ok' : health.reasons.join('; ')}`,
      `problems: ${problems.length === 0 ? 'none' : ''}`,
      ...problems.map((problem) => `- ${problem}`),
    ]
    await writeSummary(evidence, lines)
    return (options.doctor || options.site) && !health.ok ? 1 : 0
  })
}

async function runScenario(scenario: Scenario, options: Options) {
  const evidence = await createEvidence('scenario', scenario.name)
  const capture = {
    ...options,
    notifications: scenario.notifications,
    site: Boolean(scenario.surface),
  }
  return withPage(capture, evidence, async (page, observed) => {
    const ready =
      scenario.surface === 'site'
        ? await openStaticPreview(page, options.url)
        : await open(page, await workspaceUrl(page, options))
    if (!ready) {
      await page.screenshot({ path: evidence.file('failure.png') })
      if (scenario.inspect) await evidence.json('inspection.json', await scenario.inspect(page))
      const problems = observedProblems(observed, { loopback: !isLoopback(options.url) })
      await evidence.json('observed.json', { problems, ...serializable(observed) })
      await writeSummary(evidence, [
        `# scenario ${scenario.name}`,
        '',
        'app never became ready',
        `screenshot: ${evidence.file('failure.png')}`,
        ...problems.map((problem) => `- ${problem}`),
      ])
      return 1
    }
    if (options.productWallpaper) await alignProductWallpaper(page, evidence)
    const steps: string[] = []
    const step = async (label: string, target: Page = page) => {
      const file = `${String(steps.length + 1).padStart(2, '0')}-${label}.png`
      await target.screenshot({ path: evidence.file(file) })
      if (scenario.inspect)
        await evidence.json(file.replace('.png', '.json'), await scenario.inspect(page))
      steps.push(file)
    }
    const started = performance.now()
    let failure: string | null = null
    try {
      await scenario.run(page, { file: options.file, server: options.server, step })
      if (scenario.inspect) await evidence.json('inspection.json', await scenario.inspect(page))
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error)
      await page.screenshot({ path: evidence.file('failure.png') }).catch(() => undefined)
      if (scenario.inspect)
        await evidence.json('inspection.json', await scenario.inspect(page)).catch(() => undefined)
    }
    const durationMs = Math.round(performance.now() - started)
    const problems = observedProblems(observed, { loopback: !isLoopback(options.url) })
    await evidence.json('observed.json', {
      durationMs,
      failure,
      problems,
      steps,
      ...serializable(observed),
    })
    const lines = [
      `# scenario ${scenario.name}`,
      '',
      scenario.description,
      `duration: ${durationMs}ms`,
      `result: ${failure ? `failed: ${failure}` : 'completed'}`,
      `steps: ${steps.map((file) => evidence.file(file)).join(', ')}`,
      `problems: ${problems.length === 0 ? 'none' : ''}`,
      ...problems.map((problem) => `- ${problem}`),
    ]
    await writeSummary(evidence, lines)
    return failure ? 1 : 0
  })
}

const TRACE_CATEGORIES = [
  'devtools.timeline',
  'disabled-by-default-devtools.timeline',
  'disabled-by-default-devtools.timeline.frame',
  'blink.user_timing',
  'v8.execute',
  'disabled-by-default-v8.cpu_profiler',
]

async function traceScenario(scenario: Scenario, options: Options) {
  const evidence = await createEvidence('trace', scenario.name)
  return withPage(options, evidence, async (page, observed, browser) => {
    const ready = await open(page, await workspaceUrl(page, options))
    if (!ready) {
      await writeSummary(evidence, [`# trace ${scenario.name}`, '', 'app never became ready'])
      return 1
    }
    const tracePath = evidence.file('trace.json')
    await browser.startTracing(page, { categories: TRACE_CATEGORIES, path: tracePath })
    await page.evaluate(() => performance.mark('fregat:scenario:start'))
    let failure: string | null = null
    try {
      await scenario.run(page, {
        file: options.file,
        server: options.server,
        step: async (label) => {
          await page.evaluate((name) => performance.mark(`fregat:step:${name}`), label)
        },
      })
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error)
    }
    await browser.stopTracing()
    if (scenario.inspect)
      await evidence.json('inspection.json', await scenario.inspect(page)).catch(() => undefined)
    await page.screenshot({ path: evidence.file('page.png'), fullPage: false })
    const raw = await Bun.file(tracePath).text()
    const generated = summarizeTrace(raw)
    const frames = [...generated.longTasks, ...generated.phaseTasks].flatMap((task) =>
      task.sampledFrames.map((frame) => frame.generated),
    )
    const sources = await captureTraceSources(page, evidence, frames)
    const summary = summarizeTrace(raw, sources)
    await evidence.json('trace-summary.json', summary)
    const problems = observedProblems(observed, { loopback: !isLoopback(options.url) })
    await evidence.json('observed.json', { problems, ...serializable(observed) })
    const lines = [
      `# trace ${scenario.name}`,
      '',
      scenario.description,
      `result: ${failure ? `failed: ${failure}` : 'completed'}`,
      `trace: ${tracePath} (open in Chrome's Performance panel)`,
      `screenshot: ${evidence.file('page.png')}`,
      `source maps: ${evidence.file('trace-sources.json')}`,
      '',
      ...formatTraceSummary(summary),
    ]
    if (options.compare) {
      const before = summarizeTrace(await Bun.file(`${options.compare}/trace.json`).text())
      lines.push('', `compared with ${options.compare}`, ...compareTraceSummaries(before, summary))
    }
    lines.push(
      '',
      `problems: ${problems.length === 0 ? 'none' : ''}`,
      ...problems.map((p) => `- ${p}`),
    )
    await writeSummary(evidence, lines)
    return failure ? 1 : 0
  })
}

type RenderRow = {
  readonly changes: readonly string[]
  readonly component: string
  readonly noDomChange: number
  readonly parentDriven: number
  readonly renders: number
  readonly timeMs: number
}

async function countRenders(scenario: Scenario, options: Options) {
  const evidence = await createEvidence('renders', scenario.name)
  const injected = await bundleInjected('renders.ts')
  return withPage(options, evidence, async (page, observed) => {
    await page.addInitScript({ content: injected })
    const ready = await open(page, await workspaceUrl(page, options))
    if (!ready) {
      await writeSummary(evidence, [`# renders ${scenario.name}`, '', 'app never became ready'])
      return 1
    }
    await page.evaluate(() =>
      (globalThis as { __agentRenders?: { reset(): void } }).__agentRenders?.reset(),
    )
    const checkpoints: { label: string; rows: unknown }[] = []
    let failure: string | null = null
    try {
      await scenario.run(page, {
        file: options.file,
        server: options.server,
        step: async (label) => {
          const rows = await page.evaluate(
            () =>
              (globalThis as { __agentRenders?: { report(): unknown } }).__agentRenders?.report() ??
              [],
          )
          checkpoints.push({ label, rows })
        },
      })
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error)
    }
    await page.waitForTimeout(500)
    const rows = (await page.evaluate(
      () =>
        (globalThis as { __agentRenders?: { report(): unknown } }).__agentRenders?.report() ?? [],
    )) as RenderRow[]
    if (rows.length === 0) {
      failure ??=
        'No component updates were captured. Check render instrumentation and page reloads.'
    }
    await page.screenshot({ path: evidence.file('page.png'), fullPage: false })
    rows.sort(
      (a, b) =>
        b.noDomChange - a.noDomChange || b.parentDriven - a.parentDriven || b.renders - a.renders,
    )
    await evidence.json('renders.json', rows)
    await evidence.json('render-steps.json', checkpoints)
    const total = rows.reduce((sum, row) => sum + row.renders, 0)
    const wasted = rows.reduce((sum, row) => sum + row.parentDriven, 0)
    const silent = rows.reduce((sum, row) => sum + row.noDomChange, 0)
    const problems = observedProblems(observed, { loopback: !isLoopback(options.url) })
    await evidence.json('observed.json', { problems, ...serializable(observed) })
    const lines = [
      `# renders ${scenario.name}`,
      '',
      scenario.description,
      `result: ${failure ? `failed: ${failure}` : 'completed'}`,
      `screenshot: ${evidence.file('page.png')}`,
      `components: ${rows.length}, renders: ${total}, no DOM change: ${silent}, parent-driven (nothing of their own changed): ${wasted}`,
      'Times are React actualDuration for component subtrees, not component self time; nested rows overlap.',
      '',
      '| component | renders | no DOM change | parent-driven | subtree ms | what changed |',
      '| --- | --- | --- | --- | --- | --- |',
      ...rows
        .slice(0, 25)
        .map(
          (row) =>
            `| ${row.component} | ${row.renders} | ${row.noDomChange} | ${row.parentDriven} | ${row.timeMs} | ${row.changes.join(', ') || '-'} |`,
        ),
      '',
      `full table: ${evidence.file('renders.json')}`,
      `cumulative step counts: ${evidence.file('render-steps.json')}`,
      `problems: ${problems.length === 0 ? 'none' : ''}`,
      ...problems.map((p) => `- ${p}`),
    ]
    await writeSummary(evidence, lines)
    return failure ? 1 : 0
  })
}

type CacheDump = readonly {
  readonly origin: string
  readonly queries: readonly {
    readonly key: string
    readonly status: string
    readonly fetchStatus: string
    readonly stale: boolean
    readonly observers: number
    readonly updatedAgoMs: number | null
  }[]
  readonly mutations: readonly {
    readonly key: string
    readonly status: string
    readonly scope: string | null
    readonly variables: string
  }[]
}[]

async function dumpCaches(options: Options) {
  const evidence = await createEvidence('caches', new URL(options.url).pathname)
  return withPage(options, evidence, async (page) => {
    const ready = await open(page, await workspaceUrl(page, options))
    if (!ready) {
      await writeSummary(evidence, ['# caches', '', 'app never became ready'])
      return 1
    }
    await page.waitForTimeout(2_000)
    const dump = (await page.evaluate(readCaches)) as CacheDump
    await evidence.json('caches.json', dump)
    const lines = ['# caches', '']
    for (const client of dump) {
      lines.push(
        `## ${client.origin}`,
        '',
        `queries: ${client.queries.length}, mutations: ${client.mutations.length}`,
        '',
      )
      lines.push(
        '| query | status | fetch | stale | observers | updated |',
        '| --- | --- | --- | --- | --- | --- |',
      )
      for (const query of client.queries.slice(0, 60)) {
        const ago =
          query.updatedAgoMs === null ? '-' : `${Math.round(query.updatedAgoMs / 1000)}s ago`
        lines.push(
          `| ${query.key} | ${query.status} | ${query.fetchStatus} | ${query.stale ? 'yes' : 'no'} | ${query.observers} | ${ago} |`,
        )
      }
      if (client.mutations.length > 0) {
        lines.push('', '| mutation | status | scope | variables |', '| --- | --- | --- | --- |')
        for (const mutation of client.mutations.slice(0, 40)) {
          lines.push(
            `| ${mutation.key} | ${mutation.status} | ${mutation.scope ?? '-'} | ${mutation.variables} |`,
          )
        }
      }
      lines.push('')
    }
    lines.push(`full dump: ${evidence.file('caches.json')}`)
    await writeSummary(evidence, lines)
    return 0
  })
}

function readCaches() {
  type AnyQuery = {
    queryKey: unknown
    state: { status: string; fetchStatus: string; dataUpdatedAt: number }
    isStale(): boolean
    getObserversCount(): number
  }
  type AnyMutation = {
    options: { mutationKey?: unknown; scope?: { id: string } }
    state: { status: string; variables: unknown }
  }
  type AnyClient = {
    getQueryCache(): { getAll(): AnyQuery[] }
    getMutationCache(): { getAll(): AnyMutation[] }
  }
  const clients = (globalThis as { __fregatQueryClients?: Map<string, AnyClient> })
    .__fregatQueryClients
  if (!clients) return []
  const compact = (value: unknown) => {
    const text = JSON.stringify(value) ?? String(value)
    return text.length > 80 ? `${text.slice(0, 77)}…` : text
  }
  return [...clients.entries()].map(([origin, client]) => ({
    origin,
    queries: client
      .getQueryCache()
      .getAll()
      .map((query) => ({
        key: compact(query.queryKey),
        status: query.state.status,
        fetchStatus: query.state.fetchStatus,
        stale: query.isStale(),
        observers: query.getObserversCount(),
        updatedAgoMs: query.state.dataUpdatedAt ? Date.now() - query.state.dataUpdatedAt : null,
      })),
    mutations: client
      .getMutationCache()
      .getAll()
      .map((mutation) => ({
        key: compact(mutation.options.mutationKey ?? null),
        status: mutation.state.status,
        scope: mutation.options.scope?.id ?? null,
        variables: compact(mutation.state.variables),
      })),
  }))
}

async function bundleInjected(name: string) {
  const entry = new URL(`./injected/${name}`, import.meta.url).pathname
  const built = await Bun.build({
    define: { 'process.env.NODE_ENV': '"development"' },
    entrypoints: [entry],
    format: 'iife',
    minify: false,
    target: 'browser',
  })
  if (!built.success) throw new Error(built.logs.map((log) => log.message).join('\n'))
  const output = built.outputs[0]
  if (!output) throw new Error(`no output for ${name}`)
  return output.text()
}

async function withPage(
  options: Options,
  evidence: Evidence,
  body: (
    page: Page,
    observed: ReturnType<typeof attachObserver>,
    browser: Browser,
  ) => Promise<number>,
) {
  const browser = await launch(options.engine, options.headed, options.notifications)
  const context = await browser.newContext({
    // Only Chromium knows these permission names; Firefox and WebKit reject the context.
    permissions: options.engine === 'chromium' ? chromiumPermissions(options) : [],
    viewport: { width: options.width, height: options.height },
    deviceScaleFactor: options.scale,
    ...(options.productWallpaper ? { userAgent: PRODUCT_USER_AGENT } : {}),
  })
  if (options.server)
    await context.addInitScript(
      `window.platformDevServerUrl = ${JSON.stringify(options.server.origin)}`,
    )
  const page = await context.newPage()
  const observed = attachObserver(page, apiBase(options.url), {
    consoleCapture: options.consoleCapture,
  })
  let saveWallpaper: (() => Promise<string>) | undefined
  let disposeTerminals: (() => Promise<string>) | undefined
  try {
    await captureBrowserRenderer(browser, evidence, options.headed)
    if (options.productCapture) disposeTerminals = await isolateProductTerminals(page, evidence)
    const staticDirectory = options.staticDir
      ? await routeStaticPreview(page, options.staticDir)
      : null
    if (options.productWallpaper)
      saveWallpaper = await routeProductWallpaper(page, options.productWallpaper, evidence)
    await evidence.json('capture-options.json', {
      url: options.url,
      consoleCapture: options.consoleCapture,
      viewport: { width: options.width, height: options.height },
      deviceScaleFactor: options.scale,
      screenshotPixels: {
        width: options.width * options.scale,
        height: options.height * options.scale,
      },
      staticDirectory,
      productWallpaper: options.productWallpaper ?? null,
      userAgentOverride: options.productWallpaper ? PRODUCT_USER_AGENT : null,
    })
    const code = await body(page, observed, browser)
    if (!options.site) await appendLogs(evidence, options.server)
    console.log(await Bun.file(evidence.file('summary.md')).text())
    return code
  } finally {
    await closeCapture(page, browser, saveWallpaper, disposeTerminals)
  }
}

async function closeCapture(
  page: Page,
  browser: Browser,
  saveWallpaper?: () => Promise<string>,
  disposeTerminals?: () => Promise<string>,
) {
  try {
    await saveWallpaper?.()
  } finally {
    try {
      await page.close()
      await disposeTerminals?.()
    } finally {
      await browser.close()
    }
  }
}

// A fresh browser context has no workspace. Register the folder and land on its address.
async function workspaceUrl(page: Page, options: Options) {
  const parsed = new URL(options.url)
  if (parsed.pathname !== '/' && !parsed.pathname.endsWith('/platform/')) return options.url
  const response = await page.request.post(`${apiBase(options.url)}fs/workspace-address`, {
    data: { path: options.workspace },
    headers: { Origin: parsed.origin },
  })
  if (!response.ok())
    throw new Error(`workspace-address failed: ${response.status()} ${await response.text()}`)
  const { id, name } = (await response.json()) as { id: string; name: string }
  const token = encodeURIComponent(`${name}.${id}`).replaceAll('~', '%7E')
  return `${options.url.replace(/\/$/, '')}/~${token}/workbench`
}

async function open(page: Page, url: string) {
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  try {
    await waitForApp(page)
    await page.waitForTimeout(1_500)
    return true
  } catch {
    return false
  }
}

async function doctor(page: Page, url: string, ready: boolean) {
  const reasons: string[] = []
  if (!ready) reasons.push('window toolbar never rendered')
  const release = await page.request.get(`${apiBase(url)}release`).catch(() => null)
  if (!release?.ok()) reasons.push('release route did not answer')
  const errors = await page.locator('[role="alert"]').count()
  if (errors > 0) reasons.push(`${errors} alert(s) on screen`)
  return { ok: reasons.length === 0, reasons }
}

function isLoopback(url: string) {
  return /^(localhost|127\.0\.0\.1)$/.test(new URL(url).hostname)
}

function apiBase(url: string) {
  const parsed = new URL(url)
  if (parsed.port === '5173' || parsed.port === (process.env.WEB_PORT ?? '5173')) {
    return `http://localhost:${process.env.PORT ?? '3001'}/`
  }
  return `${parsed.origin}${parsed.pathname.replace(/\/[^/]*$/, '/')}`
}

async function appendLogs(evidence: Evidence, server: IsolatedServer | undefined) {
  const events = await readLogs({ level: 'warn', since: evidence.startedAt })
  await evidence.write('logs.txt', events.map(formatLogEvent).join('\n'))
  const summary = evidence.file('summary.md')
  const existing = await Bun.file(summary).text()
  const window = `${evidence.startedAt.toISOString()}..now`
  const lines = [
    '',
    `logs (warn+, ${window}): ${events.length === 0 ? 'none' : `${events.length}, see logs.txt`}`,
    ...(server
      ? await keepServerLogs(evidence, server)
      : [`full window: bun run logs --since ${evidence.startedAt.toISOString()}`]),
  ]
  await Bun.write(summary, `${existing}${lines.join('\n')}\n`)
}

// The run's state directory is deleted when it ends, so its log moves into the evidence.
async function keepServerLogs(evidence: Evidence, server: IsolatedServer) {
  const files = (await readdir(server.logs).catch(() => [] as string[])).filter((name) =>
    name.endsWith('.jsonl'),
  )
  for (const name of files) await copyFile(path.join(server.logs, name), evidence.file(name))
  return [
    `api server: ${server.origin}, throwaway state ${server.directory} (removed after the run)`,
    `full log: ${files.map((name) => evidence.file(name)).join(', ') || 'none written'}`,
  ]
}

async function writeSummary(evidence: Evidence, lines: readonly string[]) {
  await evidence.write('summary.md', `${lines.join('\n')}\n`)
}

const ENGINES = ['chromium', 'firefox', 'webkit'] as const

type Engine = (typeof ENGINES)[number]

function isEngine(value: string): value is Engine {
  return (ENGINES as readonly string[]).includes(value)
}

function chromiumPermissions(options: Options) {
  const clipboard = ['clipboard-read', 'clipboard-write']
  return options.notifications ? [...clipboard, 'notifications'] : clipboard
}

async function launch(engine: Engine, headed: boolean, notifications = false): Promise<Browser> {
  const cache = '/work/cache/ms-playwright'
  if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync(cache)) {
    process.env.PLAYWRIGHT_BROWSERS_PATH = cache
  }
  // Imported here: Playwright fixes its browser directory when it loads, and Bun loads a static
  // import before any code in this file runs.
  const playwright = await import('playwright')
  const { chromium } = playwright
  if (engine !== 'chromium') return playwright[engine].launch({ headless: !headed })
  // Playwright hides scrollbars by default. Users have them, and a scrollbar that appears with
  // content changes every width the app measures.
  const ignoreDefaultArgs = ['--hide-scrollbars']
  // The headless shell denies notification permission; full Chromium in headless mode grants it.
  if (notifications)
    return chromium.launch({ channel: 'chromium', headless: !headed, ignoreDefaultArgs })

  return chromium.launch({ headless: !headed, ignoreDefaultArgs })
}

process.exitCode = await main()
