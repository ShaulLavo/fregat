import type { Page } from 'playwright'
import { match, strictEqual } from 'node:assert'
import type { Scenario } from './index'
import { focusEditor, openFileByName, selectors } from '../selectors'

const SAMPLE = 'hoverSampleValue'
/** Spelled with a Cyrillic а, so the same name carries a diagnostic and an ambiguous character. */
const CONFUSABLE = 'hoverS\u0430mple'

export const editorLspHover: Scenario = {
  name: 'editor-lsp-hover',
  description:
    'Hover a TypeScript identifier, then a confusable one, and check the one shared tooltip.',
  async run(page, { file, step }) {
    await openFileByName(page, file)
    await focusEditor(page)
    await page.keyboard.press('Control+Home')
    await page.keyboard.insertText(`const ${SAMPLE} = 1\n`)
    await page.waitForTimeout(2500)
    await hoverWord(page, SAMPLE)
    match(await selectors.editorHover(page).innerText(), new RegExp(`${SAMPLE}.*1`, 's'))
    await step('hover')
    await page.keyboard.press('Escape')
    await page.keyboard.insertText(`const ${CONFUSABLE} = 2\n`)
    await page.waitForTimeout(2500)
    await hoverMarker(page)
    const combined = await selectors.editorHover(page).innerText()
    match(combined, /U\+0430/, 'the ambiguous character is explained')
    match(combined, /never (used|read)/, 'the diagnostic sits in the same tooltip')
    strictEqual(await selectors.editorHover(page).count(), 1, 'one hover, not one per plugin')
    await step('combined')
    await page.keyboard.press('Escape')
    await page.keyboard.press('Control+z')
    await page.keyboard.press('Control+z')
    await step('restored')
  },
}

async function hoverMarker(page: Page) {
  const marker = selectors.editorAmbiguousCharacters(page).first()
  const box = await marker.boundingBox()
  if (!box) throw new Error('marker is not on screen')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await selectors.editorHover(page).waitFor({ state: 'visible', timeout: 8000 })
  await page.waitForTimeout(400)
}

async function hoverWord(page: Page, word: string) {
  // A string: this package types without the DOM, and the callback runs in the page.
  const point = (await page.evaluate(`((needle) => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const index = node.textContent?.indexOf(needle) ?? -1
      if (index < 0) continue
      const range = document.createRange()
      range.setStart(node, index)
      range.setEnd(node, index + needle.length)
      const rect = range.getBoundingClientRect()
      if (rect.width === 0) continue
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
    }
    throw new Error(needle + ' is not on screen')
  })(${JSON.stringify(word)})`)) as { x: number; y: number }
  await page.mouse.move(point.x, point.y)
  await selectors.editorHover(page).waitFor({ state: 'visible', timeout: 8000 })
  await page.waitForTimeout(400)
}
