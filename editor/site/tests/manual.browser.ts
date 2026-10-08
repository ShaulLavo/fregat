import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type { Browser, BrowserContextOptions, Page } from 'playwright'
import { hasChromium, startPreview, type Preview } from './preview'

const desktop: BrowserContextOptions = { viewport: { width: 1440, height: 900 } }

/** Each visible source line's top and height, from the static rows or the editor's gutter. */
function lineBoxes(page: Page, source: 'static' | 'editor') {
  return page.evaluate((source) => {
    const view = document.querySelector('.viewport')!.getBoundingClientRect()
    const lines: { line: number; top: number }[] =
      source === 'static'
        ? [...document.querySelectorAll<HTMLElement>('#doc .r[data-n]')].map((row) => ({
            line: Number(row.dataset.n),
            top: row.getBoundingClientRect().top,
          }))
        : [
            ...document.querySelectorAll<HTMLElement>(
              '.editor-host .editor-virtualized-line-number:not([hidden])',
            ),
          ].map((cell) => ({
            line: Number(cell.style.counterSet.split(' ')[1]),
            top: cell.getBoundingClientRect().top,
          }))
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

    async function open(path: string, options: BrowserContextOptions = desktop) {
      const context = await browser.newContext(options)
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
        for (const path of ['/', ...pages.map((url) => url.slice(prefix.length))]) {
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
