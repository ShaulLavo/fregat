import { ok } from 'node:assert/strict'
import type { Scenario } from './index'
import {
  codeThemePickerIds,
  openFileByName,
  paintedTokenWords,
  selectors,
  waitForApp,
} from '../selectors'

export const codeThemeNativePreview: Scenario = {
  name: 'code-theme-native-preview',
  description:
    'Hover the built-in code themes in the palette: every word the preview and the editor behind it both show has the same colour in each.',
  async run(page, { file, step }) {
    await waitForApp(page)
    await openFileByName(page, file)
    await page.waitForTimeout(1500)
    const ids = (await codeThemePickerIds(page)).filter((id) => id.startsWith('tree-sitter'))
    ok(ids.length > 0, 'The picker lists a built-in code theme')
    for (const id of ids) {
      await selectors.codeThemeOption(page, id).hover()
      const tokens = selectors.codeThemePreviewTokens(page, id)
      await tokens.first().waitFor({ timeout: 10_000 })
      await page.waitForTimeout(1200)
      const preview = await tokens.evaluateAll((spans) =>
        spans.map((span) => [span.textContent!.trim(), getComputedStyle(span).color] as const),
      )
      const editor = new Map(await paintedTokenWords(selectors.editorSurface(page).first()))
      const compared = preview.filter(([word]) => word.length > 0 && editor.has(word))
      const differing = compared.filter(([word, color]) => editor.get(word) !== color)
      await step(`preview-${id}`)
      ok(compared.length >= 4, `${id}: the preview and editor share words (${compared.length})`)
      ok(
        differing.length === 0,
        `${id}: preview colours differ from the editor for ${differing
          .map(([word, color]) => `${word} ${color} vs ${editor.get(word)}`)
          .join(', ')}`,
      )
    }
    await page.keyboard.press('Escape')
  },
}
