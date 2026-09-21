import { rm } from 'node:fs/promises'

import type { Scenario } from './index'
import type { Page } from 'playwright'
import { createGitFixture, fixtureHeadSubject, openFixtureWorkspace } from '../fixture-workspace'
import { focusEditor, openGitPanel, selectors } from '../selectors'
import { createScriptError } from '../../structured-errors'

const SUBJECT = 'feat: written in the message file'

export const gitCommitMessageFile: Scenario = {
  name: 'git-commit-message-file',
  description:
    'Open COMMIT_EDITMSG from an empty commit, discard it once, then accept it from the editor title.',
  async run(page, { step }) {
    const fixture = await createGitFixture('commit-editmsg')
    try {
      await openFixtureWorkspace(page, fixture)
      await openGitPanel(page)

      // Discard: the tab closes and nothing is committed.
      await openMessageFile(page)
      await page.keyboard.type('never committed')
      await selectors.editorTitleAction(page, 'Discard commit message').click()
      await selectors.editorInput(page).first().waitFor({ state: 'detached', timeout: 10_000 })
      await Bun.sleep(1000)
      if ((await fixtureHeadSubject(fixture)) !== '')
        throw createScriptError('Discarding the commit message committed anyway')
      await step('discarded')

      // Accept: saves, closes and commits in one press.
      await openMessageFile(page)
      await page.keyboard.type(SUBJECT)
      await step('message-file-open')
      await selectors.editorTitleAction(page, 'Accept commit message').click()
      await waitForHeadSubject(fixture)
      await step('committed')
    } finally {
      await rm(fixture, { force: true, recursive: true })
    }
  },
}

async function openMessageFile(page: Page) {
  await selectors.commitMessage(page).fill('')
  await selectors.commitButton(page).click()
  await selectors.editorInput(page).first().waitFor({ timeout: 15_000 })
  await focusEditor(page)
  await page.keyboard.press('Control+Home')
}

async function waitForHeadSubject(fixture: string) {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    if ((await fixtureHeadSubject(fixture)) === SUBJECT) return
    await Bun.sleep(150)
  }
  throw createScriptError(
    `Closing the tab did not commit: HEAD is "${await fixtureHeadSubject(fixture)}"`,
  )
}
