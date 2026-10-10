import { holdEditor } from '../../../scripts/agent/site-takeover'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { webkit, type Browser, type Page } from 'playwright'
import { existsSync } from 'node:fs'
import { hasChromium, startPreview, type Preview } from './preview'
import { singaporeSiteSelectors as site } from '../../../scripts/agent/selectors'

async function replaceSource(page: Page, text: string) {
  await page.locator('.editor-virtualized-viewport').click({ position: { x: 70, y: 20 } })
  const apple = await page.evaluate(() =>
    /mac/i.test(`${navigator.platform} ${navigator.userAgent}`),
  )
  await page.keyboard.press(apple ? 'Meta+a' : 'Control+a')
  await page.keyboard.press('Backspace')
  if (text) await page.keyboard.insertText(text)
}

for (const engine of ['chromium', 'webkit'] as const) {
  describe.skipIf(!hasChromium() || (engine === 'webkit' && !existsSync(webkit.executablePath())))(
    `${engine} review regressions`,
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
      test.each(['Hello reader', ''])(
        'edited Markdown %j survives navigation and history',
        async (text) => {
          const page = await browser.newPage()
          try {
            await page.goto(`${preview.base}/docs/start-here/introduction/`)
            await site.live(page).waitFor()
            await replaceSource(page, text)
            await page
              .locator('nav[aria-label="Documentation"] a[data-md="start-here/quick-start.md"]')
              .click()
            await page.waitForURL(/\/docs\/start-here\/quick-start\/$/)
            expect(await page.getByRole('heading', { level: 1 }).innerText()).toBe('Quick start')
            await page.goBack()
            await page.waitForURL(/\/docs\/start-here\/introduction\//)
            await expect
              .poll(() => page.locator('.editor-host').innerText())
              .not.toContain('Introduction')
            if (text)
              await expect.poll(() => page.locator('.editor-host').innerText()).toContain(text)
            expect(await site.live(page).isVisible()).toBe(true)
          } finally {
            await page.close()
          }
        },
      )
      test.each(['static', 'editor'])('skip to content moves focus in %s mode', async (mode) => {
        const page = await browser.newPage()
        const release = await holdEditor(page)
        try {
          await page.goto(`${preview.base}/docs/start-here/introduction/`)
          await site.static(page).waitFor()
          if (mode === 'editor') {
            release()
            await site.live(page).waitFor()
          }
          await page.keyboard.press('Tab')
          expect(
            await page.locator('.skip').evaluate((element) => element === document.activeElement),
          ).toBe(true)
          await page.keyboard.press('Enter')
          await expect
            .poll(() =>
              page.evaluate(
                () =>
                  document.activeElement?.id === 'doc' ||
                  Boolean(document.activeElement?.closest('#doc')),
              ),
            )
            .toBe(true)
          await page.keyboard.press('Tab')
          expect(
            await page.evaluate(() => Boolean(document.activeElement?.closest('header'))),
          ).toBe(false)
        } finally {
          release()
          await page.close()
        }
      })
    },
  )
}
