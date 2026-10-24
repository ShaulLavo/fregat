import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { webkit, type Browser, type Locator } from 'playwright'
import { hasChromium, startPreview, type Preview } from './preview'

const evidence = join(
  tmpdir(),
  'singapore-live-evidence',
  new Date().toISOString().replaceAll(':', '-'),
)

async function selection(example: Locator) {
  const input = example.locator('textarea')
  await expect
    .poll(() =>
      input.evaluate((node: HTMLTextAreaElement) => node.selectionEnd - node.selectionStart),
    )
    .toBeGreaterThan(0)
  const selected = await input.evaluate((node: HTMLTextAreaElement) =>
    node.value.slice(node.selectionStart, node.selectionEnd),
  )
  const range = example.locator('.editor-virtualized-selection-range').first()
  await range.waitFor({ state: 'visible' })
  expect(await range.evaluate((node) => getComputedStyle(node).backgroundColor)).not.toBe(
    'rgba(0, 0, 0, 0)',
  )
  const stage = example.locator('.example-stage')
  const caret = '.editor-virtualized-caret-layer{visibility:hidden!important}'
  const visible = await stage.screenshot({ style: caret })
  const hidden = await stage.screenshot({
    style: `${caret}.editor-virtualized-selection-range{visibility:hidden!important}`,
  })
  expect(visible.equals(hidden), 'Selection changes the painted example').toBe(false)
  return selected
}

async function pointOnText(row: Locator, text: string, index: number) {
  await row.scrollIntoViewIfNeeded()
  return row.evaluate(
    (node, target) => {
      let offset = (node.textContent ?? '').indexOf(target.text) + target.index
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT)
      for (let textNode = walker.nextNode(); textNode; textNode = walker.nextNode()) {
        const length = textNode.textContent?.length ?? 0
        if (offset >= length) {
          offset -= length
          continue
        }
        const range = document.createRange()
        range.setStart(textNode, offset)
        range.setEnd(textNode, offset + 1)
        const box = range.getBoundingClientRect()
        return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
      }
      throw new TypeError('Example text has no mounted character at this position')
    },
    { text, index },
  )
}

