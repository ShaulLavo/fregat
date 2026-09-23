import type { Locator, Page } from 'playwright'
import { match, strictEqual } from 'node:assert'
import type { Scenario } from './index'
import { chords, focusEditor, openFileByName, runPaletteCommand, selectors } from '../selectors'

export const editorMarkdownPunctuation: Scenario = {
  name: 'editor-markdown-punctuation',
  description: 'Explain Unicode highlights in the editor and diff, then open their settings.',
  async run(page, { file, step }) {
    await openFileByName(page, file)
    await focusEditor(page)
    await page.keyboard.press('Control+Home')
    await page.keyboard.insertText(
      '# Punctuation check\n\nHello – world. Hello — world.\n\n- First item\n- Second item\n\npаssword and hidden\u200bspace\n\n',
    )
    await page.waitForTimeout(2000)
    await hoverMarker(page, selectors.editorAmbiguousCharacters(page).first())
    match(await selectors.editorHover(page).innerText(), /U\+2013.*U\+002D/s)
    await step('dash-explanation')
    await hoverMarker(page, selectors.editorInvisibleCharacters(page).first())
    match(await selectors.editorHover(page).innerText(), /U\+200B.*invisible/s)
    await step('invisible-explanation')
    await page.mouse.move(0, 0)
    await page.keyboard.press('Escape')
    await page.keyboard.press('Control+Home')
    for (let line = 0; line < 7; line++) await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Home')
    // Before the zero-width character: a keyboard hover has no point, only the caret's offset.
    for (let column = 0; column < 'pаssword and hidden'.length; column++) {
      await page.keyboard.press('ArrowRight')
    }
    await runPaletteCommand(page, 'Show hover')
    await selectors.editorHover(page).waitFor({ state: 'visible', timeout: 5000 })
    match(await selectors.editorHover(page).innerText(), /U\+200B.*invisible/s)
    await step('invisible-keyboard-explanation')
    const ambiguous = await selectors.editorAmbiguousCharacters(page).count()
    const invisible = await selectors.editorInvisibleCharacters(page).count()
    await page.keyboard.press(chords.commandPalette)
    await selectors.paletteInput(page).fill('>Compare with saved')
    await selectors.commandOption(page, 'Compare with saved').click()
    await page.waitForTimeout(2000)
    await hoverMarker(page, selectors.diffAmbiguousCharacters(page).first())
    match(await selectors.editorHover(page).innerText(), /U\+2013.*U\+002D/s)
    await step('diff-explanation')
    const diffAmbiguous = await selectors.diffAmbiguousCharacters(page).count()
    const diffInvisible = await selectors.diffInvisibleCharacters(page).count()
    await selectors.unicodeAdjustSettings(page).click()
    await selectors.settingsSearch(page).waitFor({ timeout: 5000 })
    strictEqual(await selectors.settingsSearch(page).inputValue(), 'unicode')
    await step('unicode-settings')
    await openFileByName(page, file)
    await focusEditor(page)
    await page.keyboard.press('Control+z')
    await step('restored')
    strictEqual(ambiguous, 2, 'The dash and lookalike letter should be marked')
    strictEqual(invisible, 1, 'The invisible character should remain marked')
    strictEqual(diffAmbiguous, 2, 'The diff should mark the dash and lookalike letter')
    strictEqual(diffInvisible, 1, 'The diff should still mark the invisible character')
  },
}

async function hoverMarker(page: Page, marker: Locator) {
  const box = await marker.boundingBox()
  if (!box) throw new Error('marker is not on screen')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await selectors.editorHover(page).waitFor({ state: 'visible', timeout: 5000 })
  await page.waitForTimeout(400)
}
