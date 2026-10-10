import { existsSync } from 'node:fs'
import { chromium, firefox, type Browser, type Page } from 'playwright'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { openStaticPreview, STATIC_PREVIEW_URL } from './static-preview'

const image =
  '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="blue"/></svg>'

for (const engine of [chromium, firefox]) {
  const unavailable = !existsSync(engine.executablePath())
  if (unavailable)
    console.info(`Static preview tests require installed Playwright ${engine.name()}.`)

  describe.skipIf(unavailable)(`static preview readiness (${engine.name()})`, () => {
    let browser: Browser
    let page: Page

    beforeAll(async () => {
      browser = await engine.launch()
    })
    afterAll(async () => {
      await browser?.close()
    })
    beforeEach(async () => {
      page = await browser.newPage({ viewport: { width: 390, height: 844 } })
    })
    afterEach(async () => {
      await page?.close()
    })

    async function documentWithImage(loading: string, top: number) {
      await page.route(STATIC_PREVIEW_URL, (route) =>
        route.fulfill({
          contentType: 'text/html',
          body: `<main style="min-height:100vh"><img loading="${loading}" src="image.svg" width="40" height="40" style="position:absolute;top:${top}px"></main>`,
        }),
      )
    }

    test('becomes ready with an offscreen lazy image that has not started loading', async () => {
      await documentWithImage('lazy', 100_000)
      let requested = false
      await page.route('**/image.svg', async (route) => {
        requested = true
        await route.fulfill({ contentType: 'image/svg+xml', body: image })
      })
      let ready: boolean | undefined
      const readiness = openStaticPreview(page).then((result) => {
        ready = result
      })
      await expect.poll(() => ready, { timeout: 3_000 }).toBe(true)
      await readiness
      expect(requested).toBe(false)
      expect(
        await page.locator('img').evaluate((element: HTMLImageElement) => ({
          source: element.currentSrc,
          width: element.naturalWidth,
        })),
      ).toEqual({ source: '', width: 0 })
    })

    test.each([
      ['lazy', 20],
      ['eager', 100_000],
    ])('awaits a loading %s image at y=%d until it decodes', async (loading, top) => {
      await documentWithImage(loading, top)
      let release!: () => void
      const held = new Promise<void>((resolve) => {
        release = resolve
      })
      let requested = false
      await page.route('**/image.svg', async (route) => {
        requested = true
        await held
        await route.fulfill({ contentType: 'image/svg+xml', body: image })
      })
      let ready: boolean | undefined
      const readiness = openStaticPreview(page).then((result) => {
        ready = result
      })
      try {
        await expect.poll(() => requested).toBe(true)
        await page.waitForTimeout(750)
        expect(ready).toBeUndefined()
        release()
        await readiness
        expect(ready).toBe(true)
        expect(
          await page.locator('img').evaluate((element: HTMLImageElement) => element.naturalWidth),
        ).toBe(40)
      } finally {
        release()
      }
    })

    test('a failed visible image keeps the preview unready', async () => {
      await documentWithImage('lazy', 20)
      await page.route('**/image.svg', (route) => route.fulfill({ status: 404, body: 'Not found' }))
      expect(await openStaticPreview(page)).toBe(false)
    })
  })
}
