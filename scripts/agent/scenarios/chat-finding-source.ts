import { rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { committedFixture } from '../fixture-workspace'
import { selectors } from '../selectors'
import { isolatedNativeScenario } from './native-provider-verification'

/**
 * Plan 126 INTERACTION-09: a reviewer's finding, sent as a review comment, leads back to the
 * lines it cites, and says so once those lines change or their file is gone.
 */
export const chatFindingSource = isolatedNativeScenario({
  name: 'chat-finding-source',
  description:
    'A fixture reviewer finds a problem on a.txt lines 1–2; sent, the finding’s chip opens a.txt, then reports the lines changed, then the file gone.',
  fixture: new URL('../fixtures/native-codex.ts', import.meta.url),
  prepareWorktree: () => committedFixture('finding-source'),
  async drive(page, { step, worktreePath }) {
    const file = path.join(worktreePath, 'a.txt')
    await writeFile(file, 'one\ntwo\n')

    await selectors.reviewChanges(page).click()
    await page.getByRole('combobox', { name: 'Changes to review' }).click()
    await page.getByRole('option', { name: 'Uncommitted changes' }).click()
    await page.getByRole('button', { name: 'Start review' }).click()
    const draft = selectors.reviewComments(page)
    await draft.getByText('Lost value: The second line drops the first value.').waitFor({
      timeout: 30_000,
    })
    await draft.getByText('a.txt:1–2').waitFor()
    await step('finding-in-draft')
    const summary = selectors.toast(page, '1 finding added to your review')
    await summary.getByRole('button', { name: 'Close toast' }).click()
    await summary.waitFor({ state: 'detached' })

    await selectors.chatMessage(page).fill('Please fix it.')
    await selectors.chatSend(page).click()
    const chip = selectors.chatMessages(page).getByRole('button', { name: 'Open a.txt:1–2' })
    await chip.waitFor({ timeout: 30_000 })
    await chip.click()
    await page.locator('[data-editor-tab-path$="a.txt"]').first().waitFor({ timeout: 15_000 })
    await step('finding-chip-opens-the-file')

    await writeFile(file, 'one\nTWO\n')
    await chip.click()
    const changed = selectors.toast(page, 'Those lines have changed since this comment was sent')
    await changed.waitFor({ timeout: 10_000 })
    await step('finding-chip-reports-changed-lines')
    await changed.getByRole('button', { name: 'Close toast' }).click()
    await changed.waitFor({ state: 'detached' })

    await rm(file)
    await chip.click()
    await selectors.toast(page, 'The commented source is no longer available').waitFor({
      timeout: 10_000,
    })
    await step('finding-chip-reports-the-file-gone')
  },
})
