import { holdEditor } from '../../../scripts/agent/site-takeover'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { webkit, type Browser } from 'playwright'
import { existsSync } from 'node:fs'
import { hasChromium, startPreview, type Preview } from './preview'
import { singaporeSiteSelectors as site } from '../../../scripts/agent/selectors'

for (const engine of ['chromium', 'webkit'] as const) {
  describe.skipIf(!hasChromium() || (engine === 'webkit' && !existsSync(webkit.executablePath())))(
    `${engine} automatic document takeover`,
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
        '$surface at $width in $theme preserves first paint during automatic takeover',
        async ({ width, surface, theme }) => {
          const page = await browser.newPage({
            viewport: { width, height: 900 },
            colorScheme: theme as 'light' | 'dark',
            isMobile: width < 500,
            hasTouch: width < 500,
          })
          const release = await holdEditor(page)
          const errors: string[] = []
          page.on('pageerror', (error) => errors.push(error.message))
          try {
            await page.goto(
              `${preview.base}${surface === 'home' ? '/' : '/docs/start-here/quick-start/'}`,
            )
            await site.static(page).waitFor()
            const box = surface === 'home' ? site.home(page) : site.manual(page)
            const options = {
              style: '.editor-virtualized-caret-layer { visibility: hidden !important; }',
            }
            const before = await box.screenshot(options)
            const height = (await box.boundingBox())!.height
            await page.evaluate(() => scrollTo(0, 500))
            const place = await page.evaluate(() => scrollY)
            expect(await page.getByRole('button', { name: /Go live|Go static/ }).count()).toBe(0)
            release()
            await site.live(page).waitFor()
            const timing = await page.evaluate(() => {
              const navigation = performance.getEntriesByType(
                'navigation',
              )[0] as PerformanceNavigationTiming
              const entry = performance
                .getEntriesByType('resource')
                .find((value) => /\/_astro\/editor\.[^/]+\.js$/.test(value.name))
              return { load: navigation.loadEventEnd, editor: entry?.startTime }
            })
            expect(timing.editor).toBeGreaterThanOrEqual(timing.load)
            expect((await box.boundingBox())!.height).toBe(height)
            expect(await page.evaluate(() => scrollY)).toBe(place)
            expect((await box.screenshot(options)).equals(before)).toBe(true)
            expect(
              await page.locator('.editor-host .editor-virtualized').evaluate((element) => ({
                x: element.scrollWidth - element.clientWidth,
                y: element.scrollHeight - element.clientHeight,
              })),
            ).toEqual({ x: 0, y: 0 })
            expect(
              await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
            ).toBe(0)
            expect(errors).toEqual([])
          } finally {
            release()
            await page.close()
          }
        },
      )
      test.each([320, 1280])(
        'page scrolling and editor reveal share the page at %i px',
        async (width) => {
          const page = await browser.newPage({
            viewport: { width, height: 900 },
            // Playwright's mobile WebKit wheel input is unavailable; touch layout has separate coverage.
            isMobile: width < 500 && engine !== 'webkit',
            hasTouch: width < 500,
          })
          try {
            await page.goto(`${preview.base}/docs/start-here/quick-start/`)
            await site.live(page).waitFor()
            const apple = await page.evaluate(() =>
              /mac/i.test(`${navigator.platform} ${navigator.userAgent}`),
            )
            await page.evaluate(() => scrollTo(0, 0))
            await page.mouse.move(1, 300)
            await page.mouse.wheel(0, 240)
            await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0)
            const margin = await page.evaluate(() => scrollY)
            await page.mouse.move(width / 2, 300)
            await page.mouse.wheel(0, 240)
            await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(margin)
            await page.locator('.editor-virtualized-viewport').click({ position: { x: 70, y: 30 } })
            await page.keyboard.press(apple ? 'Meta+ArrowDown' : 'Control+End')
            await expect
              .poll(() => page.evaluate(() => scrollY), {
                message: 'Caret end reveal scrolls the page',
              })
              .toBeGreaterThan(900)
            await page.keyboard.press(apple ? 'Meta+ArrowUp' : 'Control+Home')
            await expect
              .poll(() => page.evaluate(() => scrollY), {
                message: 'Caret start reveal scrolls the page',
              })
              .toBeLessThan(300)
            await page.keyboard.press(apple ? 'Meta+f' : 'Control+f')
            await page
              .getByRole('textbox', { name: 'Find', exact: true })
              .fill('A server-rendered page fails to load')
            await expect
              .poll(() => page.evaluate(() => scrollY), {
                message: 'Find match reveal scrolls the page',
              })
              .toBeGreaterThan(900)
            expect(
              await page.locator('.editor-virtualized').evaluate((element) => ({
                x: element.scrollWidth - element.clientWidth,
                y: element.scrollHeight - element.clientHeight,
              })),
            ).toEqual({ x: 0, y: 0 })
          } finally {
            await page.close()
          }
        },
      )
      test('heading roles remain accessible in reading order through takeover', async () => {
        const page = await browser.newPage()
        const release = await holdEditor(page)
        const session = engine === 'chromium' ? await page.context().newCDPSession(page) : null
        const expected = [
          'Quick start',
          '1. Install the core',
          '2. Give the editor a container',
          '3. Mount it',
        ]
        const headings = async () => {
          if (session) {
            const tree = await session.send('Accessibility.getFullAXTree')
            return tree.nodes
              .filter((node) => node.role?.value === 'heading')
              .map((node) => node.name?.value)
          }
          return Array.from(
            (await page.locator('#doc').ariaSnapshot()).matchAll(/heading "([^"\n]+)"/g),
            (match) => match[1],
          )
        }
        const ready = async () => {
          await expect
            .poll(
              async () => {
                const names = await headings()
                return names.slice(
                  names.indexOf('Quick start'),
                  names.indexOf('Quick start') + expected.length,
                )
              },
              { message: 'All four page headings are attached in the accessibility tree' },
            )
            .toEqual(expected)
        }
        try {
          await page.goto(`${preview.base}/docs/start-here/quick-start/`)
          await site.static(page).waitFor()
          await ready()
          release()
          await site.live(page).waitFor()
          await ready()
        } finally {
          release()
          await session?.detach()
          await page.close()
        }
      })
      test.each([390, 1280])(
        'JavaScript-off readers retain native headings and links at %i px',
        async (width) => {
          const page = await browser.newPage({
            javaScriptEnabled: false,
            viewport: { width, height: 900 },
          })
          try {
            await page.goto(`${preview.base}/docs/start-here/quick-start/`)
            expect(await page.getByRole('heading', { level: 1 }).innerText()).toBe('Quick start')
            expect(await page.getByRole('heading', { level: 2 }).count()).toBeGreaterThan(2)
            expect(await page.locator('.editor-host').count()).toBe(0)
            if (width < 500) await page.locator('.menu summary').click()
            const navigation = page.locator(width < 500 ? '.menu nav' : 'nav.pages')
            await navigation.getByRole('link', { name: 'Introduction', exact: true }).click()
            await page.waitForURL(/\/docs\/start-here\/introduction\/$/)
          } finally {
            await page.close()
          }
        },
      )
      test('failed editor loading retains readable captured pages and working links', async () => {
        const page = await browser.newPage()
        await page.route('**/_astro/editor.*.js', (route) => route.abort())
        try {
          await page.goto(`${preview.base}/docs/start-here/introduction/`)
          await site.static(page).waitFor()
          await site.manual(page).getByRole('link', { name: 'quick start', exact: true }).click()
          await page.waitForURL(/\/docs\/start-here\/quick-start\/$/)
          await site.static(page).waitFor()
          expect(await page.getByRole('heading', { level: 1 }).innerText()).toBe('Quick start')
          expect(await page.locator('.editor-host').count()).toBe(0)
        } finally {
          await page.close()
        }
      })
      test('theme changes and search stay usable after automatic takeover', async () => {
        const page = await browser.newPage({ viewport: { width: 390, height: 900 } })
        try {
          await page.goto(`${preview.base}/docs/start-here/quick-start/`)
          await site.live(page).waitFor()
          const height = (await site.manual(page).boundingBox())!.height
          await page.locator('.theme-toggle').click()
          expect((await site.manual(page).boundingBox())!.height).toBe(height)
          await page.locator('button.search-open').click()
          await page.locator('dialog[open]').waitFor()
          await page.keyboard.press('Escape')
          expect(await page.locator('dialog[open]').count()).toBe(0)
        } finally {
          await page.close()
        }
      })
    },
  )
}
