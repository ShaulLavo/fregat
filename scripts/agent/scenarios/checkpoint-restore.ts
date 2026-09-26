import { ok } from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from 'playwright'

import { createGitFixture, fixtureGit, releaseFixture } from '../fixture-workspace'
import { holdToConfirm, selectors } from '../selectors'
import { isolatedNativeScenario } from './native-provider-verification'

// A restore settles in well under a screenshot, so the page records what it showed while pending.
const watchRestore = `(() => {
  const seen = { target: false, restoring: false, receding: 0, otherActions: 0 }
  window.__agentRestore = seen
  const sample = () => {
    const target = document.querySelector('[data-restore-role="target"]')
    if (target) seen.target = true
    if (target?.querySelector('[role="status"]')?.textContent?.includes('Restoring')) seen.restoring = true
    seen.receding = Math.max(seen.receding, document.querySelectorAll('[data-restore-role="receding"]').length)
    const others = document.querySelectorAll('[data-restore-role="other"] [aria-label="Revert to checkpoint before this turn"]')
    seen.otherActions = Math.max(seen.otherActions, others.length)
  }
  new MutationObserver(sample).observe(document.body, { subtree: true, childList: true, attributes: true })
})()`

async function sendTurn(page: Page, text: string, index: number) {
  await selectors.chatMessage(page).fill(text)
  await selectors.chatSend(page).click()
  await selectors.chatMessages(page).getByText('CHECKPOINT_TURN_DONE').nth(index).waitFor()
}

export const checkpointRestore = isolatedNativeScenario({
  name: 'checkpoint-restore',
  description:
    'Rewind a native fixture conversation to its first turn: the dialog closes on the held confirm, and while the rewind runs that turn shows a live dot and "Restoring…", later turns recede and no other turn offers a revert.',
  fixture: new URL('../fixtures/native-checkpoint.mjs', import.meta.url),
  prepareWorktree: async () => {
    const fixture = await createGitFixture('checkpoint-restore')
    await fixtureGit(fixture, ['commit', '--quiet', '-m', 'fixture'])
    return { path: fixture, release: () => releaseFixture(fixture) }
  },
  async drive(page, { root, step, worktreePath }) {
    await writeFile(
      join(root, 'checkpoint-control.json'),
      JSON.stringify({ cwd: worktreePath, hold: false, turns: [], revertDelayMs: 2_000 }),
    )
    await sendTurn(page, 'First turn.', 0)
    await sendTurn(page, 'Second turn.', 1)
    await step('two-turns')
    await page.evaluate(watchRestore)
    await selectors.chatRewind(page).first().click({ force: true })
    await selectors.rewindDialog(page).waitFor()
    await holdToConfirm(page, selectors.rewindConversation(page), () =>
      page.locator('[data-restore-role="target"] [role="status"]').waitFor({ timeout: 20_000 }),
    )
    await selectors.rewindDialog(page).waitFor({ state: 'hidden' })
    await step('restoring')
    await selectors.chatMessages(page).getByText('Second turn.').waitFor({ state: 'detached' })
    const seen = await page.evaluate<{
      target: boolean
      restoring: boolean
      receding: number
      otherActions: number
    }>('window.__agentRestore')
    ok(
      seen.target && seen.restoring,
      `The target turn showed it was restoring: ${JSON.stringify(seen)}`,
    )
    ok(seen.receding > 0, `Later turns receded: ${JSON.stringify(seen)}`)
    ok(seen.otherActions === 0, `No other turn offered a revert: ${JSON.stringify(seen)}`)
    await step('restored')
  },
})
