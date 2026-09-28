import { strictEqual } from 'node:assert/strict'
import { selectors } from '../selectors'
import type { Scenario } from './index'

export const gitDiffBudget: Scenario = {
  name: 'git-diff-budget',
  description: 'The machine Git size budget defaults to 50 MiB and persists a new value.',
  async run(page, { step }) {
    await page.keyboard.press('Control+,')
    await selectors.settingsSearch(page).fill('Diff file size limit')
    const field = selectors.settingsNumber(page, 'Diff file size limit')
    await field.waitFor()
    strictEqual(await field.inputValue(), '50')
    await step('default-budget')
    await field.fill('1')
    const saved = page.waitForResponse(
      (response) =>
        response.url().endsWith('/settings/write') && response.request().method() === 'POST',
    )
    await field.press('Tab')
    strictEqual((await saved).status(), 200)
    await page.reload()
    await selectors.settingsSearch(page).fill('Diff file size limit')
    await field.waitFor()
    strictEqual(await field.inputValue(), '1')
    await step('saved-budget')
  },
}
