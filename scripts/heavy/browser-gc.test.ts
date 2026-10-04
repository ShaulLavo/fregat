import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import { chromium } from 'playwright'
import { expect, test } from 'vitest'

const checkoutRoot = path.resolve(import.meta.dirname, '../..')
const webRequire = createRequire(path.join(checkoutRoot, 'apps/web/package.json'))

// Script-only CI jobs have no browser installation; browser-equipped Linux hosts run the proof.
test.skipIf(process.platform !== 'linux' || !existsSync(chromium.executablePath()))(
  'isolated Chromium files collect with abundant temporary disk space',
  async () => {
    const deadline = Date.now() + 60_000
    const slice = process.env.HEAVY_JOB_SLICE
    if (slice) expect(await readFile('/proc/self/cgroup', 'utf8')).toContain(`/${slice}/`)
    const cache = path.join(checkoutRoot, 'node_modules/.cache')
    await mkdir(cache, { recursive: true })
    const root = await mkdtemp(path.join(cache, 'browser-gc-'))
    try {
      await symlink(
        path.join(checkoutRoot, 'apps/web/node_modules'),
        path.join(root, 'node_modules'),
      )
      await writeFile(
        path.join(root, 'vitest.config.mjs'),
        `import { PlaywrightBrowserProvider, playwright } from ${JSON.stringify(webRequire.resolve('@vitest/browser-playwright'))}
class ObservedProvider extends PlaywrightBrowserProvider {
  async getCDPSession(sessionId) {
    const cdp = await super.getCDPSession(sessionId)
    return { ...cdp, async send(method, params) {
      if (method !== 'HeapProfiler.collectGarbage') return cdp.send(method, params)
      console.log('POSITIVE_GC_READY')
      const result = await cdp.send(method, params)
      console.log('POSITIVE_GC_COMPLETED')
      return result
    } }
  }
  async close() {
    await super.close()
    console.log('POSITIVE_OWNED_BROWSER_CLOSED')
  }
}
export default {
  test: {
    include: ['spec-*.test.ts'], fileParallelism: false,
    api: { host: '127.0.0.1', strictPort: false },
    browser: { enabled: true, headless: true, screenshotFailures: false,
      provider: { ...playwright(), providerFactory: (project) => new ObservedProvider(project, {}) }, instances: [{ browser: 'chromium' }] }
  }
}
`,
      )
      for (const file of ['spec-a.test.ts', 'spec-b.test.ts']) {
        await writeFile(
          path.join(root, file),
          "import { expect, test } from 'vitest'\ntest('isolated file', () => expect(1).toBe(1))\n",
        )
      }
      const capped = await runBrowser(root, slice, deadline)
      expect(capped.match(/triggered: true/g), capped).toHaveLength(2)
      expect(capped, capped).toMatch(/cdpSendMs: \d/)
      expect(capped, capped).not.toContain('failed to collect Chromium garbage')

      const standalone = await runBrowser(root, undefined, deadline)
      expect(standalone.match(/triggered: true/g), standalone).toHaveLength(2)
      expect(standalone, standalone).toMatch(/cdpSendMs: \d/)
      expect(standalone, standalone).not.toContain('failed to collect Chromium garbage')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  },
  60_000,
)

async function runBrowser(root: string, slice: string | undefined, deadline: number) {
  const remaining = deadline - Date.now() - 1_000
  expect(remaining, 'overall positive proof retains owned cleanup grace').toBeGreaterThan(0)
  const env = { ...process.env }
  if (slice) env.HEAVY_JOB_SLICE = slice
  else delete env.HEAVY_JOB_SLICE
  const child = Bun.spawn(
    [
      'node',
      path.join(path.dirname(webRequire.resolve('vitest/package.json')), 'vitest.mjs'),
      'run',
    ],
    {
      cwd: root,
      env: {
        ...env,
        DEBUG: 'vitest:browser:gc',
        VITEST_MAX_WORKERS: '1',
        // A tiny disk threshold keeps this check independent of other jobs' /tmp consumption.
        VITEST_CHROMIUM_GC_DISK_THRESHOLD_GB: '0.000001',
      },
      timeout: remaining,
      killSignal: 'SIGTERM',
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    },
  )
  let phaseTimer: ReturnType<typeof setTimeout> | undefined
  const stdout = (async () => {
    const reader = child.stdout.getReader()
    const decoder = new TextDecoder()
    let output = ''
    let observed = 0
    try {
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
        output += decoder.decode(chunk.value, { stream: true })
        const complete = output.lastIndexOf('\n') + 1
        const lines = output.slice(observed, complete).split('\n')
        observed = complete
        for (const line of lines) {
          if (line === 'POSITIVE_GC_READY') {
            if (phaseTimer) clearTimeout(phaseTimer)
            phaseTimer = setTimeout(() => child.kill('SIGTERM'), 20_000)
          }
          if (line === 'POSITIVE_GC_COMPLETED' && phaseTimer) {
            clearTimeout(phaseTimer)
            phaseTimer = undefined
          }
        }
      }
      return output + decoder.decode()
    } finally {
      reader.releaseLock()
    }
  })()
  try {
    const [code, text, stderr] = await Promise.all([
      child.exited,
      stdout,
      new Response(child.stderr).text(),
    ])
    const output = stripVTControlCharacters(`${text}\n${stderr}`)
    expect(code, output).toBe(0)
    expect(output.match(/^POSITIVE_GC_READY$/gm), output).toHaveLength(2)
    expect(output.match(/^POSITIVE_GC_COMPLETED$/gm), output).toHaveLength(2)
    expect(output, output).toContain('POSITIVE_OWNED_BROWSER_CLOSED')
    expect(output, output).toMatch(/Test Files\s+2 passed/)
    expect(output, output).toMatch(/Tests\s+2 passed/)
    return output
  } finally {
    if (phaseTimer) clearTimeout(phaseTimer)
    if (child.exitCode === null) child.kill('SIGTERM')
    await child.exited
  }
}
