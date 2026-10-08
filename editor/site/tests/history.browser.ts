import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type { Browser } from 'playwright'
import { hasChromium, startPreview, type Preview } from './preview'

describe.skipIf(!hasChromium())(
  'editor history restoration (requires installed Chromium and a built site)',
  () => {
    let preview: Preview
    let browser: Browser
    let base: string

    beforeAll(async () => {
      preview = await startPreview()
      browser = preview.browser
      base = preview.base
    })

    afterAll(async () => {
      await preview?.stop()
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

    test.each([['playground', '[data-singapore-playground]']])(
      '%s survives persisted transitions and history navigation',
      async (route, host) => {
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
          await page.evaluate(() =>
            window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })),
          )
          await expect.poll(() => viewport.count()).toBe(0)
        } finally {
          await page.close()
        }
      },
    )
  },
)
