import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import { webkit, type Browser } from 'playwright'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { hasChromium, startPreview, type Preview } from './preview'
import { singaporeSiteSelectors as site } from '../../../scripts/agent/selectors'

for (const engine of ['chromium', 'webkit'] as const) {
  describe.skipIf(!hasChromium() || (engine === 'webkit' && !existsSync(webkit.executablePath())))(
    `${engine} document takeover`,
    () => {
      let preview: Preview
      let browser: Browser
      beforeAll(async () => {
        preview = await startPreview()
        browser = engine === 'chromium' ? preview.browser : await webkit.launch()
      })
      afterAll(async () => {
        if (engine === 'webkit') await browser?.close()
        await preview?.stop()
      })
      test.each(
        [320, 390, 1280].flatMap((width) =>
          ['home', 'manual'].flatMap((surface) =>
            ['light', 'dark'].map((theme) => ({ width, surface, theme })),
          ),
        ),
      )(
        '$surface at $width in $theme preserves paint in both directions',
        async ({ width, surface, theme }) => {
          const context = await browser.newContext({
            viewport: { width, height: 900 },
            colorScheme: theme as 'light' | 'dark',
            isMobile: width < 500,
            hasTouch: width < 500,
          })
          const page = await context.newPage()
          const problems: string[] = []
          page.on('pageerror', (error) => problems.push(error.message))
          page.on('console', (message) => {
            if (message.type() === 'error') problems.push(message.text())
          })
          try {
            await page.goto(
              `${preview.base}${surface === 'home' ? '/' : '/docs/start-here/quick-start/'}?editor=off`,
            )
            await site.static(page).waitFor()
            const box = surface === 'home' ? site.home(page) : site.manual(page)
            const before = await box.boundingBox()
            const ink = await box.screenshot({
              style:
                '.editor-virtualized-caret-layer, .mode button, .hero-mode button { visibility: hidden !important; }',
            })
            await site.goLive(page).click()
            await site.live(page).waitFor()
            expect((await box.boundingBox())?.height).toBe(before?.height)
            const after = await box.screenshot({
              style:
                '.editor-virtualized-caret-layer, .mode button, .hero-mode button { visibility: hidden !important; }',
            })
            // Pixel equality compares only the document, with the unfocused caret outside it.
            if (!after.equals(ink)) {
              mkdirSync(new URL('../.capture/evidence/', import.meta.url), {
                recursive: true,
              })
              writeFileSync(
                new URL(
                  `../.capture/evidence/${engine}-${surface}-${width}-${theme}-static.png`,
                  import.meta.url,
                ),
                ink,
              )
              writeFileSync(
                new URL(
                  `../.capture/evidence/${engine}-${surface}-${width}-${theme}-live.png`,
                  import.meta.url,
                ),
                after,
              )
            }
            expect(after.equals(ink)).toBe(true)
            expect(
              await page.evaluate(() => document.scrollingElement!.scrollWidth <= innerWidth),
            ).toBe(true)
            expect(
              await page.locator('.editor-virtualized').evaluate((element) => ({
                x: element.scrollWidth - element.clientWidth,
                y: element.scrollHeight - element.clientHeight,
              })),
            ).toEqual({ x: 0, y: 0 })
            await site.goStatic(page).click()
            await site.static(page).waitFor()
            expect((await box.boundingBox())?.height).toBe(before?.height)
            expect(
              (
                await box.screenshot({
                  style:
                    '.editor-virtualized-caret-layer, .mode button, .hero-mode button { visibility: hidden !important; }',
                })
              ).equals(ink),
            ).toBe(true)
            expect(problems).toEqual([])
          } finally {
            await context.close()
          }
        },
      )
      test.each([320, 390, 1280])(
        'emitted paint stays visible with the editor entry blocked at %i',
        async (width) => {
          for (const theme of ['light', 'dark'] as const) {
            const context = await browser.newContext({
              viewport: { width, height: 900 },
              colorScheme: theme,
            })
            await context.route('**/_astro/*.js', (route) => route.abort())
            const page = await context.newPage()
            await page.addInitScript(() => {
              const observe = () => {
                const root = [
                  ...document.querySelectorAll<HTMLElement>('[data-editor-document-paint]'),
                ].find(
                  (element) =>
                    element.getClientRects().length > 0 &&
                    getComputedStyle(element).visibility === 'visible',
                )
                if (!root) {
                  requestAnimationFrame(observe)
                  return
                }
                Object.assign(window, {
                  firstDocumentFrame: {
                    rows: root.querySelectorAll('[data-editor-document-paint-row]').length,
                    coloured: [...CSS.highlights.values()].some((group) =>
                      [...group].some((range) => root.contains(range.startContainer)),
                    ),
                  },
                })
              }
              requestAnimationFrame(observe)
            })
            try {
              await page.goto(`${preview.base}/docs/start-here/quick-start/`)
              await page.evaluate(() => document.fonts.ready)
              await expect
                .poll(() =>
                  page.evaluate(
                    () =>
                      (
                        window as unknown as {
                          firstDocumentFrame?: {
                            rows: number
                            coloured: boolean
                          }
                        }
                      ).firstDocumentFrame,
                  ),
                )
                .toMatchObject({ coloured: true })
              expect(await site.goLive(page).count()).toBe(0)
              expect(await page.getByRole('heading', { level: 1 }).innerText()).toBe('Quick start')
              expect(
                await page.evaluate(() => document.scrollingElement!.scrollWidth <= innerWidth),
              ).toBe(true)
              const options = {
                style: '.mode button { visibility: hidden !important; }',
              }
              const emitted = await site.manual(page).screenshot(options)
              await context.unroute('**/_astro/*.js')
              await page.reload()
              await site.static(page).waitFor()
              expect((await site.manual(page).screenshot(options)).equals(emitted)).toBe(true)
            } finally {
              await context.close()
            }
          }
        },
      )
      test('live entry loading keeps the captured document visible', async () => {
        const page = await browser.newPage()
        let release!: () => void
        let entered!: () => void
        const held = new Promise<void>((resolve) => {
          release = resolve
        })
        const requested = new Promise<void>((resolve) => {
          entered = resolve
        })
        await page.route('**/_astro/editor.*.js', async (route) => {
          entered()
          await held
          await route.continue()
        })
        try {
          await page.goto(`${preview.base}/?editor=off`)
          await site.static(page).waitFor()
          const options = {
            style:
              '.hero-mode button, .editor-virtualized-caret-layer { visibility: hidden !important; }',
          }
          const ink = await site.home(page).screenshot(options)
          await site.goLive(page).click()
          await requested
          expect((await site.home(page).screenshot(options)).equals(ink)).toBe(true)
          expect(await site.goLive(page).isDisabled()).toBe(true)
          release()
          await site.live(page).waitFor()
          expect((await site.home(page).screenshot(options)).equals(ink)).toBe(true)
        } finally {
          release()
          await page.close()
        }
      })
      test('delayed fonts keep the emitted document readable', async () => {
        const context = await browser.newContext({
          viewport: { width: 390, height: 900 },
        })
        let release!: () => void
        const held = new Promise<void>((resolve) => {
          release = resolve
        })
        await context.route('**/*.woff2', async (route) => {
          await held
          await route.continue()
        })
        const page = await context.newPage()
        try {
          await page.goto(`${preview.base}/docs/start-here/quick-start/`, {
            waitUntil: 'domcontentloaded',
          })
          await expect.poll(() => page.locator('.captured-html').isVisible()).toBe(true)
          expect(await page.getByRole('heading', { level: 1 }).innerText()).toBe('Quick start')
          expect(await site.goLive(page).isDisabled()).toBe(true)
          // WebKit's screenshot protocol waits for held fonts even when Playwright's wait is disabled.
          if (engine === 'chromium') {
            vi.stubEnv('PW_TEST_SCREENSHOT_NO_FONTS_READY', '1')
            try {
              const visibleHeading = await site.manual(page).screenshot()
              const hiddenHeading = await site.manual(page).screenshot({
                style:
                  '[data-editor-document-paint] :is(h1, [role="heading"][aria-level="1"]) { visibility: hidden !important; }',
              })
              expect(visibleHeading.equals(hiddenHeading)).toBe(false)
            } finally {
              vi.unstubAllEnvs()
            }
          }
          expect(
            await page
              .locator('.captured-html')
              .evaluate((element) =>
                [...CSS.highlights.values()].some((group) =>
                  [...group].some((range) => element.contains(range.startContainer)),
                ),
              ),
          ).toBe(true)
          release()
          await site.static(page).waitFor()
          await expect.poll(() => site.goLive(page).isEnabled()).toBe(true)
        } finally {
          release()
          await context.close()
        }
      })
      test('failed live startup keeps static paint and an earlier edit', async () => {
        const page = await browser.newPage()
        try {
          await page.goto(`${preview.base}/?editor=on`)
          await site.live(page).waitFor()
          await page.locator('.editor-virtualized-viewport').click()
          await page.keyboard.press('Control+End')
          await page.keyboard.type('\n// Preserved source')
          await site.goStatic(page).click()
          await site.static(page).waitFor()
          const ink = await site.home(page).screenshot()
          await page.evaluate(() => {
            Object.assign(window, { blockedPaintRegistrations: 0 })
            CSS.highlights.set = () => {
              const state = window as unknown as { blockedPaintRegistrations: number }
              state.blockedPaintRegistrations++
              throw new DOMException('Highlight registration blocked by test', 'NotSupportedError')
            }
          })
          await site.goLive(page).click()
          await expect.poll(() => site.goLive(page).isEnabled(), { timeout: 15000 }).toBe(true)
          expect(
            await page.evaluate(
              () =>
                (window as unknown as { blockedPaintRegistrations: number })
                  .blockedPaintRegistrations,
            ),
          ).toBeGreaterThan(0)
          await site.static(page).waitFor()
          expect(await site.home(page).innerText()).toContain('Preserved source')
          expect((await site.home(page).screenshot()).equals(ink)).toBe(true)
        } finally {
          await page.close()
        }
      })
      test('blocked parser startup retains the initial static document', async () => {
        const page = await browser.newPage()
        await page.addInitScript(() => {
          Object.assign(window, { blockedParserStarts: 0 })
          window.Worker = new Proxy(window.Worker, {
            construct() {
              const state = window as unknown as { blockedParserStarts: number }
              state.blockedParserStarts++
              throw new DOMException('Parser worker startup blocked by test', 'NetworkError')
            },
          })
        })
        try {
          await page.goto(`${preview.base}/?editor=off`)
          await site.static(page).waitFor()
          const ink = await site.home(page).screenshot()
          await site.goLive(page).click()
          await expect.poll(() => site.goLive(page).isEnabled(), { timeout: 15000 }).toBe(true)
          expect(
            await page.evaluate(
              () => (window as unknown as { blockedParserStarts: number }).blockedParserStarts,
            ),
          ).toBeGreaterThan(0)
          await site.static(page).waitFor()
          expect((await site.home(page).screenshot()).equals(ink)).toBe(true)
        } finally {
          await page.close()
        }
      })
      test('switches retain the reader scroll anchor and focused toggle', async () => {
        const page = await browser.newPage()
        try {
          await page.goto(`${preview.base}/docs/start-here/quick-start/?editor=off`)
          await site.static(page).waitFor()
          await site.goLive(page).focus()
          await page.evaluate(() => scrollTo(0, 400))
          const anchor = await page.evaluate(() => scrollY)
          await site.goLive(page).evaluate((button: HTMLButtonElement) => button.click())
          await site.live(page).waitFor()
          expect(await page.evaluate(() => scrollY)).toBe(anchor)
          expect(
            await site.goStatic(page).evaluate((button) => button === document.activeElement),
          ).toBe(true)
          await site.goStatic(page).evaluate((button: HTMLButtonElement) => button.click())
          await site.static(page).waitFor()
          expect(await page.evaluate(() => scrollY)).toBe(anchor)
          expect(
            await site.goLive(page).evaluate((button) => button === document.activeElement),
          ).toBe(true)
        } finally {
          await page.close()
        }
      })
      test('edited source survives static mode, theme changes, navigation and history', async () => {
        const page = await browser.newPage({
          viewport: { width: 1280, height: 900 },
        })
        try {
          await page.goto(`${preview.base}/docs/start-here/introduction/?editor=on`)
          await site.live(page).waitFor()
          await page.locator('.editor-virtualized-viewport').click()
          await page.keyboard.press('Control+End')
          await page.keyboard.type('\nSaved browser edit')
          await site.goStatic(page).click()
          await site.static(page).waitFor()
          expect(await site.manual(page).innerText()).toContain('Saved browser edit')
          await page.locator('.theme-toggle').click()
          expect(await site.manual(page).innerText()).toContain('Saved browser edit')
          await site.goLive(page).click()
          await site.live(page).waitFor()
          expect(await site.manual(page).innerText()).toContain('Saved browser edit')
          await page
            .getByRole('navigation', { name: 'Documentation' })
            .getByRole('link', { name: 'Quick start', exact: true })
            .click()
          await page.waitForURL(/quick-start\/$/)
          await site.live(page).waitFor()
          await page.goBack()
          await page.waitForURL(/introduction/)
          await expect.poll(() => site.manual(page).innerText()).toContain('Saved browser edit')
          await page.goForward()
          await page.waitForURL(/quick-start/)
          await expect.poll(() => site.manual(page).innerText()).toContain('Quick start')
        } finally {
          await page.close()
        }
      })
      test('failed live navigation keeps the captured page and its history together', async () => {
        const page = await browser.newPage()
        try {
          await page.goto(`${preview.base}/docs/start-here/introduction/?editor=on`)
          await site.live(page).waitFor()
          await page.evaluate(() => {
            Object.assign(window, { blockedNativePaintRegistrations: 0 })
            const observer = new MutationObserver(() => {
              if (document.body.dataset.file !== 'start-here/quick-start.md') return
              observer.disconnect()
              const register = CSS.highlights.set.bind(CSS.highlights)
              CSS.highlights.set = (name, highlight) => {
                if (!name.startsWith('editor-shared-token-')) return register(name, highlight)
                const state = window as unknown as { blockedNativePaintRegistrations: number }
                state.blockedNativePaintRegistrations++
                throw new DOMException('Native paint blocked by test', 'NotSupportedError')
              }
            })
            observer.observe(document.body, { attributes: true, attributeFilter: ['data-file'] })
          })
          await page
            .getByRole('navigation', { name: 'Documentation' })
            .getByRole('link', { name: 'Quick start', exact: true })
            .click()
          await page.waitForURL(/quick-start\/$/)
          await site.static(page).waitFor()
          expect(await site.manual(page).innerText()).toContain('Quick start')
          expect(
            await page.evaluate(
              () =>
                (window as unknown as { blockedNativePaintRegistrations: number })
                  .blockedNativePaintRegistrations,
            ),
          ).toBeGreaterThan(0)
          await page.goBack()
          await page.waitForURL(/introduction/)
          await expect.poll(() => site.manual(page).innerText()).toContain('Introduction')
        } finally {
          await page.close()
        }
      })
      test('no JavaScript retains complete native headings and links', async () => {
        const page = await browser.newPage({ javaScriptEnabled: false })
        try {
          await page.goto(`${preview.base}/docs/start-here/quick-start/`)
          expect(await page.getByRole('heading', { level: 1 }).innerText()).toBe('Quick start')
          expect(await page.getByRole('heading', { level: 2 }).count()).toBeGreaterThan(2)
          expect(
            await page.getByRole('link', { name: 'TypeScript playground' }).count(),
          ).toBeGreaterThan(0)
        } finally {
          await page.close()
        }
      })
      test('search opens captured pages and fragment links reveal page headings', async () => {
        const page = await browser.newPage()
        try {
          await page.goto(`${preview.base}/docs/start-here/introduction/?editor=off`)
          await site.static(page).waitFor()
          await page.locator('.search-open').click()
          await page.getByRole('searchbox', { name: 'Search docs' }).fill('Monaco')
          await page.locator('dialog.search a', { hasText: 'Coming from Monaco' }).first().click()
          await page.waitForURL(/monaco\/$/)
          expect(await page.title()).toContain('Coming from Monaco')
          await page.goto(`${preview.base}/docs/start-here/introduction/?editor=off`)
          await site.static(page).waitFor()
          await page
            .locator('[data-editor-document-paint] a', {
              hasText: 'troubleshooting section',
            })
            .click()
          await page.waitForURL(/quick-start\/#if-it-doesnt-work$/)
          await expect
            .poll(() =>
              page
                .locator('[data-editor-document-paint] #if-it-doesnt-work')
                .evaluate((element) =>
                  Math.abs(
                    scrollY -
                      Math.min(
                        scrollY + element.getBoundingClientRect().top,
                        document.scrollingElement!.scrollHeight - innerHeight,
                      ),
                  ),
                ),
            )
            .toBeLessThan(1)
        } finally {
          await page.close()
        }
      })
    },
  )
}
