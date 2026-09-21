import type { Page } from 'playwright'
import { match, strictEqual } from 'node:assert'
import type { Scenario } from './index'
import { focusEditor, hoverTokenColor, hoverWord, openFileByName, selectors } from '../selectors'

const SAMPLE = 'hoverSampleValue'
/** Spelled with a Cyrillic а, so the same name carries a diagnostic and an ambiguous character. */
const CONFUSABLE = 'hoverS\u0430mple'

export const editorLspHover: Scenario = {
  name: 'editor-lsp-hover',
  description:
    'Hover a TypeScript identifier, then a confusable one, and check the one shared tooltip.',
  async run(page, { file, step }) {
    await openFileByName(page, file)
    await page.evaluate(`(() => {
      const seen = (window.__hoverPaint = { code: 0, span: 0 })
      new MutationObserver(() => {
        if (!seen.code && document.querySelector('pre > code')) seen.code = performance.now()
        if (!seen.span && document.querySelector('pre > code > span')) seen.span = performance.now()
      }).observe(document.body, { childList: true, subtree: true })
    })()`)
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const shown = await hoverWord(page, 'NavigationStatus', '.editor-virtualized-viewport').then(
        () => true,
        () => false,
      )
      if (shown) break
      await page.mouse.move(5, 5)
    }
    await page.waitForTimeout(6000)
    console.log(
      'HOVER_FIRST',
      JSON.stringify(
        await page.evaluate(
          '({d: window.__hoverPaint.span - window.__hoverPaint.code, ...window.__hoverPaint})',
        ),
      ),
    )
    await page.keyboard.press('Escape')
    await focusEditor(page)
    await page.keyboard.press('Control+Home')
    await page.keyboard.insertText(`const ${SAMPLE} = 1\n`)
    await page.waitForTimeout(2500)
    await hoverWord(page, SAMPLE)
    match(await selectors.editorHover(page).innerText(), new RegExp(`${SAMPLE}.*1`, 's'))
    strictEqual(
      await hoverTokenColor(page, SAMPLE),
      true,
      'the identifier is painted by the editor tokens, not left plain',
    )
    await step('hover')
    await page.keyboard.press('Escape')
    await page.keyboard.insertText(`const ${CONFUSABLE} = 2\n`)
    await page.waitForTimeout(2500)
    await hoverMarker(page)
    const combined = await selectors.editorHover(page).innerText()
    match(combined, /U\+0430/, 'the ambiguous character is explained')
    match(combined, /never (used|read)/, 'the diagnostic sits in the same tooltip')
    match(combined, /\(6133\)/, 'the diagnostic names its source and code')
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
