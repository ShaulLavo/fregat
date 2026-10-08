import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { chromium, type Browser } from 'playwright'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout } from 'node:timers/promises'

const root = fileURLToPath(new URL('../', import.meta.url))
const require = createRequire(import.meta.url)

describe.skipIf(!existsSync(chromium.executablePath()))(
  'editor history restoration (requires installed Chromium and a built site)',
  () => {
    let preview: ChildProcess
    let browser: Browser
    let base: string

    beforeAll(async () => {
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
      const prefix = introduction![1].replace(/\/$/, '')
      base = `http://127.0.0.1:${port}${prefix}`
      preview = spawn(
        process.execPath,
        [
          join(dirname(require.resolve('astro/package.json')), 'bin/astro.mjs'),
          'preview',
          '--base',
          `${prefix}/`,
          '--ignore-lock',
          '--host',
          '127.0.0.1',
          '--port',
          String(port),
        ],
        { cwd: root, stdio: 'inherit' },
      )
      let ready = false
      for (let attempt = 0; attempt < 100; attempt++) {
        ready = await fetch(`${base}/`)
          .then((response) => response.ok)
          .catch(() => false)
        if (ready || preview.exitCode !== null) break
        await setTimeout(100)
      }
      expect(ready, 'The owned preview must start').toBe(true)
      // The headless shell disables the back/forward cache through its browser delegate.
      browser = await chromium.launch({
        channel: 'chromium',
        ignoreDefaultArgs: ['--disable-back-forward-cache'],
      })
    })

    afterAll(async () => {
      await browser?.close()
      if (!preview) return
      if (preview.exitCode === null && preview.signalCode === null) {
        preview.kill()
        await new Promise<void>((resolve) => preview.once('exit', () => resolve()))
      }
      expect(
        await fetch(base)
          .then(() => true)
          .catch(() => false),
      ).toBe(false)
    })

    test('search results stay under the built base path', async () => {
      const page = await browser.newPage()
      try {
        await page.goto(`${base}/docs/start-here/introduction/`)
        await page.locator('button[data-open-modal]').click()
        const search = page.locator('#starlight__search input')
        await search.fill('playground')
        const result = page
          .locator('.pagefind-ui__result-link')
          .filter({ hasText: 'playground' })
          .first()
        await result.waitFor()
        expect(await result.getAttribute('href')).toContain(
          `${new URL(base).pathname.replace(/\/$/, '')}/docs/`,
        )
        await result.click()
        await page.locator('[data-singapore-playground] .editor-virtualized-viewport').waitFor()
        expect(page.url()).toContain('/docs/start-here/playground/')
      } finally {
        await page.close()
      }
    })

    test('the playground loads workers and grammars under the built base path', async () => {
      const page = await browser.newPage()
      const errors: string[] = []
      const assets: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      page.on('response', (response) => {
        if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`)
        if (/worker|tree-sitter-typescript/.test(response.url())) assets.push(response.url())
      })
      try {
        await page.goto(`${base}/docs/start-here/playground/`)
        const viewport = page.locator('[data-singapore-playground] .editor-virtualized-viewport')
        await viewport.waitFor()
        await viewport.click()
        await page.keyboard.press('Control+End')
        await page.keyboard.type('// production base')
        await expect.poll(() => viewport.innerText()).toContain('// production base')
        await expect
          .poll(() => assets.filter((url) => /tree-sitter-typescript/.test(url)).length)
          .toBeGreaterThan(0)
        await expect
          .poll(() => assets.filter((url) => /typescript.*worker/.test(url)).length)
          .toBeGreaterThan(0)
        await expect
          .poll(
            () =>
              page.evaluate(() =>
                [...CSS.highlights.entries()].some(
                  ([name, highlight]) =>
                    name.endsWith('typescript-lsp-error') && highlight.size > 0,
                ),
              ),
            { timeout: 10_000 },
          )
          .toBe(true)
        expect(assets.every((url) => url.startsWith(`${base}/`))).toBe(true)
        expect(errors).toEqual([])
      } finally {
        await page.close()
      }
    })

    test.each([
      ['quick-start', '[data-singapore-example]'],
      ['playground', '[data-singapore-playground]'],
    ])('%s survives persisted transitions and history navigation', async (route, host) => {
      const page = await browser.newPage()
      try {
        await page.goto(`${base}/docs/start-here/${route}/`)
        const viewport = page.locator(`${host} .editor-virtualized-viewport`)
        await viewport.waitFor()
        await page.evaluate(() => {
          window.addEventListener('pageshow', (event) => {
            document.documentElement.dataset.restoredFromCache = String(event.persisted)
          })
          window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))
        })
        await expect.poll(() => viewport.count()).toBe(1)
        await viewport.click()
        await page.keyboard.press('Control+End')
        await page.keyboard.type('// before history')
        await expect.poll(() => viewport.innerText()).toContain('// before history')
        await page.goto(`${base}/docs/start-here/introduction/`)
        await page.goBack({ waitUntil: 'commit' })
        await viewport.waitFor()
        await viewport.click()
        await page.keyboard.press('Control+End')
        await page.keyboard.type('// after history')
        await expect.poll(() => viewport.innerText()).toContain('// after history')
        if (route === 'quick-start') {
          expect(await page.locator('html').getAttribute('data-restored-from-cache')).toBe('true')
          expect(await viewport.innerText()).toContain('// before history')
        }
        await page.evaluate(() =>
          window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })),
        )
        await expect.poll(() => viewport.count()).toBe(0)
      } finally {
        await page.close()
      }
    })
  },
)
