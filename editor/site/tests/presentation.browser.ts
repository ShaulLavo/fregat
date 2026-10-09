import { existsSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { devices, webkit, type Browser, type Page } from 'playwright'
import { hasChromium, startPreview, type Preview } from './preview'

async function syntaxInk(page: Page, encoded: string, surface: string): Promise<number> {
  return page.evaluate(
    async ({ encoded, surface }) => {
      const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0))
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
      const canvas = document.createElement('canvas')
      canvas.width = bitmap.width
      canvas.height = bitmap.height
      const context = canvas.getContext('2d')!
      context.drawImage(bitmap, 0, 0)
      bitmap.close()
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height)
      let count = 0
      for (let index = 0; index < data.length; index += 4) {
        const red = data[index]!
        const green = data[index + 1]!
        const blue = data[index + 2]!
        const warm = red > green + 20 && green > blue + 10
        const codeBlue = blue > red + 20 && green > red + 10
        if (surface === 'home' ? warm : codeBlue) count++
      }
      return count
    },
    { encoded, surface },
  )
}

for (const engine of ['chromium', 'webkit', 'phone-webkit', 'iphone-webkit'] as const) {
  const available = hasChromium() && (engine === 'chromium' || existsSync(webkit.executablePath()))
  describe.skipIf(!available)(
    `${engine} hidden presentation paint (requires built site and installed browser)`,
    () => {
      let preview: Preview
      let browser: Browser
      beforeAll(async () => {
        preview = await startPreview()
        browser = engine === 'chromium' ? preview.browser : await webkit.launch()
      })
      afterAll(async () => {
        if (engine !== 'chromium') await browser?.close()
        await preview?.stop()
      })
      const cases = ['home', 'manual'].flatMap((surface) =>
        ['light', 'dark'].flatMap((theme) =>
          [false, true].map((reload) => ({ surface, theme, reload })),
        ),
      )
      test.each(cases)(
        'paints $surface in $theme after reload=$reload',
        async ({ surface, theme, reload }) => {
          const path = surface === 'home' ? '/' : '/docs/start-here/quick-start/'
          const liveSelector =
            surface === 'home' ? '.hero-box[data-mode="editor"]' : 'body[data-mode="editor"]'
          const captureSelector = surface === 'home' ? '.hero-box' : '.editor-host'

          const context = await browser.newContext({
            ...(engine === 'iphone-webkit'
              ? devices['iPhone 15']
              : { viewport: { width: engine === 'phone-webkit' ? 390 : 1280, height: 900 } }),
            serviceWorkers: 'block',
          })
          // Routing disables HTTP caching, so reload exercises a cold network path too.
          await context.route('**/*', (route) => route.continue())
          const page = await context.newPage()
          const problems: string[] = []
          page.on('pageerror', (error) => problems.push(error.message))
          page.on('console', (message) => {
            if (message.type() === 'error') problems.push(message.text())
          })
          page.on('requestfailed', (request) => problems.push(request.url()))
          page.on('response', (response) => {
            if (response.status() >= 400) problems.push(`${response.status()} ${response.url()}`)
          })
          try {
            await page.goto(`${preview.base}${path}?editor=off`)
            if (reload) await page.reload()
            await page.evaluate(() => document.fonts.ready)
            if (theme === 'dark') await page.locator('.theme-toggle').first().click()
            const control = await page
              .locator(surface === 'home' ? '.hero-box' : '#doc')
              .screenshot()
            await page.getByRole('button', { name: 'Open in editor', exact: true }).click()
            await page.locator(liveSelector).waitFor()
            await page.evaluate(async () => {
              await new Promise((resolve) => requestAnimationFrame(resolve))
              await new Promise((resolve) => requestAnimationFrame(resolve))
            })
            await page.waitForTimeout(1500)
            const registered = await page.evaluate(() => {
              const host = document.querySelector('.editor-host')!
              const ranges = [...CSS.highlights.values()].flatMap((group) =>
                [...group].filter((range) => host.contains(range.startContainer)),
              )
              return {
                count: ranges.length,
                connected: ranges.every(
                  (range) => range.startContainer.isConnected && range.endContainer.isConnected,
                ),
              }
            })
            expect(registered.count).toBeGreaterThan(0)
            expect(registered.connected).toBe(true)
            expect(problems).toEqual([])
            // Disabling animations forces a WebKit repaint and hides the stale-highlight failure.
            const painted = await page.locator(captureSelector).screenshot()
            expect(await syntaxInk(page, control.toString('base64'), surface)).toBeGreaterThan(20)
            expect(await syntaxInk(page, painted.toString('base64'), surface)).toBeGreaterThan(20)
          } finally {
            await context.close()
          }
        },
      )
    },
  )
}
