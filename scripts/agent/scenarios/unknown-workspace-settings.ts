import { ok } from 'node:assert/strict'
import type { Scenario } from './index'
import { selectors } from '../selectors'

export const unknownWorkspaceSettings: Scenario = {
  name: 'unknown-workspace-settings',
  description:
    'Traverse an unknown workspace link and reopen Settings without its discarded filter.',
  requiresIsolatedServer: true,
  async run(page, { step }) {
    const known = new URL(page.url())
    const prefix = known.pathname.slice(0, known.pathname.indexOf('/~'))
    known.pathname = `${prefix}/~-/workbench/settings`
    known.search = '?settings=Providers'
    await page.goto(known.href)
    await selectors.settingsCategoryFilter(page, 'Providers').waitFor()
    await step('known-folderless-category')

    const missing = new URL(known)
    missing.pathname = `${prefix}/~reports.RjKnJca3LpfzgX1Y/workbench/settings`
    await page.evaluate(
      ({ missing, known }) => {
        window.history.pushState(null, '', missing)
        window.history.pushState(null, '', known)
      },
      { missing: missing.href, known: known.href },
    )
    await page.goBack()
    await page.waitForURL((url) => url.pathname === `${prefix}/~-/workbench`)
    await step('unknown-workspace-start-page')
    await page.keyboard.press('Control+,')
    await selectors.settingsSearch(page).waitFor()
    await selectors.settingsCategoryHeading(page, 'Appearance').waitFor()
    ok(
      (await selectors.settingsCategoryFilter(page, 'Providers').count()) === 0,
      'The discarded Providers category is absent when Settings reopens',
    )
    await step('reopened-settings-without-category')
  },
}
