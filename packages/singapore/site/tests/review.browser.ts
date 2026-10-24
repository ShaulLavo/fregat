import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { firefox, webkit, type Browser, type Page } from 'playwright'
import { hasChromium, startFontPreview, startPreview, type Preview } from './preview'

const inkOnly =
  '.editor-virtualized-caret-layer{visibility:hidden!important}.editor-virtualized-cursor-line-row,.editor-virtualized-cursor-line-gutter{background:transparent!important}.editor-virtualized-cursor-line-gutter{color:var(--editor-gutter-foreground)!important}'
// Chromium and WebKit shade a few glyph edges differently when one token run is split across spans.
// Fonts, wrapping and height are asserted exactly; ink may differ only by that antialiasing residue.
async function expectSameInk(page: Page, actual: Buffer, expected: Buffer) {
  if (actual.equals(expected)) return
  const blank = await page.context().newPage()
  const difference = await blank.evaluate(
    async ([left, right]) => {
      const decode = async (data: string) => {
        const image = new Image()
        image.src = `data:image/png;base64,${data}`
        await image.decode()
        const canvas = new OffscreenCanvas(image.width, image.height)
        const context = canvas.getContext('2d')!
        context.drawImage(image, 0, 0)
        return context.getImageData(0, 0, image.width, image.height)
      }
      const [a, b] = await Promise.all([decode(left), decode(right)])
      if (a.width !== b.width || a.height !== b.height) return { ratio: 1, max: 255 }
      let changed = 0
      let max = 0
      for (let index = 0; index < a.data.length; index += 4) {
        const delta = Math.max(
          Math.abs(a.data[index] - b.data[index]),
          Math.abs(a.data[index + 1] - b.data[index + 1]),
          Math.abs(a.data[index + 2] - b.data[index + 2]),
        )
        if (delta === 0) continue
        changed++
        max = Math.max(max, delta)
      }
      return { ratio: changed / (a.width * a.height), max }
    },
    [actual.toString('base64'), expected.toString('base64')] as const,
  )
  await blank.close()
  expect(difference.ratio).toBeLessThan(0.01)
  expect(difference.max).toBeLessThanOrEqual(64)
}
const evidence = join(
  tmpdir(),
  'singapore-review-evidence',
  new Date().toISOString().replaceAll(':', '-'),
)
for (const engine of ['chromium', 'webkit', 'firefox'] as const) {
  describe.skipIf(
    !hasChromium() ||
      (engine !== 'chromium' && !existsSync({ webkit, firefox }[engine].executablePath())),
  )(`${engine} review regressions`, () => {
    let preview: Preview
    let browser: Browser
    beforeAll(async () => {
      await mkdir(evidence, { recursive: true })
      console.log(`Singapore review evidence: ${evidence}`)
      preview = await startPreview()
      browser = engine === 'chromium' ? preview.browser : await { webkit, firefox }[engine].launch()
    })
    afterAll(async () => {
      if (engine !== 'chromium') await browser?.close()
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
    test.each([0, 20, 1500])(
      'every example retains its font after retries with HTTP delay %i ms',
      async (fontDelay) => {
        const http = await startFontPreview(preview.base, fontDelay)
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
          await page.goto(`${http.base}/docs/start-here/quick-start/`, {
            waitUntil: 'domcontentloaded',
          })
          const first = page.locator('[data-example]').first()
          for (let failure = 0; failure < 2; failure++) {
            await first.getByRole('button', { name: /Edit/ }).click()
            release()
            await expect
              .poll(() => first.getByRole('status').innerText())
              .toBe('Editor could not load. Try again.')
          }
          await expect
            .poll(() => page.locator('html').getAttribute('data-example-font'))
            .toMatch(/^(mono|fallback)$/)
          const chosen = await page.locator('html').getAttribute('data-example-font')
          if (fontDelay === 1500) expect(chosen).toBe('fallback')
          const examples = page.locator('[data-example]')
          expect(await examples.count()).toBeGreaterThanOrEqual(3)
          for (let index = 0; index < (await examples.count()); index++) {
            // Deferred examples are activated after the font has completed, as in the review reproduction.
            if (index > 0) await fontResponse
            const example = examples.nth(index)
            const stage = example.locator('.example-stage')
            await stage.scrollIntoViewIfNeeded()
            const before = await stage.boundingBox()
            const staticPixels = await stage.screenshot()
            const staticRows = await stage
              .locator(
                '[data-example-width]:visible [data-example-theme]:visible [data-editor-document-paint-row]',
              )
              .allTextContents()
            await example.getByRole('button', { name: /Edit/ }).click()
            await expect
              .poll(() => example.getAttribute('data-example-live'), { timeout: 20000 })
              .toBe('')
            const after = await stage.boundingBox()
            expect(after?.height).toBe(before?.height)
            const livePixels = await stage.screenshot({ style: inkOnly })
            await writeFile(
              join(evidence, `${engine}-http-${fontDelay}-example-${index}-static.png`),
              staticPixels,
            )
            await writeFile(
              join(evidence, `${engine}-http-${fontDelay}-example-${index}-live.png`),
              livePixels,
            )
            await expectSameInk(page, livePixels, staticPixels)
            const liveRows = await example
              .locator('.example-prepared .editor-virtualized-row')
              .allTextContents()
            events.push(`rows ${index}: ${JSON.stringify({ staticRows, liveRows })}`)
            expect(liveRows).toEqual(staticRows)
            await fontResponse
            expect((await stage.screenshot({ style: inkOnly })).equals(livePixels)).toBe(true)
            expect(await page.locator('html').getAttribute('data-example-font')).toBe(chosen)
          }
          expect(attempts).toBe(3)
        } finally {
          release()
          await writeFile(
            join(evidence, `${engine}-http-${fontDelay}.json`),
            JSON.stringify(events, null, 2),
          )
          await context.unrouteAll({ behavior: 'wait' })
          await context.close()
          await http.stop()
        }
      },
    )
    test('a stalled module script cannot keep examples hidden', async () => {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
      const page = await context.newPage()
      await page.route(/\/_astro\/.*\.js(\?|$)/, () => {})
      try {
        await page.goto(`${preview.base}/docs/start-here/quick-start/`, { waitUntil: 'commit' })
        await expect
          .poll(() => page.locator('html').getAttribute('data-example-font'), { timeout: 2000 })
          .toMatch(/^(mono|fallback)$/)
        expect(
          await page
            .locator('[data-example] [data-editor-document-paint]')
            .first()
            .evaluate((node) => getComputedStyle(node).opacity),
        ).toBe('1')
      } finally {
        await context.close()
      }
    })
    test('warm visits select Mono before paint for every example', async () => {
      const http = await startFontPreview(preview.base, 0)
      const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
      const page = await context.newPage()
      try {
        await page.goto(`${http.base}/docs/start-here/quick-start/`)
        await page.evaluate(() => document.fonts.load('14px "JetBrains Mono"'))
        await page.reload()
        await expect.poll(() => page.locator('html').getAttribute('data-example-font')).toBe('mono')
        const examples = page.locator('[data-example]')
        for (let index = 0; index < (await examples.count()); index++) {
          const example = examples.nth(index)
          const stage = example.locator('.example-stage')
          await stage.scrollIntoViewIfNeeded()
          const staticPixels = await stage.screenshot()
          expect(
            await stage
              .locator('[data-editor-document-paint]')
              .first()
              .evaluate((node) => getComputedStyle(node).fontFamily),
          ).toContain('JetBrains Mono')
          await expect
            .poll(() => example.getAttribute('data-example-ready'), { timeout: 20000 })
            .toBe('')
          expect(
            await example
              .locator('.example-prepared')
              .evaluate((node) => getComputedStyle(node).opacity),
          ).toBe('0')
          const readyPixels = await stage.screenshot()
          await writeFile(join(evidence, `${engine}-warm-example-${index}-ready.png`), readyPixels)
          await expectSameInk(page, readyPixels, staticPixels)
          await example.getByRole('button', { name: /Edit/ }).click()
          await expect
            .poll(() => example.getAttribute('data-example-live'), { timeout: 20000 })
            .toBe('')
          const livePixels = await stage.screenshot({ style: inkOnly })
          await writeFile(
            join(evidence, `${engine}-warm-example-${index}-static.png`),
            staticPixels,
          )
          await writeFile(join(evidence, `${engine}-warm-example-${index}-live.png`), livePixels)
          await expectSameInk(page, livePixels, staticPixels)
        }
      } finally {
        await context.close()
        await http.stop()
      }
    })
  })
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
