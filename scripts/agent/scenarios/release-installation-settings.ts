import { ok } from 'node:assert/strict'
import type { Scenario } from './index'
import { selectors } from '../selectors'

export const releaseInstallationSettings: Scenario = {
  name: 'release-installation-settings',
  description: 'Read the machine installation target and restart-wait guidance in Settings.',
  requiresIsolatedServer: true,
  capture: { width: 1440, height: 1000 },
  async run(page, { step }) {
    await page.keyboard.press('Control+,')
    await selectors.settingsSearch(page).waitFor()
    await selectors.settingsSearch(page).fill('developer.deployTarget')
    const target = selectors.settingsRow(page, 'developer.deployTarget')
    await target.waitFor()
    const targetText = await target.innerText()
    ok(targetText.includes('Installation target'))
    ok(targetText.includes('Install releases and pair through Mesh and systemd.'))
    await step('installation-target')

    await selectors.settingsSearch(page).fill('developer.deployRestartWaitMinutes')
    const restart = selectors.settingsRow(page, 'developer.deployRestartWaitMinutes')
    await restart.waitFor()
    const restartText = await restart.innerText()
    ok(restartText.includes('Restart wait'))
    ok(restartText.includes('Minutes to wait for busy sessions.'))
    ok(restartText.includes('--interrupt ends them and restarts.'))
    await step('installation-restart-wait')
  },
}
