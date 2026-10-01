import { strictEqual } from 'node:assert/strict'
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium, type CDPSession, type Page } from 'playwright'
import { startIsolatedServer } from '../agent/isolated-server'
import { openFixtureWorkspace, releaseFixture } from '../agent/fixture-workspace'
import { paintedTokenColors, selectors } from '../agent/selectors'
import { createScriptError } from '../structured-errors'
import { expectedEditedHash, fileHash, MARKER, writeFixture } from './fixture'
import { hostLabel, renderingPath } from './host'
import { sampleMemory } from './memory'
import { workerHeaps } from './workers'

export type Highlighting = 'default' | 'shiki' | 'tree-sitter'

export type CaseOptions = {
  readonly highlighting: Highlighting
  readonly sizeMiB: number
  readonly extension: 'txt' | 'ts'
  readonly twoByte: boolean
  readonly keys: number
  readonly settleMs: number
  readonly output: string
  readonly webRoot: string
  readonly profile: boolean
}

async function heapBytes(cdp: CDPSession) {
  await cdp.send('HeapProfiler.collectGarbage')
  const usage = await cdp.send('Runtime.getHeapUsage')
  return { usedBytes: usage.usedSize, backingBytes: usage.backingStorageSize }
}

async function typeBurst(page: Page, keys: number) {
  await selectors
    .editorSurface(page)
    .first()
    .click({ position: { x: 180, y: 12 } })
  await selectors.editorInput(page).first().focus()
  await page.keyboard.press('Control+Home')
  await page.evaluate(() => {
    performance.clearMeasures('large-file-key')
    const input = document.activeElement
    input?.addEventListener('keydown', (event) => {
      if (!(event instanceof KeyboardEvent) || event.key !== 'x') return
      const start = event.timeStamp
      requestAnimationFrame(() =>
        performance.measure('large-file-key', { start, end: performance.now() }),
      )
    })
  })
  for (let index = 0; index < keys; index += 1) {
    await page.keyboard.press('x')
    await page.waitForTimeout(80)
  }
  // A fixed pause dropped the last frames on a host that rasterizes in software (~650 ms a frame).
  // On timeout the assertion below reports how many frames landed.
  await page
    .waitForFunction(
      (expected) => performance.getEntriesByName('large-file-key').length >= expected,
      keys,
      { timeout: 30_000 },
    )
    .catch(() => {})
  const values = await page.evaluate(() =>
    performance.getEntriesByName('large-file-key').map((entry) => entry.duration),
  )
  strictEqual(values.length, keys, 'Every input must reach a painted frame')
  values.sort((a, b) => a - b)
  return {
    count: values.length,
    p50: values[Math.floor(values.length * 0.5)],
    p95: values[Math.min(values.length - 1, Math.ceil(values.length * 0.95) - 1)],
    max: values.at(-1),
  }
}

async function copyLogs(logs: string, output: string) {
  const files = await readdir(logs).catch(async (error: unknown) => {
    await writeFile(path.join(output, 'log-capture-error.txt'), String(error))
    return []
  })
  for (const file of files) await copyFile(path.join(logs, file), path.join(output, file))
}

async function highlightingReady(page: Page, options: CaseOptions, openedAt: number) {
  if (options.extension !== 'ts') return { state: 'plain' }
  const notice = page.getByTestId('large-file-mode')
  if ((await notice.count()) && (await notice.innerText()).includes('syntax'))
    return { state: 'paused' }
  await page.waitForFunction(
    () =>
      Array.from(CSS.highlights.entries()).filter(
        ([name, highlight]) => name.startsWith('editor-shared-token-') && highlight.size > 0,
      ).length > 1,
    undefined,
    { timeout: 60_000 },
  )
  const colors = new Set(await paintedTokenColors(selectors.editorRows(page).first()))
  strictEqual(colors.size > 1, true, 'The requested syntax engine must paint distinct token colors')
  return {
    state: 'active',
    openToHighlightMs: performance.now() - openedAt,
    colorCount: colors.size,
  }
}

