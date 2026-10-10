import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
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
      test.each([0, 1500])(
        'a failed runtime download retries with the font delayed %i ms',
        async (fontDelay) => {
          const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
          const page = await context.newPage()
          const events: string[] = []
          page.on('console', (message) => events.push(`${message.type()}: ${message.text()}`))
          page.on('pageerror', (error) => events.push(`pageerror: ${error.message}`))
          page.on('requestfailed', (request) =>
            events.push(`requestfailed: ${request.url()} ${request.failure()?.errorText}`),
          )
          page.on('response', (response) => {
            if (/example-editor|jetbrains-mono/.test(response.url()))
              events.push(`response: ${response.status()} ${response.url()}`)
          })
          await context.route(/jetbrains-mono.*\.woff2/, async (route) => {
            await delay(fontDelay)
            await route.continue()
          })
          await page.addInitScript(() => {
            const load = FontFaceSet.prototype.load
            FontFaceSet.prototype.load = async function (font, text) {
              console.debug('Example font load started')
              try {
                const faces = await load.call(this, font, text)
                console.debug('Example font load completed')
                return faces
              } catch (error) {
                console.error('Example font load failed', error)
                throw error
              }
            }
            document.addEventListener(
              'click',
              (event) => {
                if ((event.target as Element).closest('.make-live'))
                  console.debug('Example activation requested')
              },
              true,
            )
          })
          let attempts = 0
          let release!: () => void
          const held = new Promise<void>((resolve) => {
            release = resolve
          })
          await context.route(/example-editor.*\.js/, async (route) => {
            const attempt = ++attempts
            events.push(`runtime request ${attempt}: ${route.request().url()}`)
            await held
            if (attempt <= 2) await route.abort()
            else await route.continue()
          })
          const fontResponse = page.waitForEvent('requestfinished', {
            predicate: (request) => /jetbrains-mono.*\.woff2/.test(request.url()),
          })
          try {
            await page.goto(`${preview.base}/docs/start-here/quick-start/`, {
              waitUntil: 'domcontentloaded',
            })
            const example = page.locator('[data-example]').first()
            for (let failure = 0; failure < 2; failure++) {
              await example.getByRole('button', { name: /Edit/ }).click()
              release()
              await expect
                .poll(() => example.getByRole('status').innerText())
                .toBe('Editor could not load. Try again.')
            }
            if (engine === 'webkit' && fontDelay > 0) {
              await expect
                .poll(() =>
                  page.evaluate(
                    () =>
                      Array.from(document.fonts).find((face) => face.family === 'JetBrains Mono')
                        ?.status,
                  ),
                )
                .toBe('error')
            }
            const stage = example.locator('.example-stage')
            await stage.scrollIntoViewIfNeeded()
            const before = await stage.boundingBox()
            await example.getByRole('button', { name: /Edit/ }).click()
            await expect
              .poll(
                async () => ({
                  live: await example.getAttribute('data-example-live'),
                  ready: await example.getAttribute('data-example-ready'),
                  status: await example.getByRole('status').innerText(),
                  disabled: await example.locator('.make-live').getAttribute('aria-disabled'),
                  attempts,
                  events: events.slice(),
                  fonts: await page.evaluate(() =>
                    Array.from(document.fonts, (face) => ({
                      family: face.family,
                      status: face.status,
                    })),
                  ),
                }),
                { timeout: 20000 },
              )
              .toMatchObject({ live: '' })
            expect(attempts).toBe(3)
            if (engine === 'webkit' && fontDelay > 0)
              expect(
                events.some((event) => event.startsWith('error: Example font load failed')),
              ).toBe(true)
            const after = await stage.boundingBox()
            expect(after?.height).toBe(before?.height)
            const livePixels = await stage.screenshot({
              style:
                '.editor-virtualized-caret-layer{visibility:hidden!important}.editor-virtualized-cursor-line-row,.editor-virtualized-cursor-line-gutter{background:transparent!important}.editor-virtualized-cursor-line-gutter{color:var(--editor-gutter-foreground)!important}',
            })
            // Compare the retained HTML after both views have selected the rendered font.
            const staticPixels = await stage.screenshot({
              style:
                '[data-example-live] .example-static{display:block!important}[data-example-live] .example-prepared{display:none!important}',
            })
            await writeFile(
              join(evidence, `${engine}-retry-font-${fontDelay}-static.png`),
              staticPixels,
            )
            await writeFile(
              join(evidence, `${engine}-retry-font-${fontDelay}-live.png`),
              livePixels,
            )
            expect(livePixels.equals(staticPixels)).toBe(true)
            await fontResponse
            const settledPixels = await stage.screenshot({
              style:
                '.editor-virtualized-caret-layer{visibility:hidden!important}.editor-virtualized-cursor-line-row,.editor-virtualized-cursor-line-gutter{background:transparent!important}.editor-virtualized-cursor-line-gutter{color:var(--editor-gutter-foreground)!important}',
            })
            expect(settledPixels.equals(livePixels)).toBe(true)
          } finally {
            release()
            if (
              (await page.locator('[data-example]').first().getAttribute('data-example-live')) !==
              ''
            )
              console.error(
                `Retry failure (${engine}, font delay ${fontDelay}): ${JSON.stringify(events)}`,
              )
            await writeFile(
              join(evidence, `${engine}-retry-font-${fontDelay}.json`),
              JSON.stringify(events, null, 2),
            )
            await context.unrouteAll({ behavior: 'wait' })
            await context.close()
          }
        },
      )
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