for (const engine of ['chromium', 'webkit'] as const) {
  describe.skipIf(!hasChromium() || (engine === 'webkit' && !existsSync(webkit.executablePath())))(
    `${engine} live example interactions`,
    () => {
      let preview: Preview
      let browser: Browser
      beforeAll(async () => {
        await mkdir(evidence, { recursive: true })
        console.log(`Live example evidence: ${evidence}`)
        preview = await startPreview()
        browser = engine === 'chromium' ? preview.browser : await webkit.launch()
      })
      afterAll(async () => {
        if (engine === 'webkit') await browser?.close()
        await preview?.stop()
      })
      for (const width of [390, 1280]) {
        for (const action of ['caret', 'drag', 'keyboard', 'word', 'touch-word'] as const) {
          if (action === 'touch-word' && width >= 768) continue
          const touchGap = action === 'touch-word' && engine === 'webkit'
          test.skipIf(touchGap)(
            `${action} at ${width}px${touchGap ? ' (needs core touch selection)' : ''}`,
            async () => {
              const context = await browser.newContext({
                viewport: { width, height: 844 },
                hasTouch: width < 768,
                isMobile: width < 768 && engine === 'chromium',
              })
              const page = await context.newPage()
              try {
                await page.goto(`${preview.base}/docs/start-here/quick-start/`)
                await page.evaluate(() => document.fonts.ready)
                const example = page.locator('[data-example]').first()
                await expect
                  .poll(() => example.getAttribute('data-example-ready'), { timeout: 20000 })
                  .toBe('')
                const stage = example.locator('.example-stage')
                await stage.scrollIntoViewIfNeeded()
                const staticPixels = await stage.screenshot()
                await example.getByRole('button', { name: /Edit/ }).click()
                await expect.poll(() => example.getAttribute('data-example-live')).toBe('')
                const activatedPixels = await stage.screenshot({
                  style: '.editor-virtualized-caret-layer{visibility:hidden!important}',
                })
                expect(
                  activatedPixels.equals(staticPixels),
                  'Activation keeps the static paint',
                ).toBe(true)
                const row = example.locator('.editor-virtualized-row').first()
                await row.scrollIntoViewIfNeeded()
                const box = await row.boundingBox()
                expect(box).not.toBeNull()
                const x = box!.x + 25
                const y = box!.y + box!.height / 2
                if (action === 'drag') {
                  await page.mouse.move(x, y)
                  await page.mouse.down()
                  await page.mouse.move(x + 70, y, { steps: 12 })
                  await page.mouse.up()
                  await selection(example)
                }
                if (action === 'keyboard') {
                  await page.mouse.click(x, y)
                  await page.keyboard.press('Shift+ArrowRight')
                  expect((await selection(example)).length).toBe(1)
                }
                if (action === 'word') {
                  await page.mouse.dblclick(x, y)
                  expect(await selection(example)).toMatch(/^\w+$/)
                }
                if (action === 'touch-word') {
                  await page.touchscreen.tap(x, y)
                  await page.touchscreen.tap(x, y)
                  expect(await selection(example)).toMatch(/^\w+$/)
                }
                if (action === 'caret') {
                  if (width < 768) await page.touchscreen.tap(x, y)
                  else await page.mouse.click(x, y)
                  const active = example.locator('.editor-virtualized-cursor-line-row').first()
                  await expect
                    .poll(() => active.evaluate((node) => getComputedStyle(node).backgroundColor))
                    .not.toBe('rgba(0, 0, 0, 0)')
                  const gutter = example.locator('.editor-virtualized-cursor-line-gutter').first()
                  await expect
                    .poll(() => gutter.evaluate((node) => getComputedStyle(node).backgroundColor))
                    .not.toBe('rgba(0, 0, 0, 0)')
                  const number = example.locator('.editor-virtualized-line-number-active').first()
                  expect(await number.evaluate((node) => getComputedStyle(node).color)).not.toBe(
                    await example
                      .locator('.editor')
                      .evaluate((node) =>
                        getComputedStyle(node)
                          .getPropertyValue('--editor-gutter-foreground')
                          .trim(),
                      ),
                  )
                }
                await example.screenshot({
                  path: join(evidence, `${engine}-${width}-${action}.png`),
                })
              } finally {
                await context.close()
              }
            },
          )
        }
        test(`word, bracket and blinking caret at ${width}px`, async () => {
          const context = await browser.newContext({ viewport: { width, height: 844 } })
          const page = await context.newPage()
          try {
            await page.goto(`${preview.base}/docs/start-here/quick-start/`)
            const example = page.locator('[data-example][aria-label="ts code example"]').first()
            await example.scrollIntoViewIfNeeded()
            await expect
              .poll(() => example.getAttribute('data-example-ready'), { timeout: 20000 })
              .toBe('')
            await example.getByRole('button', { name: /Edit/ }).click()
            await expect.poll(() => example.getAttribute('data-example-live')).toBe('')
            const row = example
              .locator('.editor-virtualized-row')
              .filter({ hasText: 'new Editor(element)' })
              .first()
            const word = await pointOnText(row, 'editor', 2)
            await page.mouse.click(word.x, word.y)
            await expect
              .poll(() =>
                page.evaluate(() =>
                  Array.from(CSS.highlights)
                    .filter(([name]) => name.endsWith('-occurrence-highlight'))
                    .flatMap(([, highlight]) => Array.from(highlight, String)),
                ),
              )
              .toEqual(expect.arrayContaining(['editor']))
            const bracket = await pointOnText(row, 'Editor(', 6)
            await page.mouse.click(bracket.x, bracket.y)
            await expect
              .poll(() =>
                page.evaluate(() =>
                  Array.from(CSS.highlights)
                    .filter(([name]) => name.endsWith('-bracket-match'))
                    .flatMap(([, highlight]) => Array.from(highlight, String)),
                ),
              )
              .toEqual(['(', ')'])
            const caret = example.locator('.editor-virtualized-caret-layer')
            expect(await caret.evaluate((node) => getComputedStyle(node).animationName)).toBe(
              'editor-virtualized-caret-blink',
            )
            await example.screenshot({ path: join(evidence, `${engine}-${width}-bracket.png`) })
          } finally {
            await context.close()
          }
        })
      }
    },
  )
}
