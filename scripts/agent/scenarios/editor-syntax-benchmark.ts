import { ok } from 'node:assert/strict'
import type { Page } from 'playwright'
import type { Scenario } from './index'
import { focusEditor, openFileByName, selectors, waitForApp } from '../selectors'

type WorkerSample = {
  family: string
  type: unknown
  id: unknown
  start: number
  end?: number
  durationMs?: number
  includeHighlights: unknown
  includeCaptures: unknown
  timings?: unknown
  error?: unknown
}

declare global {
  interface Window {
    syntaxBenchmark: {
      workers: string[]
      requests: WorkerSample[]
      phases: { name: string; at: number }[]
    }
  }
}

export function editorSyntaxBenchmark(
  engine: 'native' | 'shiki',
  settleBackground = false,
): Scenario {
  return {
    name: `editor-syntax-${engine}${settleBackground ? '-settled' : ''}`,
    description:
      'Compare native and Shiki highlighting on identical files with browser-only settings; capture worker requests, edits, and scrolling.',
    async run(page, { file, step }) {
      const url = new URL(page.url())
      const theme = engine === 'native' ? 'tree-sitter-dark' : 'github-dark'
      const settings = {
        'workbench.colorTheme': 'dark',
        'editor.codeTheme.dark': theme,
        'editor.codeTheme.light': theme,
        'files.autoSave': 'off',
      }
      await page.route(/\/settings(?:\?.*)?$/, async (route) => {
        if (route.request().method() !== 'GET') return route.continue()
        const response = await route.fetch()
        const snapshot: unknown = await response.json()
        ok(snapshot && typeof snapshot === 'object' && 'values' in snapshot)
        ok(snapshot.values && typeof snapshot.values === 'object')
        await route.fulfill({
          response,
          json: { ...snapshot, values: { ...snapshot.values, ...settings } },
        })
      })
      await page.addInitScript((values) => {
        localStorage.setItem('platform.settings-boot-mirror.v1', JSON.stringify(values))
      }, settings)
      await page.addInitScript(observeWorkers)
      url.searchParams.set('editorPerfTrace', '1')
      await page.goto(url.href)
      await waitForApp(page)
      await mark(page, 'open-start')
      await openFileByName(page, file)
      await page.waitForFunction(() =>
        window.syntaxBenchmark.requests.some(
          (request) => request.type === 'parse' && request.end !== undefined,
        ),
      )
      await waitForWorkers(page)
      await assertHighlighting(page, engine)
      await mark(page, 'open-settled')
      await step('opened')
      if (settleBackground) await page.waitForTimeout(2_000)
      await focusEditor(page)
      await page.keyboard.press('Control+Home')
      await page.keyboard.press('End')
      await waitForWorkers(page)
      await mark(page, 'edits-start')
      for (let index = 0; index < 20; index++) {
        const started = await page.evaluate(() => performance.now())
        await page.keyboard.type(' ')
        await page.waitForFunction(
          (started) =>
            window.syntaxBenchmark.requests.some(
              (request) =>
                request.family === 'tree-sitter' &&
                request.type === 'edit' &&
                request.start >= started &&
                request.end !== undefined,
            ),
          started,
        )
        await waitForWorkers(page, 80)
      }
      await waitForWorkers(page)
      await mark(page, 'edits-settled')
      await step('edited')
      await page.keyboard.press('Control+z')
      await waitForWorkers(page)
      await mark(page, 'scroll-start')
      const bounds = await selectors.editorSurface(page).first().boundingBox()
      ok(bounds)
      await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
      for (let index = 0; index < 20; index++) {
        await page.mouse.wheel(0, index < 10 ? 1200 : -1200)
        await page.waitForTimeout(50)
      }
      await waitForWorkers(page)
      await mark(page, 'scroll-settled')
      await step('scrolled')
    },
    inspect: (page) =>
      page.evaluate(`({
    ...window.syntaxBenchmark,
    diagnostics: window.__editorPerfTrace.report(),
    marks: performance.getEntriesByType('mark').map(m => ({ name: m.name, at: m.startTime, detail: m.detail })),
    resources: performance.getEntriesByType('resource').map(r => ({
      name: r.name, duration: r.duration, transferSize: r.transferSize,
      decodedBodySize: r.decodedBodySize, initiatorType: r.initiatorType
    }))
  })`),
  }
}

