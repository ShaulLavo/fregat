import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type { Browser, BrowserContext, BrowserContextOptions, Page, Route } from 'playwright'
import { hasChromium, startPreview, type Preview } from './preview'

const desktop: BrowserContextOptions = { viewport: { width: 1440, height: 900 } }

/** Each visible source line's top and height, from the static rows or the editor's gutter. */
function lineBoxes(page: Page, source: 'static' | 'editor') {
  return page.evaluate((source) => {
    const view = document.querySelector('.viewport')!.getBoundingClientRect()
    const lines: { line: number; top: number }[] =
      source === 'static'
        ? Array.from(document.querySelectorAll<HTMLElement>('#doc .r[data-n]'), (row) => ({
            line: Number(row.dataset.n),
            top: row.getBoundingClientRect().top,
          }))
        : Array.from(
            document.querySelectorAll<HTMLElement>(
              '.editor-host .editor-virtualized-line-number:not([hidden])',
            ),
            (cell) => ({
              line: Number(cell.style.counterSet.split(' ')[1]),
              top: cell.getBoundingClientRect().top,
            }),
          )
    lines.sort((a, b) => a.line - b.line)
    const boxes: Record<number, string> = {}
    lines.forEach(({ line, top }, index) => {
      const next = lines[index + 1]
      if (!next || next.line !== line + 1 || top < view.top || next.top > view.bottom) return
      boxes[line] = `${Math.round(top)}+${Math.round(next.top - top)}`
    })
    return boxes
  }, source)
}

