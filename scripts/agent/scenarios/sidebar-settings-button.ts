import { deepStrictEqual, ok, strictEqual } from 'node:assert/strict'
import type { Page } from 'playwright'
import type { Scenario } from './index'
import { selectors } from '../selectors'

async function checkRail(page: Page, mode: 'Workbench' | 'Chat') {
  const button = selectors.sidebarSettingsButton(page, mode)
  await button.waitFor({ timeout: 15_000 })
  strictEqual(await button.count(), 1, `${mode} must have exactly one Settings action`)
  const labels = await selectors
    .workspaceRailButtons(page, mode)
    .evaluateAll((buttons) => buttons.map((element) => element.getAttribute('aria-label')))
  const expected =
    mode === 'Workbench'
      ? ['Files', 'Git', 'Search', 'Logs', 'Chat', 'Settings']
      : ['Git', 'Files', 'Editor', 'Search', 'Terminal', 'Problems', 'Logs', 'Settings']
  deepStrictEqual(labels, expected, `${mode} must retain its own tabs`)
  const railBox = await selectors.workspaceRail(page, mode).boundingBox()
  const buttonBox = await button.boundingBox()
  ok(railBox && buttonBox, `${mode} rail and Settings must be laid out`)
  const gap = railBox.y + railBox.height - (buttonBox.y + buttonBox.height)
  ok(gap >= 0 && gap <= 12, `${mode} Settings must be pinned inside the rail bottom`)
}

export const sidebarSettingsButton: Scenario = {
  name: 'sidebar-settings-button',
  description: 'Check both rails retain their tabs, toggle panels, and always offer Settings.',
  async run(page, { step }) {
    for (const mode of ['Workbench', 'Chat'] as const) {
      await selectors.workspaceMode(page, mode).click()
      await selectors.workspaceRail(page, mode).waitFor()
      await step(`${mode.toLowerCase()}-rail`)
      await checkRail(page, mode)
      const search =
        mode === 'Workbench'
          ? selectors.sidebarTab(page, 'Search')
          : selectors.chatToolTab(page, 'Search')
      await search.click()
      await selectors.workspaceSearch(page).waitFor()
      await step(`${mode.toLowerCase()}-search-open`)
      await search.click()
      await selectors.workspaceSearch(page).waitFor({ state: 'hidden', timeout: 3000 })
      strictEqual(await search.getAttribute('aria-pressed'), 'false')
      await checkRail(page, mode)
      await step(`${mode.toLowerCase()}-panel-collapsed`)
      await search.click()
      await selectors.workspaceSearch(page).waitFor()
      strictEqual(await search.getAttribute('aria-pressed'), 'true')
      await step(`${mode.toLowerCase()}-search-reopened`)
      await selectors.sidebarSettingsButton(page, mode).hover()
      await selectors.hint(page, 'Settings').waitFor()
      await selectors.sidebarSettingsButton(page, mode).click()
      await selectors.settingsSearch(page).waitFor({ timeout: 15_000 })
      strictEqual(await selectors.workspaceMode(page, mode).getAttribute('aria-pressed'), 'true')
      await step(`${mode.toLowerCase()}-settings-open`)
    }

    const editor = selectors.chatToolTab(page, 'Editor')
    strictEqual(await editor.getAttribute('aria-pressed'), 'true')
    await editor.click()
    await selectors.settingsSearch(page).waitFor({ state: 'hidden' })
    strictEqual(await editor.getAttribute('aria-pressed'), 'false')
    await checkRail(page, 'Chat')
    await step('chat-tools-collapsed')
    await selectors.sidebarSettingsButton(page, 'Chat').click()
    await selectors.settingsSearch(page).waitFor()
    strictEqual(await editor.getAttribute('aria-pressed'), 'true')
    await step('chat-settings-reopened')
  },
}
