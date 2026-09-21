import { ok } from 'node:assert/strict'
import { selectors } from '../selectors'
import type { Page } from 'playwright'
import type { Scenario } from './index'

export const chatGitTurnRows: Scenario = {
  name: 'chat-git-turn-rows',
  description: 'Working tree and Turn scopes of the chat Git tool draw the same file row.',
  async run(page, { step }) {
    await selectors.workspaceMode(page, 'Chat').click()
    const git = selectors.chatToolTab(page, 'Git')
    await git.waitFor({ timeout: 20_000 })
    if (!(await selectors.gitPanel(page).isVisible())) await git.click()
    await selectors.worktreeFiles(page).first().waitFor({ timeout: 15_000 })
    await step('working-tree')

    const rows = selectors.turnFiles(page).getByRole('option')
    ok(await openSessionWithTurnFiles(page), 'No session in the rail has a checkpointed turn')
    await step('turn')
    ok((await rows.first().getAttribute('title'))?.includes(' · '), 'Turn rows carry a status')
  },
}

const SESSION_SCAN_LIMIT = 12

async function openSessionWithTurnFiles(page: Page) {
  const sessions = selectors.sessionRows(page)
  const count = Math.min(await sessions.count(), SESSION_SCAN_LIMIT)

  for (let index = 0; index < count; index += 1) {
    await sessions.nth(index).click()
    if (await showsTurnFiles(page)) return true
  }

  return false
}

async function showsTurnFiles(page: Page) {
  const turn = selectors.gitDiffScope(page, 'Turn')
  await turn.waitFor({ timeout: 5_000 })
  if (!(await turn.isEnabled())) return false

  await turn.click()
  const row = selectors.turnFiles(page).getByRole('option').first()
  return row
    .waitFor({ timeout: 2_000 })
    .then(() => true)
    .catch(() => false)
}
