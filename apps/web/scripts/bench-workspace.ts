import { roundMs } from '@workspace/utils/timing'
import type { EditorPerformanceTraceReport } from '../src/features/editor/state/performance-trace.ts'
import type { Page, BrowserContext, Browser } from 'playwright'
import { chromium, firefox, webkit } from 'playwright'
import { statSync } from 'node:fs'
import { basename, relative, resolve, sep } from 'node:path'
import {
  WORKSPACE_CACHE_STORAGE_KEYS,
  workspaceSliceStorageKey,
} from '../src/lib/workspace-cache-keys.ts'
import { createDefaultWorkbenchLayout } from '../src/features/workbench/utils/layout.ts'
import { createDefaultWorkbenchPanels } from '../src/features/workbench/utils/panels.ts'
import { createBenchmarkError } from './structured-errors.ts'

export const browserTypes = { chromium, firefox, webkit }
export type BrowserName = keyof typeof browserTypes

export function launchOptions(browserName: BrowserName) {
  if (browserName !== 'chromium') return { headless: true }

  return {
    args: ['--disable-frame-rate-limit', '--disable-gpu-vsync'],
    channel: 'chromium',
    headless: true,
  }
}

// Reproducible "under load" benching via DevTools CPU throttling. Applied
// after the editor is ready so setup stays fast and only the measured
// interaction runs degraded. Chromium-only; other browsers run unthrottled.
export async function applyCpuThrottle(page: Page, browserName: BrowserName, rate: number) {
  if (rate <= 1) return false
  if (browserName !== 'chromium') return false

  const session = await page.context().newCDPSession(page)
  await session.send('Emulation.setCPUThrottlingRate', { rate })
  return true
}

// Fixed deterministic workload timed in-page right before sampling. Reported
// with every trial so runs are comparable across machine states: an inflated
// value means the machine (or --cpu-throttle) was slow, and by how much.
export async function measureCpuCalibration(page: Page) {
  return page.evaluate(() => {
    const start = performance.now()
    let acc = 0
    for (let index = 0; index < 20_000_000; index += 1) {
      acc = (acc + index * 31) % 1000003
    }
    if (acc === -1) console.log(acc)
    return Math.round((performance.now() - start) * 100) / 100
  })
}

export function browserList(value: string | undefined): BrowserName[] {
  if (!value) return []

  return value
    .split(',')
    .map((name: string) => name.trim())
    .filter(
      (name): name is BrowserName => name === 'chromium' || name === 'firefox' || name === 'webkit',
    )
}

export function numberOption(value: string | undefined, fallback: number) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback

  return Math.floor(parsed)
}

function fractionOption(value: string | undefined, fallback: number) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0 || parsed >= 1) return fallback

  return parsed
}

async function jumpToScrollFraction(page: Page, fraction: number, expectHighlights = true) {
  if (fraction <= 0) return

  await page.evaluate(async (targetFraction: number) => {
    const scroller = document.querySelector('.editor-virtualized')
    if (!scroller) return
    scroller.scrollTop = Math.floor(
      (scroller.scrollHeight - scroller.clientHeight) * targetFraction,
    )
    scroller.dispatchEvent(new Event('scroll', { bubbles: true }))
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  }, fraction)
  if (expectHighlights) await waitForHighlightRanges(page)
  await page.waitForTimeout(250)
}

export async function createWorkspaceContext({
  appUrl,
  serverUrl,
  workspaceRoot,
  filePath,
}: {
  appUrl: string
  serverUrl: string
  workspaceRoot: string
  filePath: string
}) {
  const health = await fetchServerHealth(appUrl, serverUrl)
  const absoluteRootPath = resolve(workspaceRoot)
  const absoluteFilePath = resolve(absoluteRootPath, filePath)
  const rootPath = clientPathForAbsolutePath(absoluteRootPath, health.workspaceRoot)
  const clientFilePath = clientPathForAbsolutePath(absoluteFilePath, health.workspaceRoot)
  const rootStat = statSync(absoluteRootPath)

  return {
    absoluteRootPath,
    filePath: clientFilePath,
    rootFolder: {
      birthtimeMs: rootStat.birthtimeMs,
      mtimeMs: rootStat.mtimeMs,
      name: basename(absoluteRootPath),
      path: rootPath,
      size: rootStat.size,
      type: 'directory',
      version: '',
    },
  }
}

async function fetchServerHealth(appUrl: string, serverUrl: string) {
  const response = await fetch(new URL('/health', serverUrl), {
    headers: { Origin: new URL(appUrl).origin },
  })
  if (!response.ok) throw createBenchmarkError(`Server health failed: ${response.status}`)

  return response.json()
}

function clientPathForAbsolutePath(absolutePath: string, workspaceRoot: string) {
  const absoluteWorkspaceRoot = resolve(workspaceRoot)
  if (absoluteWorkspaceRoot === sep) return stripLeadingSlash(absolutePath)

  return relative(absoluteWorkspaceRoot, absolutePath).split(sep).join('/')
}

