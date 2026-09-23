import type { Scenario } from './index'
import { createGitFixture, openFixtureWorkspace, releaseFixture } from '../fixture-workspace'
import { openGitPanel, selectors } from '../selectors'
import { createScriptError } from '../../structured-errors'

const DRAFT = 'fix: a message typed before the reload'

export const gitCommitMessagePersists: Scenario = {
  name: 'git-commit-message-persists',
  description: 'Type a commit message, reload the window, and find the message still there.',
  async run(page, { step }) {
    const fixture = await createGitFixture('commit-draft')
    try {
      await openFixtureWorkspace(page, fixture)
      await openGitPanel(page)
      await selectors.commitMessage(page).fill(DRAFT)
      await step('typed')

      // The Git tab is restored with the workspace, so the panel is already open.
      await page.reload({ waitUntil: 'domcontentloaded' })
      await selectors.commitMessage(page).waitFor({ timeout: 20_000 })
      const restored = await selectors.commitMessage(page).inputValue()
      await step('after-reload')
      if (restored !== DRAFT)
        throw createScriptError(`Reload lost the commit message: found "${restored}"`)

      // Leave no draft behind in the browser profile.
      await selectors.commitMessage(page).fill('')
    } finally {
      await releaseFixture(fixture)
    }
  },
}
