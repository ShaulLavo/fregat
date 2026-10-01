import { createRequire } from 'node:module'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { expect, test } from 'vitest'

const checkoutRoot = path.resolve(import.meta.dirname, '../..')
const webRequire = createRequire(path.join(checkoutRoot, 'apps/web/package.json'))

// The installed wrapper supplies the real capped cgroup; CI runs without that local scheduler.
test.skipIf(!process.env.HEAVY_JOB_SLICE)(
  'capped Chromium runs collect at file boundaries while standalone runs keep disk-based GC',
  async () => {
    const slice = process.env.HEAVY_JOB_SLICE!
    expect(await readFile('/proc/self/cgroup', 'utf8')).toContain(`/${slice}/`)
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
        `import { playwright } from ${JSON.stringify(webRequire.resolve('@vitest/browser-playwright'))}
export default {
  test: {
    include: ['spec-*.test.ts'],
    api: { host: '127.0.0.1', strictPort: false },
    browser: { enabled: true, headless: true, screenshotFailures: false,
      provider: playwright(), instances: [{ browser: 'chromium' }] }
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
      const capped = await runBrowser(root, slice)
      expect(capped.match(/triggered: true/g), capped).toHaveLength(2)
      expect(capped, capped).toMatch(/cdpSendMs: \d/)
      expect(capped, capped).not.toContain('failed to collect Chromium garbage')

      const standalone = await runBrowser(root, undefined)
      expect(standalone.match(/triggered: false/g), standalone).toHaveLength(2)
      expect(standalone, standalone).not.toContain('triggered: true')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  },
  60_000,
)

async function runBrowser(root: string, slice: string | undefined) {
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
      timeout: 20_000,
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
  const output = `${stdout}\n${stderr}`
  expect(code, output).toBe(0)
  expect(output, output).toMatch(/Test Files\s+2 passed/)
  expect(output, output).toMatch(/Tests\s+2 passed/)
  return output
}
