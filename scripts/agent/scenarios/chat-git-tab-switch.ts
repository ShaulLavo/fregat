import { strictEqual } from 'node:assert/strict'
import { openFileByName, selectors } from '../selectors'
import type { Scenario } from './index'

export const chatGitTabSwitch: Scenario = {
  name: 'chat-git-tab-switch',
  description: 'With an editor tab open, Changes/Graph in the chat Git tool must not switch tools.',
  async run(page, { file, step }) {
    await openFileByName(page, file)
    await selectors.workspaceMode(page, 'Chat').click()
    const git = selectors.chatToolTab(page, 'Git')
    await git.waitFor({ timeout: 20_000 })
    if (!(await selectors.gitPanel(page).isVisible())) await git.click()
    await selectors.gitPanel(page).waitFor({ timeout: 15_000 })
    await step('git-tool')

    await selectors.graphButton(page).click()
    await page.waitForTimeout(500)
    await step('after-graph')
    strictEqual(await selectors.gitPanel(page).isVisible(), true, 'Graph must keep the Git tool')

    await selectors.gitChangesTab(page).click()
    await page.waitForTimeout(500)
    await step('after-changes')
    strictEqual(await selectors.gitPanel(page).isVisible(), true, 'Changes must keep the Git tool')
  },
}
