import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import { chromium } from 'playwright'
import { expect, test, vi } from 'vitest'

const checkoutRoot = path.resolve(import.meta.dirname, '..')
const webRequire = createRequire(path.join(checkoutRoot, 'apps/web/package.json'))
const unavailable = process.platform !== 'linux' || !existsSync(chromium.executablePath())
if (unavailable)
  console.info('Chromium GC proof requires Linux and an installed Playwright Chromium.')

test.skipIf(unavailable).each(['healthy', 'unresponsive'] as const)(
  '%s Chromium collection proves post-file cleanup and continuation policy',
  async (mode) => {
    const deadline = Date.now() + 15_000
    const cache = path.join(checkoutRoot, 'node_modules/.cache')
    await mkdir(cache, { recursive: true })
    const root = await mkdtemp(path.join(cache, 'browser-gc-timeout-'))
    try {
      await symlink(
        path.join(checkoutRoot, 'apps/web/node_modules'),
        path.join(root, 'node_modules'),
      )
      await writeFile(
        path.join(root, 'vitest.config.mjs'),
        `import { PlaywrightBrowserProvider, playwright } from ${JSON.stringify(webRequire.resolve('@vitest/browser-playwright'))}
import { BaseSequencer } from 'vitest/node'
class Ordered extends BaseSequencer {
  sort(files) { return files.sort((a, b) => a.moduleId.localeCompare(b.moduleId)) }
}
class StallingProvider extends PlaywrightBrowserProvider {
  async getCDPSession(sessionId) {
    const cdp = await super.getCDPSession(sessionId)
    return { ...cdp, send(method, params) {
      if (method === 'HeapProfiler.collectGarbage') {
        console.log('GC_COLLECTION_STARTED')
        if (${JSON.stringify(mode === 'unresponsive')}) return new Promise(() => {})
        return cdp.send(method, params).then((result) => {
          console.log('GC_COLLECTION_COMPLETED')
          return result
        })
      }
      return cdp.send(method, params)
    } }
  }
  async close() {
    await super.close()
    console.log('OWNED_BROWSER_CLOSED')
  }
}
export default {
  test: {
    include: ['spec-*.test.ts'], fileParallelism: false, teardownTimeout: 1000,
    sequence: { sequencer: Ordered },
    reporters: ['default', {
      onTestCaseReady(testCase) {
        if (testCase.name === 'following file') console.log('FOLLOWING_FILE_STARTED')
      },
      onTestCaseResult(testCase) {
        if (testCase.name === 'completed before collection' && testCase.result().state === 'passed')
          console.log('FIRST_FILE_COMPLETED spec-a.test.ts')
      }
    }],
    api: { host: '127.0.0.1', strictPort: false },
    browser: { enabled: true, headless: true, screenshotFailures: false,
      provider: { ...playwright(), providerFactory: (project) => new StallingProvider(project, {}) },
      instances: [{ browser: 'chromium' }] }
  }
}
`,
      )
      await writeFile(
        path.join(root, 'spec-a.test.ts'),
        "import { expect, test } from 'vitest'\ntest('completed before collection', () => { expect(1).toBe(1) })\n",
      )
      await writeFile(
        path.join(root, 'spec-b.test.ts'),
        "import { expect, test } from 'vitest'\ntest('following file', () => { expect(2).toBe(2) })\n",
      )
      const output = await runBrowser(root, mode, deadline)
      expect(output).toContain('FIRST_FILE_COMPLETED')
      expect(output).toContain('GC_COLLECTION_STARTED')
      expect(output.indexOf('FIRST_FILE_COMPLETED')).toBeLessThan(
        output.indexOf('GC_COLLECTION_STARTED'),
      )
      expect(output).toContain('spec-a.test.ts')
      expect(output).toContain('OWNED_BROWSER_CLOSED')
      if (mode === 'healthy') {
        expect(output).toContain('GC_COLLECTION_COMPLETED')
        expect(output).toContain('FOLLOWING_FILE_STARTED')
        expect(output).toMatch(/Test Files\s+2 passed/)
        expect(output).toMatch(/Tests\s+2 passed/)
      } else {
        expect(output).toContain('post-file Chromium garbage collection exceeded teardownTimeout')
        expect(output).toContain('1000ms')
        expect(output).not.toContain('GC_COLLECTION_COMPLETED')
        expect(output).not.toContain('FOLLOWING_FILE_STARTED')
        expect(output).toMatch(/Test Files\s+1 passed/)
        expect(output).toMatch(/Tests\s+1 passed/)
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  },
  15_000,
)

function collectionWatchdog(terminate: () => void) {
  let timer: ReturnType<typeof setTimeout> | undefined
  return {
    observe(output: string) {
      if (timer || !output.includes('GC_COLLECTION_STARTED')) return
      timer = setTimeout(terminate, 8_000)
    },
    dispose() {
      if (timer) clearTimeout(timer)
    },
  }
}

test('startup does not consume collection grace and split phase markers arm it once', () => {
  vi.useFakeTimers()
  const terminate = vi.fn()
  const watchdog = collectionWatchdog(terminate)
  try {
    watchdog.observe('RUN and API started')
    vi.advanceTimersByTime(8_000)
    expect(terminate).not.toHaveBeenCalled()
    watchdog.observe('FIRST_FILE_COMPLETED GC_COLLECTION_STA')
    vi.advanceTimersByTime(8_000)
    expect(terminate).not.toHaveBeenCalled()
    watchdog.observe('FIRST_FILE_COMPLETED GC_COLLECTION_STARTED')
    vi.advanceTimersByTime(7_999)
    watchdog.observe('FIRST_FILE_COMPLETED GC_COLLECTION_STARTED more output')
    expect(terminate).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(terminate).toHaveBeenCalledTimes(1)
  } finally {
    watchdog.dispose()
    vi.useRealTimers()
  }
})

async function readOutput(stream: ReadableStream<Uint8Array>, observe: (output: string) => void) {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let output = ''
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      output += decoder.decode(chunk.value, { stream: true })
      observe(output)
    }
    return output + decoder.decode()
  } finally {
    reader.releaseLock()
  }
}

async function runBrowser(
  root: string,
  mode: 'healthy' | 'unresponsive',
  deadline: number,
): Promise<string> {
  const remaining = deadline - Date.now() - 1_000
  expect(remaining, 'overall proof deadline leaves the existing teardown grace').toBeGreaterThan(0)
  const child = Bun.spawn(
    [
      'node',
      path.join(path.dirname(webRequire.resolve('vitest/package.json')), 'vitest.mjs'),
      'run',
    ],
    {
      cwd: root,
      env: { ...process.env, VITEST_MAX_WORKERS: '1' },
      timeout: remaining,
      killSignal: 'SIGTERM',
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    },
  )
  const watchdog = collectionWatchdog(() => child.kill('SIGTERM'))
  try {
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      readOutput(child.stdout, watchdog.observe),
      new Response(child.stderr).text(),
    ])
    const output = stripVTControlCharacters(`${stdout}\n${stderr}`)
    expect(code, output).toBe(mode === 'healthy' ? 0 : 1)
    return output
  } finally {
    watchdog.dispose()
    if (child.exitCode === null) child.kill('SIGTERM')
    await child.exited
  }
}
