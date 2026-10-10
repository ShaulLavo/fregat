import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { webkit, type Browser } from 'playwright'
import { hasChromium, startPreview, type Preview } from './preview'

const evidence = join(
  tmpdir(),
  'singapore-review-evidence',
  new Date().toISOString().replaceAll(':', '-'),
)
for (const engine of ['chromium', 'webkit'] as const) {
  describe.skipIf(!hasChromium() || (engine === 'webkit' && !existsSync(webkit.executablePath())))(
    `${engine} review regressions`,
    () => {
      let preview: Preview
      let browser: Browser
      beforeAll(async () => {
        await mkdir(evidence, { recursive: true })
        console.log(`Singapore review evidence: ${evidence}`)
        preview = await startPreview()
        browser = engine === 'chromium' ? preview.browser : await webkit.launch()
      })
      afterAll(async () => {
        if (engine === 'webkit') await browser?.close()
        await preview?.stop()
      })
      test('Starlight example ink and gutters are unchanged on activation', async () => {
        const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
        const page = await context.newPage()
        try {
          await page.goto(`${preview.base}/docs/start-here/playground/`)
          const example = page.locator('[data-example]').first()
          await expect
            .poll(() => example.getAttribute('data-example-ready'), { timeout: 20000 })
            .toBe('')
          const stage = example.locator('.example-stage')
          await stage.scrollIntoViewIfNeeded()
          const before = await stage.boundingBox()
          const staticPixels = await stage.screenshot()
          expect(
            await example
              .locator('.example-prepared')
              .evaluate((node) => getComputedStyle(node).marginTop),
          ).toBe('0px')
          await example.getByRole('button', { name: /Edit/ }).click()
          await expect.poll(() => example.getAttribute('data-example-live')).toBe('')
          const after = await stage.boundingBox()
          expect(after?.height).toBe(before?.height)
          const livePixels = await stage.screenshot({
            style:
              '.editor-virtualized-caret-layer{visibility:hidden!important}.editor-virtualized-cursor-line-row,.editor-virtualized-cursor-line-gutter{background:transparent!important}.editor-virtualized-cursor-line-gutter{color:var(--editor-gutter-foreground)!important}',
          })
          await writeFile(join(evidence, `${engine}-starlight-static.png`), staticPixels)
          await writeFile(join(evidence, `${engine}-starlight-live.png`), livePixels)
          expect(livePixels.equals(staticPixels)).toBe(true)
        } finally {
          await context.close()
        }
      })
      test.each(['/docs/start-here/introduction/', '/docs/reference/api/core/overview/'])(
        'no runtime request on an example-free page: %s',
        async (path) => {
          const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
          const page = await context.newPage()
          const requests: string[] = []
          page.on('request', (request) => requests.push(request.url()))
          try {
            await page.goto(`${preview.base}${path}`)
            expect(await page.locator('[data-example]').count()).toBe(0)
            await page.evaluate(
              () =>
                new Promise<void>((resolve) => {
                  if ('requestIdleCallback' in window) requestIdleCallback(() => resolve())
                  else setTimeout(resolve, 0)
                }),
            )
            await page.waitForTimeout(1000)
            expect(requests.filter((url) => /example-editor.*\.js/.test(url))).toEqual([])
          } finally {
            await context.close()
          }
        },
      )
      test('a failed runtime download is requested again by Try again', async () => {
        const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
        const page = await context.newPage()
        let attempts = 0
        let release!: () => void
        const held = new Promise<void>((resolve) => {
          release = resolve
        })
        await context.route(/example-editor.*\.js/, async (route) => {
          attempts++
          await held
          if (attempts <= 2) await route.abort()
          else await route.continue()
        })
        try {
          await page.goto(`${preview.base}/docs/start-here/quick-start/`)
          const example = page.locator('[data-example]').first()
          for (let failure = 0; failure < 2; failure++) {
            await example.getByRole('button', { name: /Edit/ }).click()
            release()
            await expect
              .poll(() => example.getByRole('status').innerText())
              .toBe('Editor could not load. Try again.')
          }
          await example.getByRole('button', { name: /Edit/ }).click()
          await expect
            .poll(() => example.getAttribute('data-example-live'), { timeout: 20000 })
            .toBe('')
          expect(attempts).toBeGreaterThan(2)
        } finally {
          release()
          await context.close()
        }
      })
    },
  )
}

describe.skipIf(!hasChromium())('normal dev entry point', () => {
  test('renders painted examples and stops its capture service', async () => {
    const dev = await startPreview('dev')
    try {
      const page = await dev.browser.newPage()
      const response = await page.goto(`${dev.base}/docs/start-here/quick-start/`)
      expect(response?.status()).toBe(200)
      await expect
        .poll(() => page.locator('[data-editor-document-paint]').count())
        .toBeGreaterThan(0)
      expect(await page.locator('#doc h1').innerText()).toBe('Quick start')
    } finally {
      await dev.stop()
      expect(existsSync(new URL('../.capture/endpoint.json', import.meta.url))).toBe(false)
    }
  }, 180000)
})