async function exercise(
  page: Page,
  options: CaseOptions,
  file: string,
  memory: ReturnType<typeof sampleMemory>,
) {
  const cdp = await page.context().newCDPSession(page)
  const expected = await expectedEditedHash(file, options.keys)
  await page.evaluate(() => performance.mark('fregat:step:open'))
  const heapBeforeOpen = await heapBytes(cdp)
  memory.reset()
  const openedAt = performance.now()
  await selectors
    .folderTree(page)
    .getByRole('treeitem', { name: `big.${options.extension}`, exact: true })
    .first()
    .click()
  await selectors.editorRows(page).filter({ hasText: MARKER }).first().waitFor({ timeout: 120_000 })
  const openToTextMs = performance.now() - openedAt
  const highlighting = await highlightingReady(page, options, openedAt)
  const openPeak = memory.read()
  await page.waitForTimeout(options.settleMs)
  const heapAfterOpen = await heapBytes(cdp)
  await writeFile(
    path.join(options.output, 'measurements.json'),
    JSON.stringify({ openToTextMs, highlighting, openPeak, heapBeforeOpen, heapAfterOpen }),
  )
  const workersAfterOpen = await workerHeaps(page.context().browser()!)
  if (highlighting.state === 'active' && options.highlighting !== 'default') {
    strictEqual(
      workersAfterOpen.some((worker) => worker.url.includes('treeSitter.worker')),
      true,
    )
    strictEqual(
      workersAfterOpen.some((worker) => worker.url.includes('shiki.worker')),
      options.highlighting === 'shiki',
      'The requested highlighting engine must own the active workers',
    )
  }
  await writeFile(
    path.join(options.output, 'measurements.json'),
    JSON.stringify({
      openToTextMs,
      highlighting,
      openPeak,
      heapBeforeOpen,
      heapAfterOpen,
      workersAfterOpen,
    }),
  )
  await page.screenshot({ path: path.join(options.output, 'opened.png') })
  memory.reset()
  await page.evaluate(() => performance.mark('fregat:step:type'))
  if (options.profile) {
    await cdp.send('Profiler.enable')
    await cdp.send('Profiler.start')
  }
  const keyLatencyMs = await typeBurst(page, options.keys)
  if (options.profile) {
    const { profile } = await cdp.send('Profiler.stop')
    await writeFile(path.join(options.output, 'typing.cpuprofile'), JSON.stringify(profile))
  }
  const typingPeak = memory.read()
  const heapAfterTyping = await heapBytes(cdp)
  await writeFile(
    path.join(options.output, 'measurements.json'),
    JSON.stringify({
      openToTextMs,
      highlighting,
      keyLatencyMs,
      heapBeforeOpen,
      heapAfterOpen,
      workersAfterOpen,
      heapAfterTyping,
      openPeak,
      typingPeak,
    }),
  )
  memory.reset()
  await page.evaluate(() => performance.mark('fregat:step:save'))
  const savedAt = performance.now()
  const [saved] = await Promise.all([
    page.waitForResponse((item) => new URL(item.url()).pathname.endsWith('/fs/write'), {
      timeout: 120_000,
    }),
    page.keyboard.press('Control+s'),
  ])
  const saveMs = performance.now() - savedAt
  strictEqual(saved.status(), 200, 'Save must succeed for every supported open size')
  await saved.finished()
  strictEqual(
    await fileHash(file),
    expected,
    'Saved bytes must exactly match the original plus typed text',
  )
  await page.waitForTimeout(1500)
  const heapAfterSave = await heapBytes(cdp)
  const workersAfterSave = await workerHeaps(page.context().browser()!)
  await page.screenshot({ path: path.join(options.output, 'saved.png') })
  return {
    openToTextMs,
    highlighting,
    keyLatencyMs,
    saveMs,
    diskBytes: (await stat(file)).size,
    heapBeforeOpen,
    heapAfterOpen,
    heapAfterTyping,
    heapAfterSave,
    workersAfterOpen,
    workersAfterSave,
    openPeak,
    typingPeak,
    savePeak: memory.read(),
  }
}

export async function runCase(options: CaseOptions) {
  await mkdir(options.output, { recursive: true })
  const fixture = path.join(options.output, 'fixture')
  await mkdir(fixture)
  const file = path.join(fixture, `big.${options.extension}`)
  const initialBytes = options.sizeMiB * 1024 * 1024 - options.keys
  writeFixture(file, initialBytes, options.twoByte, options.extension === 'ts')
  const server = await startIsolatedServer(new URL('http://localhost:5297'), {
    scratchRoot: options.output,
    webRoot: options.webRoot,
    settings:
      options.highlighting === 'default'
        ? {}
        : {
            'workbench.colorTheme': 'light',
            'editor.codeTheme.light':
              options.highlighting === 'shiki' ? 'light-plus' : 'tree-sitter-light',
            'editor.codeTheme.dark':
              options.highlighting === 'shiki' ? 'dark-plus' : 'tree-sitter-dark',
          },
  })
  const memory = sampleMemory(process.pid)
  const browser = await chromium.launch({ headless: true, args: ['--enable-precise-memory-info'] })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const metadata = {
    ...options,
    initialBytes,
    corpus: `${options.extension === 'ts' ? 'scoped-functions-v2' : 'folded-functions-v1'}${options.twoByte ? '-unicode-body-v2' : ''}`,
    browser: browser.version(),
    host: hostLabel(),
    rendering: await renderingPath(page),
    runtime: Bun.version,
    timestamp: new Date().toISOString(),
  }
  try {
    await page.goto(server.origin)
    await openFixtureWorkspace(page, fixture)
    if (options.profile)
      await browser.startTracing(page, {
        path: path.join(options.output, 'trace.json'),
        categories: [
          'devtools.timeline',
          'disabled-by-default-devtools.timeline',
          'blink.user_timing',
          'v8.execute',
          'disabled-by-default-v8.cpu_profiler',
        ],
      })
    const metrics = await exercise(page, options, file, memory)
    if (errors.length > 0) throw createScriptError(`Browser errors: ${errors.join('; ')}`)
    return { ...metadata, status: 'passed', metrics, errors }
  } catch (error) {
    await page
      .screenshot({ path: path.join(options.output, 'failed.png'), timeout: 5000 })
      .catch(() => {})
    return {
      ...metadata,
      status: 'failed',
      metrics: await readFile(path.join(options.output, 'measurements.json'), 'utf8').then(
        (text) => JSON.parse(text),
        () => null,
      ),
      error: String(error),
      errors,
      peak: memory.read(),
    }
  } finally {
    memory.stop()
    if (options.profile) await browser.stopTracing().catch(() => {})
    await browser.close()
    await copyLogs(server.logs, options.output)
    await copyFile(
      path.join(server.directory, 'server.stderr'),
      path.join(options.output, 'server.stderr'),
    ).catch(async (error: unknown) => {
      await writeFile(path.join(options.output, 'stderr-capture-error.txt'), String(error))
    })
    await releaseFixture(fixture)
    await server.stop()
  }
}
