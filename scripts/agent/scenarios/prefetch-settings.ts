import { equal, ok } from 'node:assert/strict'
import { selectors } from '../selectors'
import type { Scenario } from './index'

export const prefetchSettings: Scenario = {
  name: 'prefetch-settings',
  description:
    'Searching settings for "prefetch" lists the master switch with each surface indented under it; turning the master off disables and clears the surfaces. Writes only the throwaway server.',
  async run(page, { step }) {
    await page.keyboard.press('Control+,')
    await selectors.settingsSearch(page).fill('prefetch')
    const master = selectors.settingsSwitch(page, 'Prefetch on intent')
    const diffs = selectors.settingsSwitch(page, 'Prefetch diffs')
    const files = selectors.settingsSwitch(page, 'Prefetch files')
    await files.waitFor()
    equal(await master.getAttribute('aria-checked'), 'true', 'Prefetch defaults to on')
    equal(await files.getAttribute('aria-checked'), 'true', 'File prefetch defaults to on')
    equal(await diffs.getAttribute('aria-checked'), 'true')
    await step('on')

    await master.click()
    await selectors.settingsDependencyNote(page, 'Prefetch on intent').first().waitFor()
    ok(await files.isDisabled(), 'A surface is disabled while prefetch is off')
    equal(await files.getAttribute('aria-checked'), 'false', 'A surface reads off under it')
    ok(await diffs.isDisabled())
    equal(await diffs.getAttribute('aria-checked'), 'false')
    await step('off')

    await master.click()
    await page.getByRole('switch', { name: 'Prefetch files', checked: true }).waitFor()
  },
}