function stripLeadingSlash(path: string) {
  return path.startsWith(sep) ? path.slice(1) : path
}

export type BenchmarkWorkspace = Awaited<ReturnType<typeof createWorkspaceContext>>

async function seedWorkspaceCache(context: BrowserContext, workspace: BenchmarkWorkspace) {
  await context.addInitScript((entries: ArrayLike<unknown> | { [s: string]: unknown }) => {
    for (const [key, value] of Object.entries(entries)) {
      window.localStorage.setItem(key, JSON.stringify(value))
    }
  }, workspaceCacheEntries(workspace))
}

export function workspaceCacheEntries(workspace: BenchmarkWorkspace) {
  const rootPath = workspace.rootFolder.path
  return {
    [WORKSPACE_CACHE_STORAGE_KEYS.rootFolder]: workspace.rootFolder,
    [WORKSPACE_CACHE_STORAGE_KEYS.workbenchLayout]: createDefaultWorkbenchLayout(),
    [WORKSPACE_CACHE_STORAGE_KEYS.workspaceIndex]: [rootPath],
    [workspaceSliceStorageKey(rootPath)]: {
      editorHistory: [workspace.filePath],
      recentlyClosedEditorPaths: [],
      scrollPositionByPath: {},
      workbenchPanels: workbenchPanelsEntry(workspace),
    },
  }
}

function workbenchPanelsEntry(workspace: BenchmarkWorkspace) {
  return {
    ...createDefaultWorkbenchPanels(),
    activeEditorTabId: 'tab-bench',
    editorTabs: [{ id: 'tab-bench', path: workspace.filePath }],
  }
}

export function traceUrl(appUrl: string) {
  const url = new URL(appUrl)
  url.searchParams.set('editorPerfTrace', '1')
  return String(url)
}

async function waitForHighlightedEditor(page: Page, expectHighlights = true) {
  await assertMountedEditor(page)
  await page.waitForFunction(() => Boolean(window.__editorPerfTrace))
  if (expectHighlights) await waitForHighlightRanges(page)
  await page.evaluate(() => document.fonts?.ready ?? Promise.resolve())
  await page.evaluate(
    async () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => {
          requestAnimationFrame(resolve)
        }),
      ),
  )
}

async function assertMountedEditor(page: Page) {
  const mountedRow = await page.waitForSelector('.editor-virtualized-row').catch(() => null)
  if (mountedRow) return

  throw createBenchmarkError(
    `Workspace cache seed produced no mounted editor at ${page.url()}; check the cache schema and seeded workspace slice.`,
  )
}

function waitForHighlightRanges(page: Page) {
  return page.waitForFunction(
    () => {
      const registry = window.CSS?.highlights
      if (!registry) return false

      for (const [, highlight] of registry) {
        if (highlight.size > 0) return true
      }
      return false
    },
    undefined,
    { polling: 100 },
  )
}

export function average(values: readonly number[]) {
  return roundMs(values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length))
}

export function minimum(values: readonly number[]) {
  if (values.length === 0) return 0

  return roundMs(Math.min(...values))
}

export function maximum(values: readonly number[]) {
  if (values.length === 0) return 0

  return roundMs(Math.max(...values))
}

export function median(values: readonly number[]) {
  const sorted = [...values].sort((left, right) => left - right)
  const midpoint = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return roundMs(sorted[midpoint])

  return average([sorted[midpoint - 1], sorted[midpoint]])
}

export function percentile(values: readonly number[], fraction: number) {
  if (values.length === 0) return 0

  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1)
  return roundMs(sorted[Math.max(0, index)])
}

function defaultBrowsers(gate: boolean): BrowserName[] {
  if (gate) return ['chromium']

  return ['chromium', 'webkit', 'firefox']
}

export function diagnostic(
  report: Pick<EditorPerformanceTraceReport, 'topDiagnostics'>,
  name: string,
) {
  return (
    report.topDiagnostics.find((item) => item.name === name) ?? {
      count: 0,
      maxMs: 0,
      meanMs: 0,
      totalMs: 0,
    }
  )
}

export async function runBrowserTrial<T>(
  browserName: BrowserName,
  trial: number,
  workspace: BenchmarkWorkspace,
  runTrialInBrowser: (
    browser: Browser,
    browserName: BrowserName,
    trial: number,
    workspace: BenchmarkWorkspace,
  ) => Promise<T>,
) {
  const browser = await browserTypes[browserName].launch(launchOptions(browserName))
  try {
    return await runTrialInBrowser(browser, browserName, trial, workspace)
  } finally {
    await browser.close().catch(() => {})
  }
}

function gateFailures<T, F>(
  results: Partial<Record<BrowserName, T>>,
  gateThresholds: Partial<Record<BrowserName, Readonly<Record<string, number>>>>,
  thresholdFailures: (
    browserName: BrowserName,
    summary: T,
    thresholds: Readonly<Record<string, number>>,
  ) => readonly F[],
) {
  return Object.entries(results).flatMap(([browserName, summary]) => {
    if (browserName !== 'chromium' && browserName !== 'firefox' && browserName !== 'webkit')
      return []
    const thresholds = gateThresholds[browserName]
    if (!thresholds) return []

    return thresholdFailures(browserName, summary, thresholds)
  })
}

