import { strictEqual } from 'node:assert/strict'
import { selectors } from '../selectors'
import type { Scenario } from './index'

export const settingsFontInput: Scenario = {
  name: 'settings-font-input',
  description:
    'Edit a font draft, cancel with Escape, and verify the saved family remains visible.',
  async run(page, { step }) {
    await page.keyboard.press('Control+,')
    await selectors.settingsSearch(page).fill('font')
    const field = selectors.settingsFontFamily(page).first()
    await field.waitFor()
    const original = await field.inputValue()
    await field.fill('Unsaved font draft')
    await step('font-draft')
    await field.press('Escape')
    strictEqual(await field.inputValue(), original, 'Escape must restore the saved font family')
    await step('font-draft-cancelled')
  },
}