describe.skipIf(!hasChromium())(
  'docs pages open in the editor (requires installed Chromium and a built site)',
  () => {
    let preview: Preview
    let browser: Browser
    let base: string

    beforeAll(async () => {
      preview = await startPreview()
      browser = preview.browser
      base = preview.base
    })

    afterAll(async () => {
      await preview?.stop()
    })

    async function open(
      path: string,
      options: BrowserContextOptions = desktop,
      prepare?: (context: BrowserContext) => Promise<unknown>,
    ) {
      const context = await browser.newContext(options)
      await prepare?.(context)
      const page = await context.newPage()
      const problems: string[] = []
      page.on('pageerror', (error) => problems.push(error.message))
      page.on('response', (response) => {
        if (response.status() >= 400) problems.push(`${response.status()} ${response.url()}`)
      })
      await page.goto(`${base}${path}`)
      await page.evaluate(() => document.fonts.ready)
      return { context, page, problems }
    }

    test.each([
      ['light', 'quick-start', 600],
      ['dark', 'introduction', 0],
    ] as const)(
      'the %s editor replaces %s at %i px without moving a line',
      async (colorScheme, name, scroll) => {
        const { context, page, problems } = await open(`/docs/start-here/${name}/?editor=off`, {
          ...desktop,
          colorScheme,
        })
        try {
          await page.evaluate((top) => (document.getElementById('doc')!.scrollTop = top), scroll)
          await page.waitForTimeout(200)
          const before = await lineBoxes(page, 'static')
          expect(Object.keys(before).length).toBeGreaterThan(20)
          await page.getByRole('button', { name: 'Open in editor' }).click()
          await page.locator('body[data-mode="editor"]').waitFor({ timeout: 20_000 })
          // Every line keeps its top and its wrapped height across the swap.
          await expect
            .poll(async () => {
              const after = await lineBoxes(page, 'editor')
              return Object.entries(before)
                .filter(([line, box]) => after[Number(line)] !== box)
                .map(([line, box]) => `${line}: ${box} became ${after[Number(line)]}`)
            })
            .toEqual([])
          expect(problems).toEqual([])
        } finally {
          await context.close()
        }
      },
    )

    test('docs links open in the same editor and follow history', async () => {
      const { context, page, problems } = await open('/docs/start-here/introduction/')
      try {
        await page.locator('body[data-mode="editor"]').waitFor({ timeout: 20_000 })
        await page
          .locator('.editor-host a.editor-markdown-link', { hasText: 'quick start' })
          .click()
        await page.waitForURL(/\/docs\/start-here\/quick-start\/$/)
        expect(await page.title()).toBe('Quick start · Singapore docs')
        expect(await page.locator('.editor-host').count()).toBe(1)
        await page
          .locator('.editor-host .editor-virtualized')
          .click({ position: { x: 300, y: 40 } })
        await page.keyboard.type('Edited')
        await expect.poll(() => page.locator('.path .dirty').count()).toBe(1)
        await page.goBack()
        await page.waitForURL(/\/docs\/start-here\/introduction\/$/)
        expect(await page.title()).toBe('Introduction · Singapore docs')
        await page.goForward()
        await page.waitForURL(/quick-start/)
        await expect.poll(() => page.locator('.editor-host').innerText()).toContain('Edited')
        expect(problems).toEqual([])
      } finally {
        await context.close()
      }
    })

    test('search finds docs pages under the built base path', async () => {
      const { context, page, problems } = await open('/docs/start-here/introduction/?editor=off')
      try {
        await page.keyboard.press('/')
        await page.getByRole('searchbox', { name: 'Search docs' }).fill('Monaco')
        const result = page.locator('dialog.search a', { hasText: 'Coming from Monaco' }).first()
        await result.waitFor()
        expect(await result.getAttribute('href')).toContain(
          `${new URL(base).pathname.replace(/\/$/, '')}/docs/start-here/monaco/`,
        )
        expect(problems).toEqual([])
      } finally {
        await context.close()
      }
    })

    test('without JavaScript the page keeps its headings and links', async () => {
      const { context, page } = await open('/docs/start-here/quick-start/', {
        ...desktop,
        javaScriptEnabled: false,
      })
      try {
        expect(await page.getByRole('heading', { level: 1 }).innerText()).toBe('Quick start')
        expect(await page.getByRole('heading', { level: 2 }).count()).toBeGreaterThan(2)
        expect(
          await page.getByRole('link', { name: 'TypeScript playground' }).count(),
        ).toBeGreaterThan(0)
      } finally {
        await context.close()
      }
    })

    test.each([320, 360, 390])(
      'phones %i px wide stay static with no sideways scroll on every editor page',
      { timeout: 120_000 },
      async (width) => {
        const prefix = new URL(base).pathname.replace(/\/$/, '')
        const listing = await open('/docs/start-here/introduction/?editor=off')
        const pages = await listing.page.evaluate(() =>
          (
            JSON.parse(document.getElementById('manual-pages')!.textContent!) as {
              url: string
            }[]
          ).map((page) => page.url),
        )
        await listing.context.close()
        for (const path of ['/'].concat(pages.map((url) => url.slice(prefix.length)))) {
          const { context, page, problems } = await open(path, {
            viewport: { width, height: 800 },
            isMobile: true,
            hasTouch: true,
          })
          try {
            expect(
              await page.evaluate(
                () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
              ),
              path,
            ).toBe(0)
            // A row is as wide as the screen allows; text that overflows it is cut off.
            const textRight = await page.evaluate(() => {
              let past = -Infinity
              for (const row of document.querySelectorAll<HTMLElement>('.r')) {
                const box = row.getBoundingClientRect()
                past = Math.max(past, box.right - document.documentElement.clientWidth)
                past = Math.max(past, row.scrollWidth - row.clientWidth)
              }
              return past
            })
            expect(textRight, `${path} text past the right edge`).toBeLessThanOrEqual(0)
            expect(await page.locator('.editor-host').count(), path).toBe(0)
            expect(problems, path).toEqual([])
          } finally {
            await context.close()
          }
        }
      },
    )

    const WORKER = /treeSitter\.worker/
    const delayed = (pattern: RegExp, ms: number) => async (context: BrowserContext) => {
      await context.route(pattern, async (route: Route) => {
        await new Promise((resolve) => setTimeout(resolve, ms))
        await route.continue()
      })
    }
    const takenOver = (page: Page) => page.locator('body[data-mode="editor"]')
    const staticVisible = (page: Page) =>
      page.locator('#doc').evaluate((element) => getComputedStyle(element).display !== 'none')
    /** The viewport top of a source line in the editor, read from its gutter label. */
    const editorLineTop = (page: Page, line: number) =>
      page.evaluate((line) => {
        const label = [
          ...document.querySelectorAll<HTMLElement>(
            '.editor-host .editor-virtualized-line-number:not([hidden])',
          ),
        ].find((cell) => cell.style.counterSet === `editor-line ${line}`)
        const view = document.querySelector('.editor-host')!.getBoundingClientRect()
        return label ? Math.round(label.getBoundingClientRect().top - view.top) : null
      }, line)

    test('a parser that never starts leaves the readable page in place', async () => {
      const { context, page } = await open('/docs/start-here/quick-start/', desktop, (context) =>
        context.route(WORKER, (route) => route.abort()),
      )
      try {
        await page.getByRole('button', { name: 'Open in editor' }).waitFor({ timeout: 20_000 })
        expect(await takenOver(page).count()).toBe(0)
        expect(await page.locator('.editor-host').count()).toBe(0)
        expect(await staticVisible(page)).toBe(true)
        expect(await page.getByRole('heading', { level: 1 }).innerText()).toBe('Quick start')
      } finally {
        await context.close()
      }
    })

    test('slow syntax swaps in only a painted preview, at the place the reader scrolled to', async () => {
      const { context, page } = await open(
        '/docs/start-here/quick-start/',
        desktop,
        delayed(WORKER, 1500),
      )
      try {
        await page.locator('.editor-host[data-state="mounting"]').waitFor({ state: 'attached' })
        await page.evaluate(() => (document.getElementById('doc')!.scrollTop = 500))
        await page.waitForTimeout(100)
        const before = await lineBoxes(page, 'static')
        await takenOver(page).waitFor({ timeout: 20_000 })
        expect(
          await page.locator('.editor-host [class*="editor-inline-"]').count(),
        ).toBeGreaterThan(0)
        await expect
          .poll(async () => {
            const after = await lineBoxes(page, 'editor')
            return Object.entries(before)
              .filter(([line, box]) => after[Number(line)] !== box)
              .map(([line, box]) => `${line}: ${box} became ${after[Number(line)]}`)
          })
          .toEqual([])
      } finally {
        await context.close()
      }
    })

    test('the latest page choice wins over a slower earlier one', async () => {
      const { context, page, problems } = await open(
        '/docs/start-here/introduction/',
        desktop,
        delayed(/start-here\/quick-start\.md$/, 1500),
      )
      try {
        await takenOver(page).waitFor({ timeout: 20_000 })
        const pages = page.getByRole('navigation', { name: 'Documentation' })
        await pages.getByRole('link', { name: 'Quick start' }).click()
        await pages.getByRole('link', { name: 'Coming from Monaco' }).click()
        await page.waitForURL(/\/monaco\/$/)
        await page.waitForTimeout(2500)
        expect(page.url()).toMatch(/\/monaco\/$/)
        expect(await page.title()).toBe('Coming from Monaco · Singapore docs')
        expect(await page.locator('.path b').innerText()).toBe('monaco.md')
        await page.goBack()
        await page.waitForURL(/\/introduction\/$/)
        await expect.poll(() => page.title()).toBe('Introduction · Singapore docs')
        expect(problems).toEqual([])
      } finally {
        await context.close()
      }
    })

    test.each([800, 1000])(
      'at %i px every section stays reachable and the header fits',
      async (width) => {
        for (const mode of ['off', 'on']) {
          const { context, page } = await open(`/docs/start-here/quick-start/?editor=${mode}`, {
            viewport: { width, height: 800 },
          })
          try {
            if (mode === 'on') await takenOver(page).waitFor({ timeout: 20_000 })
            const right = await page.evaluate(() =>
              Math.max(
                ...Array.from(
                  document.querySelectorAll('header.top *'),
                  (element) => element.getBoundingClientRect().right,
                ),
              ),
            )
            expect(right, `header at ${width} px, editor ${mode}`).toBeLessThanOrEqual(width)
            await page.getByText('Pages', { exact: true }).click()
            await page
              .getByRole('navigation', { name: 'All pages' })
              .getByRole('link', { name: 'Architecture' })
              .click()
            await page.waitForURL(/\/docs\/concepts\/architecture\/$/)
            await expect.poll(() => page.title()).toMatch(/^Architecture\b/)
          } finally {
            await context.close()
          }
        }
      },
    )

    test('fragment links scroll the editor to their heading', async () => {
      const source = await (await fetch(`${base}/docs/start-here/quick-start.md`)).text()
      const heading = source.split('\n').indexOf("## If it doesn't work") + 1
      expect(heading).toBeGreaterThan(1)
      const { context, page, problems } = await open('/docs/start-here/introduction/')
      try {
        await takenOver(page).waitFor({ timeout: 20_000 })
        await page
          .locator('.editor-host a.editor-markdown-link', { hasText: 'troubleshooting section' })
          .click()
        await page.waitForURL(/\/quick-start\/#if-it-doesnt-work$/)
        await expect.poll(() => editorLineTop(page, heading)).toBe(0)
        await page.locator('.editor-host').hover()
        await page.mouse.wheel(0, -5000)
        await expect.poll(() => editorLineTop(page, 1)).toBe(0)
        await page.mouse.wheel(0, 300)
        await page.waitForTimeout(200)
        await page
          .locator('.editor-host a.editor-markdown-link', { hasText: "If it doesn't work" })
          .click()
        await expect.poll(() => editorLineTop(page, heading)).toBe(0)
        expect(problems).toEqual([])
      } finally {
        await context.close()
      }
    })

    test('Back and Forward through a same-page fragment restore the reading place', async () => {
      const source = await (await fetch(`${base}/docs/start-here/quick-start.md`)).text()
      const heading = source.split('\n').indexOf("## If it doesn't work") + 1
      const { context, page, problems } = await open('/docs/start-here/quick-start/')
      const scrollTop = () =>
        page.locator('.editor-host .editor-virtualized').evaluate((element) => element.scrollTop)
      try {
        await takenOver(page).waitFor({ timeout: 20_000 })
        await page.locator('.editor-host').hover()
        await page.mouse.wheel(0, 300)
        await expect.poll(scrollTop).toBeGreaterThan(200)
        await page.waitForTimeout(200)
        const reading = await scrollTop()
        await page
          .locator('.editor-host a.editor-markdown-link', { hasText: "If it doesn't work" })
          .click()
        await page.waitForURL(/#if-it-doesnt-work$/)
        await expect.poll(() => editorLineTop(page, heading)).toBe(0)
        await page.goBack()
        await page.waitForURL(/\/quick-start\/$/)
        await expect.poll(async () => Math.abs((await scrollTop()) - reading)).toBeLessThan(2)
        await page.goForward()
        await page.waitForURL(/#if-it-doesnt-work$/)
        await expect.poll(() => editorLineTop(page, heading)).toBe(0)
        expect(problems).toEqual([])
      } finally {
        await context.close()
      }
    })

    test.each([320, 360, 390])('the open Pages menu fits a %i px phone', async (width) => {
      for (const mode of ['off', 'on']) {
        const { context, page } = await open(`/docs/start-here/quick-start/?editor=${mode}`, {
          viewport: { width, height: 800 },
          isMobile: true,
          hasTouch: true,
        })
        try {
          if (mode === 'on') await takenOver(page).waitFor({ timeout: 20_000 })
          await page.getByText('Pages', { exact: true }).click()
          const menu = page.getByRole('navigation', { name: 'All pages' })
          await menu.waitFor()
          const box = (await menu.boundingBox())!
          expect(box.x, `editor ${mode}`).toBeGreaterThanOrEqual(0)
          expect(box.x + box.width, `editor ${mode}`).toBeLessThanOrEqual(width)
          expect(
            await page.evaluate(
              () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
            ),
            `editor ${mode}`,
          ).toBe(0)
        } finally {
          await context.close()
        }
      }
    })

    test('the editor keeps heading roles in reading order', async () => {
      const { context, page } = await open('/docs/start-here/quick-start/')
      try {
        await takenOver(page).waitFor({ timeout: 20_000 })
        const session = await context.newCDPSession(page)
        // Playwright's snapshot ignores aria-owns, which orders the editor's rows; ask Chromium.
        const { nodes } = (await session.send('Accessibility.getFullAXTree')) as {
          nodes: { role?: { value?: string }; name?: { value?: string } }[]
        }
        const headings = nodes
          .filter((node) => node.role?.value === 'heading')
          .map((node) => node.name?.value)
        const start = headings.indexOf('Quick start')
        expect(headings.slice(start, start + 4)).toEqual([
          'Quick start',
          '1. Install the core',
          '2. Give the editor a container',
          '3. Mount it',
        ])
      } finally {
        await context.close()
      }
    })

    test('the theme toggle repaints the editor', async () => {
      const { context, page } = await open('/docs/start-here/introduction/', {
        ...desktop,
        colorScheme: 'light',
      })
      try {
        await page.locator('body[data-mode="editor"]').waitFor({ timeout: 20_000 })
        const background = () =>
          page
            .locator('.editor-host .editor-virtualized')
            .evaluate((element) => getComputedStyle(element).backgroundColor)
        const light = await background()
        await page.getByRole('button', { name: 'Dark theme' }).click()
        await expect.poll(background).not.toBe(light)
        expect(await page.locator('html').getAttribute('data-theme')).toBe('dark')
      } finally {
        await context.close()
      }
    })
  },
)
