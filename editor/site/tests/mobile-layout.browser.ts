import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { webkit, type Browser } from 'playwright'
import { hasChromium, startPreview, type Preview } from './preview'

const evidence = join(
  tmpdir(),
  'singapore-mobile-evidence',
  new Date().toISOString().replaceAll(':', '-'),
)
for (const engine of ['chromium', 'webkit'] as const) {
  describe.skipIf(!hasChromium() || (engine === 'webkit' && !existsSync(webkit.executablePath())))(
    `${engine} resized examples (requires built site and installed browser)`,
    () => {
      let preview: Preview
      let browser: Browser
      beforeAll(async () => {
        await mkdir(evidence, { recursive: true })
        console.log(`Singapore mobile evidence: ${evidence}`)
        preview = await startPreview()
        browser = engine === 'chromium' ? preview.browser : await webkit.launch()
      })
      afterAll(async () => {
        if (engine === 'webkit') await browser?.close()
        await preview?.stop()
      })
      test.each(['/', '/docs/start-here/playground/'])(
        'resizing %s preserves the frame and live wrapping',
        async (path) => {
          const context = await browser.newContext({
            viewport: { width: 390, height: 844 },
            isMobile: true,
            hasTouch: true,
            reducedMotion: 'reduce',
          })
          try {
            const page = await context.newPage()
            await page.goto(`${preview.base}${path}`)
            await page.evaluate(() => document.fonts.ready)
            const example = page.locator('[data-example]').first()
            await expect
              .poll(() => example.getAttribute('data-example-ready'), { timeout: 20000 })
              .toBe('')
            await page.locator('site-search button, button.search-open').first().click()
            await page.locator('dialog[open]').waitFor()
            for (const viewport of [
              { width: 320, height: 844 },
              { width: 844, height: 390 },
              { width: 320, height: 390 },
            ]) {
              await page.setViewportSize(viewport)
              await expect
                .poll(() =>
                  page.evaluate(() => ({
                    width: innerWidth,
                    document: document.scrollingElement!.scrollWidth,
                  })),
                )
                .toEqual({ width: viewport.width, document: viewport.width })
            }
            await page.keyboard.press('Escape')
            const staticRows = await example
              .locator('.example-static [data-editor-document-paint]:visible')
              .locator('[data-editor-document-paint-row]')
              .allTextContents()
            expect(staticRows.length).toBeGreaterThan(0)
            const stage = example.locator('.example-stage')
            const staticWidth = await stage.evaluate((element) => element.clientWidth)
            await example.getByRole('button', { name: /Edit/ }).click()
            await expect.poll(() => example.getAttribute('data-example-live')).toBe('')
            const textRows = example.locator(
              '.example-prepared .editor-virtualized-text-clip .editor-virtualized-row',
            )
            // Virtualized rows keep their DOM nodes while their visual positions change.
            await expect
              .poll(() =>
                textRows.evaluateAll((elements) => {
                  const rows = Array.from(elements, (element) => ({
                    top: element.getBoundingClientRect().top,
                    text: element.textContent,
                  }))
                  rows.sort((first, second) => first.top - second.top)
                  return rows.map((row) => row.text)
                }),
              )
              .toEqual(staticRows)
            const label = `${engine}-${path === '/' ? 'home' : 'playground'}`
            await page.screenshot({ path: join(evidence, `${label}.png`), fullPage: true })
            const geometry = await example.evaluate((element) => {
              const frame = element.querySelector<HTMLElement>('.example-stage')!
              const editor = element.querySelector<HTMLElement>('.editor-virtualized')!
              const extent = element.querySelector<HTMLElement>('.editor-virtualized-extent')!
              return {
                frame: frame.clientWidth,
                editor: editor.clientWidth,
                content: editor.scrollWidth,
                extent: extent.getBoundingClientRect().width,
                height: editor.clientHeight,
                contentHeight: editor.scrollHeight,
              }
            })
            await writeFile(
              join(evidence, `${label}.json`),
              JSON.stringify({ staticWidth, staticRows, geometry }, null, 2),
            )
            expect(geometry).toEqual({
              frame: staticWidth,
              editor: staticWidth,
              content: staticWidth,
              extent: staticWidth,
              height: geometry.contentHeight,
              contentHeight: geometry.contentHeight,
            })
          } finally {
            await context.close()
          }
        },
      )
    },
  )
}