export type BenchmarkOptions = {
  appUrl: string
  browsers: BrowserName[]
  cpuThrottle: number
  expectHighlights: boolean
  filePath: string
  gate: boolean
  pageTimeoutMs: number
  serverUrl: string
  startFraction: number
  trials: number
  workspaceRoot: string
}

export function benchmarkOptions(prefix: string): BenchmarkOptions {
  const env = (suffix: string) => process.env[`${prefix}_${suffix}`]
  return {
    appUrl: env('APP_URL') ?? 'http://localhost:5173/',
    browsers: browserList(undefined),
    cpuThrottle: numberOption(env('CPU_THROTTLE'), 1),
    expectHighlights: true,
    filePath: env('FILE') ?? 'apps/web/src/features/editor/components/editor.tsx',
    gate: false,
    pageTimeoutMs: numberOption(env('PAGE_TIMEOUT_MS'), 25_000),
    serverUrl: env('SERVER_URL') ?? process.env.VITE_SERVER_URL ?? 'http://localhost:3001',
    startFraction: fractionOption(env('START_FRACTION'), 0),
    trials: numberOption(env('TRIALS'), 3),
    workspaceRoot: env('ROOT') ?? resolve(process.cwd(), '../..'),
  }
}

function applyBenchmarkOption(options: BenchmarkOptions, arg: string) {
  if (arg === '--gate') {
    options.gate = true
    return
  }
  if (arg === '--no-highlights') {
    options.expectHighlights = false
    return
  }
  const [name, value] = arg.split('=')
  if (name === '--app-url') options.appUrl = value ?? options.appUrl
  if (name === '--browsers') options.browsers = browserList(value)
  if (name === '--cpu-throttle') options.cpuThrottle = numberOption(value, options.cpuThrottle)
  if (name === '--file') options.filePath = value ?? options.filePath
  if (name === '--page-timeout-ms')
    options.pageTimeoutMs = numberOption(value, options.pageTimeoutMs)
  if (name === '--server-url') options.serverUrl = value ?? options.serverUrl
  if (name === '--start-fraction')
    options.startFraction = fractionOption(value, options.startFraction)
  if (name === '--trials') options.trials = numberOption(value, options.trials)
  if (name === '--workspace-root') options.workspaceRoot = value ?? options.workspaceRoot
}

export async function benchmarkPage(
  browser: Browser,
  workspace: BenchmarkWorkspace,
  options: BenchmarkOptions,
) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  await seedWorkspaceCache(context, workspace)
  const page = await context.newPage()
  page.setDefaultTimeout(options.pageTimeoutMs)
  await page.goto(traceUrl(options.appUrl), { waitUntil: 'domcontentloaded' })
  await waitForHighlightedEditor(page, options.expectHighlights)
  await jumpToScrollFraction(page, options.startFraction, options.expectHighlights)
  return page
}

export async function runBenchmark<T, F>(
  name: string,
  options: BenchmarkOptions,
  thresholds: Partial<Record<BrowserName, Readonly<Record<string, number>>>>,
  sample: (browserName: BrowserName, workspace: BenchmarkWorkspace) => Promise<T>,
  failuresFor: (
    browserName: BrowserName,
    summary: T,
    thresholds: Readonly<Record<string, number>>,
  ) => readonly F[],
) {
  const names = options.browsers.length ? options.browsers : defaultBrowsers(options.gate)
  const workspace = await createWorkspaceContext(options)
  const results: Partial<Record<BrowserName, T>> = {}
  for (const browserName of names) results[browserName] = await sample(browserName, workspace)
  console.log(`${name}_SUMMARY ${JSON.stringify(results, null, 2)}`)
  if (!options.gate) return
  const failures = gateFailures(results, thresholds, failuresFor)
  if (failures.length) {
    console.error(`${name}_GATE_FAILED ${JSON.stringify(failures, null, 2)}`)
    process.exit(1)
  }
  console.log(`${name}_GATE_PASSED`)
}

export async function browserSamples<T>(
  name: string,
  browserName: BrowserName,
  workspace: BenchmarkWorkspace,
  trials: number,
  sample: Parameters<typeof runBrowserTrial<T>>[3],
) {
  const samples: T[] = []
  for (let trial = 1; trial <= trials; trial++) {
    const result = await runBrowserTrial(browserName, trial, workspace, sample)
    samples.push(result)
    console.log(JSON.stringify({ type: name, ...result }))
  }
  return samples
}

export function parseBenchmarkOptions<T extends BenchmarkOptions>(
  options: T,
  args: readonly string[],
  applyExtra: (options: T, name: string | undefined, value: string | undefined) => void,
) {
  for (const arg of args) {
    applyBenchmarkOption(options, arg)
    const [name, value] = arg.split('=')
    applyExtra(options, name, value)
  }
  return options
}
