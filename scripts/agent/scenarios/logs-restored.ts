import { equal } from 'node:assert/strict'
import type { Page } from 'playwright'
import { selectors } from '../selectors'
import type { Scenario } from './index'

export const logsRestored: Scenario = {
  name: 'logs-restored',
  description: 'A restored Logs sidebar and chat tool pane paint their header with the workbench.',
  async run(page, { step }) {
    await selectors.logsTab(page).click()
    await checkReload(page)
    await step('sidebar-restored')
    await selectors.workspaceMode(page, 'Chat').click()
    await selectors.chatToolTab(page, 'Logs').click()
    await checkReload(page)
    await step('chat-logs-restored')
  },
}

async function checkReload(page: Page) {
  await selectors.logsSearch(page).waitFor()
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Network.enable')
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
  await page.route('**/assets/panel-*.js', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 750))
    await route.continue()
  })
  await page.addInitScript(`(() => {
    window.__bareLogsFrames = 0
    const sample = () => {
      if (document.querySelector('[aria-label="Opening logs"]')) window.__bareLogsFrames++
      requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
  })()`)
  await page.reload()
  await selectors.logsSearch(page).waitFor()
  equal(
    await page.evaluate('window.__bareLogsFrames'),
    0,
    'Restored Logs painted a bare module spinner',
  )
  await page.unroute('**/assets/panel-*.js')
  await cdp.detach()
}
