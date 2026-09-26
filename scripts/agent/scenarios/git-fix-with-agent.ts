import { writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { Scenario } from './index'
import {
  createGitFixture,
  fixtureGit,
  installPreCommitHook,
  openFixtureWorkspace,
  releaseFixture,
} from '../fixture-workspace'
import { openGitPanel, selectors } from '../selectors'
import { createScriptError } from '../../structured-errors'

// The initial attempt fails; an external commit later resolves it.
const HOOK = ['#!/bin/sh', 'echo "lint failed on src/app.ts" >&2', 'exit 1', ''].join('\n')

const EXISTING_DRAFT = 'a question I was already writing'

export const gitFixWithAgent: Scenario = {
  name: 'git-fix-with-agent',
  description:
    'Fail a commit on a rejecting hook, press Fix with AI, and find the failure alone in a new chat.',
  async run(page, { step }) {
    const fixture = await createGitFixture('fix-with-agent')
    try {
      // Chat needs a root commit to identify the repository.
      await fixtureGit(fixture, ['commit', '--quiet', '-m', 'initial'])
      await writeFile(path.join(fixture, 'a.txt'), 'two\n')
      await fixtureGit(fixture, ['add', 'a.txt'])
      await installPreCommitHook(fixture, HOOK)

      await openFixtureWorkspace(page, fixture)
      // Something already in the open chat: the hand-off must not land beside it.
      await selectors.sidebarTab(page, 'Chat').click()
      await selectors.chatMessage(page).waitFor({ timeout: 20_000 })
      await selectors.chatMessage(page).click()
      await page.keyboard.type(EXISTING_DRAFT)
      await openGitPanel(page)
      await selectors.commitMessage(page).fill('rejected by the hook')
      await selectors.commitButton(page).click()
      await selectors.gitFixWithAgent(page).waitFor({ timeout: 15_000 })
      await step('failure-notice')

      await selectors.gitFixWithAgent(page).click()
      const composer = selectors.chatMessage(page)
      await composer.waitFor({ timeout: 15_000 })
      await page.waitForFunction(
        (element) => element?.textContent?.includes('lint failed on src/app.ts'),
        await composer.elementHandle(),
        { timeout: 10_000 },
      )
      await step('composer')

      const text = (await composer.textContent()) ?? ''
      if (!text.includes('Git commit failed'))
        throw createScriptError('The composer did not name the failed step')
      if (text.includes(EXISTING_DRAFT))
        throw createScriptError('Fix with AI reused the open chat instead of starting a new one')
      await selectors.fillChatMessage(page, '')

      await openGitPanel(page)
      await writeFile(path.join(fixture, 'a.txt'), 'fixed\n')
      await selectors.commitOutput(page).waitFor({ timeout: 10_000 })
      await step('failure-before-external-commit')
      await installPreCommitHook(fixture, '#!/bin/sh\nexit 0\n')
      await fixtureGit(fixture, ['add', 'a.txt'])
      await fixtureGit(fixture, ['commit', '--quiet', '-m', 'fixed externally'])
      await selectors.commitOutput(page).waitFor({ state: 'hidden', timeout: 15_000 })
      if (await selectors.gitFixWithAgent(page).isVisible())
        throw createScriptError('The resolved commit still offers Fix with AI')
      await step('external-commit-cleared-failure')
    } finally {
      await releaseFixture(fixture)
    }
  },
}
