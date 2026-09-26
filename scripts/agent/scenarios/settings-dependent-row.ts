import { equal, ok } from 'node:assert/strict'
import { selectors } from '../selectors'
import type { Scenario } from './index'

export const settingsDependentRow: Scenario = {
  name: 'settings-dependent-row',
  description:
    'A dependsOn row sits indented under its parent, disabled and off while the parent is off, and editable once it is on. Writes only the throwaway server.',
  async run(page, { step }) {
    await page.keyboard.press('Control+,')
    await selectors.settingsSearch(page).fill('semantic tokens')
    const parent = selectors.settingsSwitch(page, 'Semantic tokens enabled')
    const child = selectors.settingsSwitch(page, 'Semantic tokens delta')
    await child.waitFor()

    equal(await parent.getAttribute('aria-checked'), 'false', 'The parent defaults to off')
    ok(await child.isDisabled(), 'The child is disabled while its parent is off')
    equal(
      await child.getAttribute('aria-checked'),
      'false',
      'The child reads off under an off parent',
    )
    await selectors.settingsDependencyNote(page, 'Semantic tokens enabled').waitFor()
    await step('child-disabled')

    await parent.click()
    // The child's stored default comes back once the parent is on.
    await page.getByRole('switch', { name: 'Semantic tokens delta', checked: true }).waitFor()
    ok(!(await child.isDisabled()), 'The child is editable once its parent is on')
    await step('child-enabled')

    await parent.click()
  },
}
