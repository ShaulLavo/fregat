import { ok } from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import type { Scenario } from './index'
import { releaseFixture } from '../fixture-workspace'
import { selectors } from '../selectors'
import { serverApi } from '../server-api'

export const workspaceSwitch: Scenario = {
  name: 'workspace-switch',
  description:
    'In chat mode, switch to a recent folder from the project menu and check the switch settles on a draft: one address registration, then quiet.',
  async run(page, { step }) {
    await selectors.projectMenuTrigger(page).waitFor({ timeout: 15_000 })
    const folder = await mkdtemp('/work/tmp/fregat-workspace-switch-')
    const { base, headers } = serverApi(page)
    const recorded = await page.request.post(`${base}/fs/recents`, {
      data: { path: folder.slice(1) },
      headers,
    })
    ok(recorded.ok(), `recording a recent failed: ${recorded.status()}`)
    try {
      await selectors.workspaceMode(page, 'Chat').click()
      await page.waitForURL(/\/chat/, { timeout: 10_000 })
      await page.waitForTimeout(1000)
      await step('chat-mode')
      await selectors.projectMenuTrigger(page).click()
      const row = selectors.projectMenuRows(page).filter({ hasText: folder.split('/').at(-1) })
      await row.first().waitFor({ timeout: 10_000 })
      let registrations = 0
      page.on('request', (request) => {
        if (request.method() === 'POST' && request.url().endsWith('/fs/workspace-address'))
          registrations += 1
      })
      await row.first().click()
      await page.waitForTimeout(3000)
      await step('switched')
      ok(registrations <= 2, `a switch registers its address once, saw ${registrations} in 3s`)
      ok(page.url().includes('/chat/t/draft-'), `chat lands on a draft, url is ${page.url()}`)
    } finally {
      await releaseFixture(folder)
    }
  },
}
