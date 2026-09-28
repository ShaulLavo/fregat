import { strictEqual } from 'node:assert/strict'
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium, type CDPSession, type Page } from 'playwright'
import { startIsolatedServer } from '../agent/isolated-server'
import { openFixtureWorkspace, releaseFixture } from '../agent/fixture-workspace'
import { selectors } from '../agent/selectors'
import { createScriptError } from '../structured-errors'
import { expectedEditedHash, fileHash, MARKER, writeFixture } from './fixture'
import { sampleMemory } from './memory'

export type CaseOptions = {
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
  await page.waitForTimeout(200)
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
  for (const file of await readdir(logs))
    await copyFile(path.join(logs, file), path.join(output, file))
}

async function exercise(
  page: Page,
  options: CaseOptions,
  file: string,
  memory: ReturnType<typeof sampleMemory>,
) {
  const cdp = await page.context().newCDPSession(page)
  const expected = await expectedEditedHash(file, options.keys)
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
  const openPeak = memory.read()
  await page.waitForTimeout(options.settleMs)
  const heapAfterOpen = await heapBytes(cdp)
  await writeFile(
    path.join(options.output, 'measurements.json'),
    JSON.stringify({ openToTextMs, openPeak, heapBeforeOpen, heapAfterOpen }),
  )
  await page.screenshot({ path: path.join(options.output, 'opened.png') })
  memory.reset()
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
      keyLatencyMs,
      heapBeforeOpen,
      heapAfterOpen,
      heapAfterTyping,
      openPeak,
      typingPeak,
    }),
  )
  memory.reset()
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
  await page.screenshot({ path: path.join(options.output, 'saved.png') })
  return {
    openToTextMs,
    keyLatencyMs,
    saveMs,
    diskBytes: (await stat(file)).size,
    heapBeforeOpen,
    heapAfterOpen,
    heapAfterTyping,
    heapAfterSave,
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
  writeFixture(file, options.sizeMiB * 1024 * 1024, options.twoByte)
  const server = await startIsolatedServer(new URL('http://localhost:5297'), {
    scratchRoot: options.output,
    webRoot: options.webRoot,
  })
  const memory = sampleMemory(process.pid)
  const browser = await chromium.launch({ headless: true, args: ['--enable-precise-memory-info'] })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  const metadata = {
    ...options,
    browser: browser.version(),
    runtime: Bun.version,
    timestamp: new Date().toISOString(),
  }
  try {
    await page.goto(server.origin)
    await openFixtureWorkspace(page, fixture)
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
    await browser.close()
    await copyLogs(server.logs, options.output)
    await copyFile(
      path.join(server.directory, 'server.stderr'),
      path.join(options.output, 'server.stderr'),
    )
    await releaseFixture(fixture)
    await server.stop()
  }
}
