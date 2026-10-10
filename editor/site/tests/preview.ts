import { chromium, type Browser } from 'playwright'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout } from 'node:timers/promises'
import { expect } from 'vitest'

const root = fileURLToPath(new URL('../', import.meta.url))
const require = createRequire(import.meta.url)

export const hasChromium = () => existsSync(chromium.executablePath())

export type Preview = { readonly base: string; readonly browser: Browser; stop(): Promise<void> }

/** Serves the built site under its built base path on a free loopback port. */
export async function startPreview(mode: 'preview' | 'dev' = 'preview'): Promise<Preview> {
  expect(existsSync(join(root, 'dist/index.html')), 'Build the site before browser tests').toBe(
    true,
  )
  const allocation = createServer()
  await new Promise<void>((resolve) => allocation.listen(0, '127.0.0.1', resolve))
  const address = allocation.address()
  expect(address).not.toBeNull()
  const port = typeof address === 'object' && address ? address.port : 0
  await new Promise<void>((resolve) => allocation.close(() => resolve()))
  const home = readFileSync(join(root, 'dist/index.html'), 'utf8')
  const introduction = home.match(/href="([^"]*)docs\/start-here\/introduction\//)
  expect(introduction, 'The built home must link to the documentation').not.toBeNull()
  const prefix = mode === 'dev' ? '' : introduction![1]!.replace(/\/$/, '')
  const base = `http://127.0.0.1:${port}${prefix}`
  const script = (
    JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      scripts: { dev: string }
    }
  ).scripts.dev.split(' ')
  const directAstro = mode === 'preview' || script[0] === 'astro'
  const command = directAstro
    ? [join(dirname(require.resolve('astro/package.json')), 'bin/astro.mjs'), mode]
    : script.slice(1)
  const preview: ChildProcess = spawn(
    directAstro ? process.execPath : script[0]!,
    command.concat(
      ['--ignore-lock', '--host', '127.0.0.1', '--port', String(port)],
      mode === 'dev' ? ['--outDir', './.capture/dev-dist'] : ['--base', `${prefix}/`],
    ),
    {
      cwd: root,
      stdio: 'inherit',
      // Astro omits its HTTP route handler when it inherits Vitest's process marker.
      env: {
        ...process.env,
        VITEST: undefined,
        NODE_ENV: mode === 'dev' ? 'development' : 'production',
      },
    },
  )
  let ready = false
  for (let attempt = 0; attempt < (mode === 'dev' ? 1200 : 100); attempt++) {
    ready = await fetch(`${base}/`)
      .then((response) => response.ok)
      .catch(() => false)
    if (ready || preview.exitCode !== null) break
    await setTimeout(100)
  }
  if (!ready && preview.exitCode === null) {
    preview.kill()
    await new Promise<void>((resolve) => preview.once('exit', () => resolve()))
  }
  expect(ready, 'The owned preview must start').toBe(true)
  // The headless shell disables the back/forward cache through its browser delegate.
  const browser = await chromium.launch({
    channel: 'chromium',
    ignoreDefaultArgs: ['--disable-back-forward-cache'],
  })
  return {
    base,
    browser,
    async stop() {
      await browser.close()
      if (preview.exitCode === null && preview.signalCode === null) {
        preview.kill()
        await new Promise<void>((resolve) => preview.once('exit', () => resolve()))
      }
      expect(
        await fetch(base)
          .then(() => true)
          .catch(() => false),
      ).toBe(false)
    },
  }
}
