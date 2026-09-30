import { selectors } from '../selectors'
import type { Scenario } from './index'

export const settingsTokenizationLimit: Scenario = {
  name: 'settings-tokenization-limit',
  description:
    'Settings search finds the tokenization line limit row with its 20,000 default. Reads only.',
  readOnly: true,
  async run(page, { step }) {
    await page.keyboard.press('Control+,')
    await selectors.settingsSearch(page).fill('tokenization')
    await page.getByText('Tokenization line limit', { exact: true }).waitFor()
    await page.getByText('Longer lines show as plain text in the theme foreground.').waitFor()
    await step('tokenization-limit-row')
  },
}
