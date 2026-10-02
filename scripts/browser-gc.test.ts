import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import { chromium } from 'playwright'
import { expect, test } from 'vitest'

const checkoutRoot = path.resolve(import.meta.dirname, '..')
const webRequire = createRequire(path.join(checkoutRoot, 'apps/web/package.json'))
const unavailable = process.platform !== 'linux' || !existsSync(chromium.executablePath())
if (unavailable)
  console.info('Chromium GC proof requires Linux and an installed Playwright Chromium.')

test.skipIf(unavailable)(
  'unresponsive Chromium collection fails the run before the following file',
  async () => {
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
      if (method === 'HeapProfiler.collectGarbage') return new Promise(() => {})
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
        "import { expect, test } from 'vitest'\ntest('completed before collection', () => expect(1).toBe(1))\n",
      )
      await writeFile(
        path.join(root, 'spec-b.test.ts'),
        "import { expect, test } from 'vitest'\ntest('following file', () => { console.log('FOLLOWING_FILE_STARTED'); expect(2).toBe(2) })\n",
      )
      const output = await runBrowser(root)
      expect(output).toContain('spec-a.test.ts')
      expect(output).toContain('post-file Chromium garbage collection exceeded teardownTimeout')
      expect(output).toContain('1000ms')
      expect(output).toContain('OWNED_BROWSER_CLOSED')
      expect(output).not.toContain('FOLLOWING_FILE_STARTED')
      expect(output).toMatch(/Test Files\s+1 passed/)
      expect(output).toMatch(/Tests\s+1 passed/)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  },
  15_000,
)

async function runBrowser(root: string): Promise<string> {
  const child = Bun.spawn(
    [
      'node',
      path.join(path.dirname(webRequire.resolve('vitest/package.json')), 'vitest.mjs'),
      'run',
    ],
    {
      cwd: root,
      env: { ...process.env, VITEST_MAX_WORKERS: '1' },
      timeout: 8_000,
      killSignal: 'SIGTERM',
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    },
  )
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  const output = stripVTControlCharacters(`${stdout}\n${stderr}`)
  expect(code, output).toBe(1)
  return output
}
