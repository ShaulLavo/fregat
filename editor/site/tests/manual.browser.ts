import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type { Browser, BrowserContextOptions, Page } from 'playwright'
import { hasChromium, startPreview, type Preview } from './preview'

const desktop: BrowserContextOptions = { viewport: { width: 1440, height: 900 } }

/** Pixels that differ between two screenshots inside `clip`, compared in the page. */
function changedPixels(
  page: Page,
  before: Buffer,
  after: Buffer,
  clip: { x: number; y: number; width: number; height: number },
) {
  return page.evaluate(
    async ([a, b, box]) => {
      const pixels = async (base64: string) => {
        const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0))
        const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
        const context = canvas.getContext('2d')!
        context.drawImage(bitmap, 0, 0)
        return context.getImageData(box.x, box.y, box.width, box.height).data
      }
      const [one, two] = await Promise.all([pixels(a), pixels(b)])
      let changed = 0
      for (let index = 0; index < one.length; index += 4)
        if (
          one[index] !== two[index] ||
          one[index + 1] !== two[index + 1] ||
          one[index + 2] !== two[index + 2]
        )
          changed++
      return changed
    },
    [before.toString('base64'), after.toString('base64'), clip] as const,
  )
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

    test.each(['light', 'dark'] as const)(
      'the %s editor replaces the static page without moving a pixel',
      async (colorScheme) => {
        const { context, page, problems } = await open('/docs/start-here/quick-start/?editor=off', {
          ...desktop,
          colorScheme,
        })
        try {
          await page.evaluate(() => (document.getElementById('doc')!.scrollTop = 600))
          const clip = await page.evaluate(() => {
            const box = document.querySelector('.viewport')!.getBoundingClientRect()
            return { x: 0, y: Math.ceil(box.y), width: innerWidth, height: Math.floor(box.height) }
          })
          await page.waitForTimeout(200)
          const before = await page.screenshot()
          await page.getByRole('button', { name: 'Open in editor' }).click()
          await page.locator('body[data-mode="editor"]').waitFor({ timeout: 20_000 })
          // Glyph antialiasing differs by a few pixels per row; a moved row or wrap changes thousands.
          await expect
            .poll(async () => changedPixels(page, before, await page.screenshot(), clip), {
              timeout: 5_000,
            })
            .toBeLessThan(clip.width * clip.height * 0.005)
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
