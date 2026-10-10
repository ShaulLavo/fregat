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
      top: node.getBoundingClientRect().top + scrollY,
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
            isMobile: width < 768 && engine === 'chromium',
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
            await expect
              .poll(() => first.getAttribute('data-example-ready'), { timeout: 20000 })
              .toBe('')
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
            // Center the stage before cropping; viewport clipping can cut off its first row.
            await first.locator('.example-stage').evaluate((node) => {
              const box = node.getBoundingClientRect()
              window.scrollTo({
                top: scrollY + box.top - (innerHeight - box.height) / 2,
                behavior: 'instant',
              })
            })
            // Native touch momentum must finish before screenshot cropping can stay aligned.
            await page.evaluate(async () => {
              let previous = scrollY
              let stable = 0
              const start = performance.now()
              while (stable < 10) {
                await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
                stable = scrollY === previous ? stable + 1 : 0
                previous = scrollY
                if (performance.now() - start > 5000)
                  throw new TypeError('Scrolling did not settle')
              }
            })
            const staticPixels = await first.locator('.example-stage').screenshot()
            await first.getByRole('button', { name: /Edit/ }).scrollIntoViewIfNeeded()
            const before = await geometry(page)
            await first.evaluate((node) => {
              node.addEventListener(
                'click',
                () => {
                  const start = performance.now()
                  node.setAttribute('data-activation-scroll-y', String(scrollY))
                  new MutationObserver((_, observer) => {
                    if (!node.hasAttribute('data-example-live')) return
                    node.setAttribute('data-activation-ms', String(performance.now() - start))
                    observer.disconnect()
                  }).observe(node, { attributes: true, attributeFilter: ['data-example-live'] })
                },
                { capture: true, once: true },
              )
            })
            if (width < 768) await first.getByRole('button', { name: /Edit/ }).tap()
            else await first.getByRole('button', { name: /Edit/ }).click()
            await first.locator('.example-prepared textarea').waitFor({ state: 'attached' })
            await expect.poll(() => first.getAttribute('data-example-live')).toBe('')
            const activationMs = Number(await first.getAttribute('data-activation-ms'))
            expect(activationMs).toBeLessThan(50)
            const after = await geometry(page)
            expect(after.y).toBe(Number(await first.getAttribute('data-activation-scroll-y')))
            expect(after.examples).toEqual(before.examples)
            for (const box of after.innerScroll) {
              expect(box.scrollWidth).toBeLessThanOrEqual(box.width)
              expect(box.scrollHeight).toBeLessThanOrEqual(box.height)
            }
            expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('TEXTAREA')
            // Remove the caret and current-line affordance for an ink-only comparison.
            const livePixels = await first.locator('.example-stage').screenshot({
              style:
                '.editor-virtualized-caret-layer{visibility:hidden!important}.editor-virtualized-cursor-line-row,.editor-virtualized-cursor-line-gutter{background:transparent!important}.editor-virtualized-cursor-line-gutter{color:var(--editor-gutter-foreground)!important}',
            })
            await writeFile(join(evidence, `${engine}-${width}-example-static.png`), staticPixels)
            await writeFile(join(evidence, `${engine}-${width}-example-live.png`), livePixels)
            expect(livePixels.equals(staticPixels), 'Static and live example ink matches').toBe(
              true,
            )
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
      test('headings stay in reading order and search opens an ordinary page', async () => {
        const context = await browser.newContext({ viewport: { width: 390, height: 844 } })
        const page = await context.newPage()
        try {
          await page.goto(`${preview.base}/docs/start-here/quick-start/`)
          expect(await page.locator('#doc h1, #doc h2, #doc h3').allTextContents()).toEqual([
            'Quick start',
            '1. Install the core',
            '2. Give the editor a container',
            '3. Mount it',
            'Open a named document',
            'If it doesn’t work',
            'The editor has no visible rows',
            'Highlighting is absent',
            'A server-rendered page fails to load',
          ])
          await page.getByRole('button', { name: /Search/ }).click()
          const input = page.getByRole('searchbox', { name: 'Search docs' })
          const result = page.locator('.search li a').first()
          const noMatch = '"qzvxjkwpyqzvxjkwpy"'
          expect(
            await page.evaluate(
              `import(${JSON.stringify(`${preview.base}/pagefind/pagefind.js`)}).then(async index => (await index.search(${JSON.stringify(noMatch)})).results.length)`,
            ),
          ).toBe(0)
          await input.fill(noMatch)
          await expect
            .poll(() => page.locator('.search ol').getAttribute('data-query'))
            .toBe(noMatch)
          expect(await page.locator('.search ol').innerText()).toBe('No matches')
          for (const query of ['Quick start', 'Open a named document']) {
            await input.fill(query)
            await expect
              .poll(() => page.locator('.search ol').getAttribute('data-query'))
              .toBe(query)
            expect(await result.innerText()).toContain('Quick start')
            expect(await result.getAttribute('href')).toContain('/docs/start-here/quick-start/')
          }
          await result.click()
          await page.waitForURL('**/docs/start-here/quick-start/')
          expect(await page.locator('#doc p').count()).toBeGreaterThan(0)
          expect(await page.locator('#doc > .editor').count()).toBe(0)
        } finally {
          await context.close()
        }
      })
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
          // Safari's default keyboard policy skips links unless Option is held.
          await page.keyboard.press(engine === 'webkit' ? 'Alt+Tab' : 'Tab')
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
      test.each(['/', '/docs/start-here/quick-start/'])(
        'reload keeps captured colours on every frame at %s',
        async (path) => {
          const context = await browser.newContext({
            viewport: { width: 390, height: 844 },
            hasTouch: true,
            colorScheme: 'dark',
          })
          const page = await context.newPage()
          await page.addInitScript(() => {
            const state = window as unknown as {
              paintFrames: { time: number; registry: number; roots: number; missing: number }[]
            }
            state.paintFrames = []
            const tick = () => {
              const roots = Array.from(
                document.querySelectorAll<HTMLElement>(
                  '.example-static [data-editor-document-paint]',
                ),
              ).filter((node) => node.getBoundingClientRect().height > 0)
              const missing = roots.filter((node) => {
                const colours = new Set(
                  Array.from(
                    node.querySelectorAll<HTMLElement>('[data-editor-document-paint-row] span'),
                    (span) => getComputedStyle(span).color,
                  ),
                )
                return colours.size < 2
              }).length
              state.paintFrames.push({
                time: performance.now(),
                registry: CSS.highlights.size,
                roots: roots.length,
                missing,
              })
              if (performance.now() < 10000) requestAnimationFrame(tick)
            }
            requestAnimationFrame(tick)
          })
          try {
            for (let reload = 0; reload < 2; reload++) {
              await page.goto(`${preview.base}${path}`)
              await expect
                .poll(() => page.locator('[data-example-ready]').count(), { timeout: 20000 })
                .toBeGreaterThan(0)
              await page.waitForTimeout(300)
              const frames = await page.evaluate(
                () =>
                  (window as unknown as { paintFrames: { roots: number; missing: number }[] })
                    .paintFrames,
              )
              await writeFile(
                join(evidence, `${engine}-${path === '/' ? 'home' : 'docs'}-reload-${reload}.json`),
                JSON.stringify(frames, null, 2),
              )
              expect(frames.some((frame) => frame.roots > 0)).toBe(true)
              expect(
                frames.filter((frame) => frame.roots > 0).every((frame) => frame.missing === 0),
              ).toBe(true)
              await page.screenshot({
                path: join(
                  evidence,
                  `${engine}-${path === '/' ? 'home' : 'docs'}-reload-${reload}.png`,
                ),
              })
            }
          } finally {
            await context.close()
          }
        },
        60000,
      )
      test.each(['light', 'dark'] as const)(
        'theme labels track system and stored %s choices',
        async (theme) => {
          const context = await browser.newContext({
            viewport: { width: 390, height: 844 },
            colorScheme: theme,
          })
          const page = await context.newPage()
          try {
            await page.goto(`${preview.base}/docs/start-here/quick-start/`)
            const button = page.locator('.theme-toggle')
            await expect.poll(() => button.innerText()).toBe(theme === 'dark' ? 'Dark' : 'Light')
            await button.click()
            const next = theme === 'dark' ? 'light' : 'dark'
            await expect.poll(() => button.innerText()).toBe(next === 'dark' ? 'Dark' : 'Light')
            expect(await button.getAttribute('aria-label')).toBe(`Use ${theme} theme`)
            expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(next)
            await page.reload()
            await expect.poll(() => button.innerText()).toBe(next === 'dark' ? 'Dark' : 'Light')
            expect(await button.getAttribute('aria-pressed')).toBe(String(next === 'dark'))
          } finally {
            await context.close()
          }
        },
        45000,
      )
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