async function mark(page: Page, name: string) {
  await page.evaluate((name) => {
    window.syntaxBenchmark.phases.push({ name, at: performance.now() })
    performance.mark(`syntax-benchmark:${name}`)
  }, name)
}

async function waitForWorkers(page: Page, quietMs = 500) {
  await page.waitForTimeout(quietMs)
  await page.waitForFunction(
    (quietMs) => {
      const requests = window.syntaxBenchmark.requests
      return (
        requests.every((request) => request.end !== undefined) &&
        performance.now() -
          Math.max(0, ...requests.map((request) => request.end ?? request.start)) >
          quietMs
      )
    },
    quietMs,
    { timeout: 30_000 },
  )
}

async function assertHighlighting(page: Page, engine: string) {
  const requests = await page.evaluate(() => window.syntaxBenchmark.requests)
  ok(
    requests.some((request) => request.family === 'tree-sitter'),
    'Tree-sitter runs in both modes',
  )
  ok(
    requests.some((request) => request.family === 'shiki') === (engine === 'shiki'),
    'Expected highlighting engine runs',
  )
  const colors = await selectors
    .editorGroupRows(page, 0)
    .first()
    .evaluate((element) =>
      Array.from(CSS.highlights.entries())
        .filter(
          ([name, highlight]) => name.startsWith('editor-shared-token-') && highlight.size > 0,
        )
        .map(([name]) => getComputedStyle(element, `::highlight(${name})`).color),
    )
  ok(new Set(colors).size > 1, 'Syntax colors are actually painted')
}

function observeWorkers() {
  performance.setResourceTimingBufferSize(10_000)
  window.syntaxBenchmark = { workers: [], requests: [], phases: [] }
  const NativeWorker = window.Worker
  const record = (value: unknown): Record<string, unknown> =>
    value && typeof value === 'object' ? Object.fromEntries(Object.entries(value)) : {}

  window.Worker = class extends NativeWorker {
    private readonly pending = new Map<unknown, WorkerSample>()
    private readonly family: string

    constructor(url: string | URL, options?: WorkerOptions) {
      super(url, options)
      const path = String(url)
      this.family = path.includes('shiki') ? 'shiki' : 'other'
      if (path.includes('treeSitter.worker')) this.family = 'tree-sitter'
      window.syntaxBenchmark.workers.push(path)
      this.addEventListener('message', (event: MessageEvent<unknown>) => {
        const data = record(event.data)
        const sample = this.pending.get(data.id)
        if (!sample) return
        sample.end = performance.now()
        sample.durationMs = sample.end - sample.start
        sample.timings = record(data.result).timings
        sample.error = data.error
        this.pending.delete(data.id)
      })
    }

    override postMessage(message: unknown, options?: Transferable[] | StructuredSerializeOptions) {
      if (this.family === 'other') {
        if (Array.isArray(options)) return super.postMessage(message, options)
        return super.postMessage(message, options)
      }
      const data = record(message)
      const payload = record(data.payload)
      const sample: WorkerSample = {
        family: this.family,
        type: payload.type,
        id: data.id,
        start: performance.now(),
        includeHighlights: payload.includeHighlights,
        includeCaptures: payload.includeCaptures,
      }
      this.pending.set(data.id, sample)
      window.syntaxBenchmark.requests.push(sample)
      if (Array.isArray(options)) return super.postMessage(message, options)
      super.postMessage(message, options)
    }
  }
}
