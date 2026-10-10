import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { webkit, type Browser, type Page } from 'playwright'
import { hasChromium, startPreview, type Preview } from './preview'

const evidence = join(
  tmpdir(),
  'singapore-docs-evidence',
  new Date().toISOString().replaceAll(':', '-'),
)
async function geometry(page: Page) {
  return page.evaluate(() => ({
    width: innerWidth,
    document: document.documentElement.scrollWidth,
    y: scrollY,
    examples: Array.from(document.querySelectorAll<HTMLElement>('.example-stage'), (node) => ({
      width: node.clientWidth,
      scrollWidth: node.scrollWidth,
      height: node.offsetHeight,
      top: node.getBoundingClientRect().top,
    })),
    innerScroll: Array.from(
      document.querySelectorAll<HTMLElement>('[data-example] .editor-virtualized'),
      (node) => ({
        width: node.clientWidth,
        scrollWidth: node.scrollWidth,
        height: node.clientHeight,
        scrollHeight: node.scrollHeight,
      }),
    ),
  }))
}
for (const engine of ['chromium', 'webkit'] as const) {
  describe.skipIf(!hasChromium() || (engine === 'webkit' && !existsSync(webkit.executablePath())))(
    `${engine} browsable docs (requires built site and installed browser)`,
    () => {
      let preview: Preview
      let browser: Browser
      beforeAll(async () => {
        await mkdir(evidence, { recursive: true })
        console.log(`Singapore docs evidence: ${evidence}`)
        preview = await startPreview()
        browser = engine === 'chromium' ? preview.browser : await webkit.launch()
      })
      afterAll(async () => {
        if (engine === 'webkit') await browser?.close()
        await preview?.stop()
      })
      test.each([320, 390, 768, 1280])(
        'ordinary scrolling and explicit example editing at %i px',
        async (width) => {
          const context = await browser.newContext({
            viewport: { width, height: 844 },
            hasTouch: width < 768,
            isMobile: width < 768,
            reducedMotion: 'reduce',
          })
          const page = await context.newPage()
          const problems: string[] = []
          const requests: string[] = []
          page.on('pageerror', (error) => problems.push(error.message))
          page.on('response', (response) => {
            if (response.status() >= 400) problems.push(`${response.status()} ${response.url()}`)
          })
          page.on('request', (request) => requests.push(request.url()))
          await page.addInitScript(() => {
            const state = window as unknown as { shifts: number; focusedInputs: number }
            state.shifts = 0
            state.focusedInputs = 0
            if (PerformanceObserver.supportedEntryTypes.includes('layout-shift')) {
              new PerformanceObserver((list) => {
                for (const entry of list.getEntries()) {
                  const shift = entry as PerformanceEntry & {
                    hadRecentInput: boolean
                    value: number
                  }
                  if (!shift.hadRecentInput) state.shifts += shift.value
                }
              }).observe({ type: 'layout-shift', buffered: true })
            }
            document.addEventListener('focusin', (event) => {
              if ((event.target as Element).matches('textarea, [contenteditable=true]'))
                state.focusedInputs++
            })
          })
          try {
            await page.goto(`${preview.base}/docs/start-here/quick-start/`)
            await page.evaluate(() => document.fonts.ready)
            const staticGeometry = await geometry(page)
            expect(staticGeometry.document).toBeLessThanOrEqual(width)
            expect(await page.locator('#doc p').count()).toBeGreaterThan(0)
            const first = page.locator('[data-example]').first()
            await first.locator('[data-example-ready]').count() // readiness belongs to the figure itself
            await expect.poll(() => first.getAttribute('data-example-ready')).toBe('')
            await page.screenshot({
              path: join(evidence, `${engine}-${width}-static.png`),
              fullPage: true,
            })
            const preparedGeometry = await geometry(page)
            expect(preparedGeometry.examples).toEqual(staticGeometry.examples)
            expect(
              await page.evaluate(() => (window as unknown as { shifts: number }).shifts),
            ).toBe(0)
            // Chromium's protocol delivers real touch gestures. WebKit's automation only exposes taps;
            // its phone coverage checks native wheel scrolling and touch tapping separately.
            if (width < 768 && engine === 'chromium') {
              const session = await context.newCDPSession(page)
              for (let step = 0; step < 40; step++) {
                const bottom = await page.evaluate(
                  () => scrollY + innerHeight >= document.documentElement.scrollHeight - 2,
                )
                if (bottom) break
                await session.send('Input.dispatchTouchEvent', {
                  type: 'touchStart',
                  touchPoints: [{ x: width / 2, y: 700 }],
                })
                for (const y of [600, 500, 400, 300, 200])
                  await session.send('Input.dispatchTouchEvent', {
                    type: 'touchMove',
                    touchPoints: [{ x: width / 2, y }],
                  })
                await session.send('Input.dispatchTouchEvent', {
                  type: 'touchEnd',
                  touchPoints: [],
                })
                await page.waitForTimeout(70)
              }
              await session.detach()
            } else {
              for (let step = 0; step < 40; step++) {
                if (
                  await page.evaluate(
                    () => scrollY + innerHeight >= document.documentElement.scrollHeight - 2,
                  )
                )
                  break
                await page.mouse.wheel(0, 600)
                await page.waitForTimeout(50)
              }
            }
            expect(
              await page.evaluate(
                () => scrollY + innerHeight >= document.documentElement.scrollHeight - 2,
              ),
            ).toBe(true)
            expect(
              await page.evaluate(
                () => (window as unknown as { focusedInputs: number }).focusedInputs,
              ),
            ).toBe(0)
            expect(requests.some((url) => url.includes('/demo/'))).toBe(false)
            await first.scrollIntoViewIfNeeded()
            const before = await geometry(page)
            const staticPixels = await first.locator('.example-stage').screenshot()
            const start = Date.now()
            if (width < 768) await first.getByRole('button', { name: /Edit/ }).tap()
            else await first.getByRole('button', { name: /Edit/ }).click()
            await first.locator('.example-prepared textarea').waitFor({ state: 'attached' })
            await expect.poll(() => first.getAttribute('data-example-live')).toBe('')
            const activationMs = Date.now() - start
            const after = await geometry(page)
            expect(after.y).toBe(before.y)
            expect(after.examples).toEqual(before.examples)
            for (const box of after.innerScroll) {
              expect(box.scrollWidth).toBeLessThanOrEqual(box.width)
              expect(box.scrollHeight).toBeLessThanOrEqual(box.height)
            }
            expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('TEXTAREA')
            // Remove the caret and current-line affordance for an ink-only comparison.
            const livePixels = await first.locator('.example-stage').screenshot({
              style:
                '.editor-virtualized-caret-layer{visibility:hidden!important}.editor{--editor-cursor-line-row-background:transparent;--editor-cursor-line-gutter-background:transparent;--editor-gutter-active-foreground:var(--editor-gutter-foreground)}',
            })
            await writeFile(join(evidence, `${engine}-${width}-example-static.png`), staticPixels)
            await writeFile(join(evidence, `${engine}-${width}-example-live.png`), livePixels)
            await writeFile(
              join(evidence, `${engine}-${width}-geometry.json`),
              JSON.stringify(
                {
                  before,
                  after,
                  activationMs,
                  cls: await page.evaluate(() => (window as unknown as { shifts: number }).shifts),
                  nativeClsSupported: await page.evaluate(() =>
                    PerformanceObserver.supportedEntryTypes.includes('layout-shift'),
                  ),
                },
                null,
                2,
              ),
            )
            await page.keyboard.press('Control+End')
            await page.keyboard.insertText('\n// edited example')
            await expect
              .poll(() => first.locator('.example-prepared').innerText())
              .toContain('// edited example')
            expect((await geometry(page)).document).toBeLessThanOrEqual(width)
            expect(problems).toEqual([])
          } finally {
            await context.close()
          }
        },
        90000,
      )
      test('early click waits visibly, keeps focus scoped, and skip link focuses prose', async () => {
        const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
        const page = await context.newPage()
        let release!: () => void
        const held = new Promise<void>((resolve) => {
          release = resolve
        })
        await context.route(/example-editor.*\.js/, async (route) => {
          await held
          await route.continue()
        })
        try {
          await page.goto(`${preview.base}/docs/start-here/quick-start/`)
          await page.keyboard.press('Tab')
          await page.keyboard.press('Enter')
          expect(await page.evaluate(() => document.activeElement?.id)).toBe('doc')
          const first = page.locator('[data-example]').first()
          await first.getByRole('button', { name: /Edit/ }).click()
          await expect.poll(() => first.getByRole('status').innerText()).toBe('Preparing editor…')
          expect(await first.getAttribute('data-example-live')).toBeNull()
          expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('BUTTON')
          const y = await page.evaluate(() => scrollY)
          release()
          await expect
            .poll(() => first.getAttribute('data-example-live'), { timeout: 20000 })
            .toBe('')
          expect(await page.evaluate(() => scrollY)).toBe(y)
          expect(
            await page.evaluate(() => document.activeElement?.getAttribute('aria-label')),
          ).toContain('example editor')
        } finally {
          release()
          await context.close()
        }
      }, 45000)
      test.each([320, 390, 768, 1280])(
        'JavaScript-off remains readable at %i px',
        async (width) => {
          const context = await browser.newContext({
            viewport: { width, height: 844 },
            javaScriptEnabled: false,
          })
          const page = await context.newPage()
          try {
            await page.goto(`${preview.base}/docs/start-here/quick-start/`)
            expect(await page.getByRole('heading', { level: 1 }).innerText()).toBe('Quick start')
            expect(await page.locator('[data-example]').first().innerText()).toContain(
              'npm install',
            )
            expect((await geometry(page)).document).toBeLessThanOrEqual(width)
            expect(await page.getByRole('button', { name: /Edit/ }).count()).toBe(0)
            await page.screenshot({
              path: join(evidence, `${engine}-${width}-no-js.png`),
              fullPage: true,
            })
          } finally {
            await context.close()
          }
        },
      )
    },
  )
}
