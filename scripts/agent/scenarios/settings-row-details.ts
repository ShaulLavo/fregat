import { ok } from 'node:assert/strict'
import { selectors } from '../selectors'
import type { Scenario } from './index'

export const settingsRowDetails: Scenario = {
  name: 'settings-row-details',
  readOnly: true,
  description:
    'A setting with details shows an info icon after its title; hovering it shows why the default is what it is. A setting without details shows none.',
  async run(page, { step }) {
    await page.keyboard.press('Control+,')
    await selectors.settingsSearch(page).fill('lsp')
    const delta = selectors.settingDetailsButton(page, 'Semantic tokens delta')
    await delta.waitFor()
    ok(
      (await selectors.settingDetailsButton(page, 'Idle timeout ms').count()) === 0,
      'A self-explanatory row has no details icon',
    )
    await step('language-servers')

    await delta.hover()
    await page.getByText('Measured with rust-analyzer', { exact: false }).waitFor()
    await step('delta-details')
  },
}
