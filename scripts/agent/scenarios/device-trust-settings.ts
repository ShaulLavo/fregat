import { ok } from 'node:assert/strict'
import { selectors } from '../selectors'
import type { Scenario } from './index'

export const deviceTrustSettings: Scenario = {
  name: 'device-trust-settings',
  readOnly: true,
  description: 'Find the reverse proxy trust setting and check its client-address requirements.',
  async run(page, { step }) {
    await page.keyboard.press('Control+,')
    await selectors.settingsSearch(page).fill('trusted reverse proxy hosts')
    const row = selectors.settingsRow(page, 'environments.trustedProxyHosts')
    await row.waitFor({ state: 'visible' })
    const text = await row.innerText()
    ok(text.includes('Trusted reverse proxy hosts'), 'The public setting title is visible')
    ok(
      text.includes('replace X-Forwarded-For'),
      'The proxy must replace the client-supplied address',
    )
    await step('trusted-proxy-hosts')
  },
}
