import { chromium, firefox, webkit } from 'playwright'
import { statSync } from 'node:fs'
import { basename, relative, resolve, sep } from 'node:path'
import {
  WORKSPACE_CACHE_STORAGE_KEYS,
  workspaceSliceStorageKey,
} from '../src/features/workspace/state/cache.ts'
import { createDefaultWorkbenchLayout } from '../src/features/workbench/utils/layout.ts'
import { createDefaultWorkbenchPanels } from '../src/features/workbench/utils/panels.ts'
import { createBenchmarkError } from './structured-errors.mjs'

export const browserTypes = { chromium, firefox, webkit }

export function launchOptions(browserName) {
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
export async function applyCpuThrottle(page, browserName, rate) {
  if (rate <= 1) return false
  if (browserName !== 'chromium') return false

  const session = await page.context().newCDPSession(page)
  await session.send('Emulation.setCPUThrottlingRate', { rate })
  return true
}

// Fixed deterministic workload timed in-page right before sampling. Reported
// with every trial so runs are comparable across machine states: an inflated
// value means the machine (or --cpu-throttle) was slow, and by how much.
export async function measureCpuCalibration(page) {
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

export function browserList(value) {
  if (!value) return []

  return value
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name in browserTypes)
}

export function numberOption(value, fallback) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback

  return Math.floor(parsed)
}

export function fractionOption(value, fallback) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < 0 || parsed >= 1) return fallback

  return parsed
}

export async function jumpToScrollFraction(page, fraction, expectHighlights = true) {
  if (fraction <= 0) return

  await page.evaluate(async (targetFraction) => {
    const scroller = document.querySelector('.editor-virtualized')
    scroller.scrollTop = Math.floor(
      (scroller.scrollHeight - scroller.clientHeight) * targetFraction,
    )
    scroller.dispatchEvent(new Event('scroll', { bubbles: true }))
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  }, fraction)
  if (expectHighlights) await waitForHighlightRanges(page)
  await page.waitForTimeout(250)
}

export async function createWorkspaceContext({ appUrl, serverUrl, workspaceRoot, filePath }) {
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

async function fetchServerHealth(appUrl, serverUrl) {
  const response = await fetch(new URL('/health', serverUrl), {
    headers: { Origin: new URL(appUrl).origin },
  })
  if (!response.ok) throw createBenchmarkError(`Server health failed: ${response.status}`)

  return response.json()
}

function clientPathForAbsolutePath(absolutePath, workspaceRoot) {
  const absoluteWorkspaceRoot = resolve(workspaceRoot)
  if (absoluteWorkspaceRoot === sep) return stripLeadingSlash(absolutePath)

  return relative(absoluteWorkspaceRoot, absolutePath).split(sep).join('/')
}

function stripLeadingSlash(path) {
  return path.startsWith(sep) ? path.slice(1) : path
}

export async function seedWorkspaceCache(context, workspace) {
  await context.addInitScript((entries) => {
    for (const [key, value] of Object.entries(entries)) {
      window.localStorage.setItem(key, JSON.stringify(value))
    }
  }, workspaceCacheEntries(workspace))
}

export function workspaceCacheEntries(workspace) {
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

function workbenchPanelsEntry(workspace) {
  return {
    ...createDefaultWorkbenchPanels(),
    activeEditorTabId: 'tab-bench',
    editorTabs: [{ id: 'tab-bench', path: workspace.filePath }],
  }
}

export function traceUrl(appUrl) {
  const url = new URL(appUrl)
  url.searchParams.set('editorPerfTrace', '1')
  return String(url)
}

export async function waitForHighlightedEditor(page, expectHighlights = true) {
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

async function assertMountedEditor(page) {
  const mountedRow = await page.waitForSelector('.editor-virtualized-row').catch(() => null)
  if (mountedRow) return

  throw createBenchmarkError(
    `Workspace cache seed produced no mounted editor at ${page.url()}; check the cache schema and seeded workspace slice.`,
  )
}

function waitForHighlightRanges(page) {
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

export function average(values) {
  return round(values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length))
}

export function minimum(values) {
  if (values.length === 0) return 0

  return round(Math.min(...values))
}

export function maximum(values) {
  if (values.length === 0) return 0

  return round(Math.max(...values))
}

export function median(values) {
  const sorted = [...values].sort((left, right) => left - right)
  const midpoint = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return round(sorted[midpoint])

  return average([sorted[midpoint - 1], sorted[midpoint]])
}

export function percentile(values, fraction) {
  if (values.length === 0) return 0

  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1)
  return round(sorted[Math.max(0, index)])
}

export function round(value) {
  return Math.round(value * 100) / 100
}

export function defaultBrowsers(gate) {
  if (gate) return ['chromium']

  return ['chromium', 'webkit', 'firefox']
}

export function diagnostic(report, name) {
  return (
    report.topDiagnostics.find((item) => item.name === name) ?? {
      count: 0,
      maxMs: 0,
      meanMs: 0,
      totalMs: 0,
    }
  )
}

export async function runBrowserTrial(browserName, trial, workspace, runTrialInBrowser) {
  const browser = await browserTypes[browserName].launch(launchOptions(browserName))
  try {
    return await runTrialInBrowser(browser, browserName, trial, workspace)
  } finally {
    await browser.close().catch(() => {})
  }
}

export function gateFailures(results, gateThresholds, thresholdFailures) {
  return Object.entries(results).flatMap(([browserName, summary]) => {
    const thresholds = gateThresholds[browserName]
    if (!thresholds) return []

    return thresholdFailures(browserName, summary, thresholds)
  })
}
