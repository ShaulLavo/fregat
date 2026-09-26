import { ok } from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'

import { fixtureGit } from '../fixture-workspace'
import { selectors } from '../selectors'
import { draftFixture } from './draft-sessions'
import { isolatedNativeScenario, nativeLog, sendPrompt } from './native-provider-verification'

const LINES = Array.from(
  { length: 12 },
  (_, index) => `export const value${index + 1} = ${index + 1}`,
)
const CHANGED_LINE = 6
const GONE = ['keep one', 'drop two', 'keep three']

/**
 * Plan 126 INTERACTION-09: a comment on diff lines goes out as a review comment, its chip opens
 * the file at those lines, and once the lines change the chip says so instead of opening others.
 */
export const chatReviewContext = isolatedNativeScenario({
  name: 'chat-review-context',
  description:
    'Comment on a changed line in the session’s diff and send it: the provider gets the quoted lines and comment, the sent message shows a chip, the chip opens the file, and after the line changes on disk the chip reports the change. A comment on a deleted line opens that file’s diff.',
  fixture: new URL('../fixtures/native-codex.mjs', import.meta.url),
  prepareWorktree: () => draftFixture('review-context'),
  async drive(page, { root, step, worktreePath }) {
    const file = path.join(worktreePath, 'values.ts')
    const gone = path.join(worktreePath, 'gone.ts')
    await writeFile(file, `${LINES.join('\n')}\n`)
    await writeFile(gone, `${GONE.join('\n')}\n`)
    await fixtureGit(worktreePath, ['add', 'values.ts', 'gone.ts'])
    await fixtureGit(worktreePath, ['commit', '--quiet', '-m', 'values'])
    const changed = LINES.with(CHANGED_LINE - 1, 'export const value6 = 60')
    await writeFile(file, `${changed.join('\n')}\n`)
    await writeFile(gone, `${GONE.toSpliced(1, 1).join('\n')}\n`)

    await selectors.worktreeFiles(page).filter({ hasText: 'values.ts' }).first().click({
      timeout: 30_000,
    })
    const row = selectors.diffRows(page).filter({ hasText: 'value6 = 60' }).first()
    await row.hover({ position: { x: 40, y: 8 } })
    await page.mouse.down()
    await page.mouse.up()
    await page.getByRole('button', { name: 'Comment', exact: true }).click()
    await page.getByRole('textbox', { name: 'Review comment', exact: true }).fill('Why sixty?')
    await page.keyboard.press('Enter')
    const review = page.getByRole('group', { name: 'Review comments', exact: true })
    await review.getByText(`values.ts:${CHANGED_LINE}`).waitFor({ timeout: 10_000 })
    await step('diff-comment-in-composer')

    await sendPrompt(page, 'Please look.')
    const messages = selectors.chatMessages(page)
    await messages.getByText('CONTEXT_REPLY 1', { exact: true }).waitFor({ timeout: 30_000 })
    const sent = String(
      (await nativeLog(root)).filter((entry) => entry.event === 'turn/start').at(-1)?.input ?? '',
    )
    ok(
      sent.includes('<review_comments>') && sent.includes('Why sixty?'),
      'The comment reached the provider',
    )
    ok(sent.includes('+export const value6 = 60'), 'Its quoted diff line reached the provider')
    const chip = messages.getByRole('button', { name: `Open values.ts:${CHANGED_LINE}` })
    await chip.waitFor()
    await step('sent-with-a-chip')

    await chip.click()
    await page.locator('[data-editor-tab-path$="values.ts"]').first().waitFor({ timeout: 15_000 })
    await step('chip-opens-the-file')

    await writeFile(
      file,
      `${LINES.with(CHANGED_LINE - 1, 'export const value6 = 600').join('\n')}\n`,
    )
    await chip.click()
    await page.getByText('Those lines have changed since this comment was sent').waitFor({
      timeout: 10_000,
    })
    await step('changed-lines-reported')

    // A deleted line exists only in the version it was deleted from: its chip opens the diff.
    await selectors.toolTab(page, 'Git').click()
    await selectors.worktreeFiles(page).filter({ hasText: 'gone.ts' }).first().click()
    const deleted = selectors.diffRows(page).filter({ hasText: 'drop two' }).first()
    await deleted.hover({ position: { x: 40, y: 8 } })
    await page.mouse.down()
    await page.mouse.up()
    await page.getByRole('button', { name: 'Comment', exact: true }).click()
    await page.getByRole('textbox', { name: 'Review comment', exact: true }).fill('Why drop it?')
    await page.keyboard.press('Enter')
    await review.getByText('gone.ts:2').waitFor({ timeout: 10_000 })
    await sendPrompt(page, 'And this.')
    await messages.getByText('CONTEXT_REPLY 2', { exact: true }).waitFor({ timeout: 30_000 })
    const deletedChip = messages.getByRole('button', { name: 'Open gone.ts:2' })
    await deletedChip.waitFor()
    const diffTab = page
      .locator('[data-editor-tab-key]')
      .filter({ hasText: 'gone.ts' })
      .and(page.locator('[data-editor-tab-key*="git-diff"]'))
    await diffTab.first().click({ button: 'right' })
    await selectors.menuItem(page, 'Close').click()
    await diffTab.first().waitFor({ state: 'detached' })
    await deletedChip.click()
    await diffTab.first().waitFor({ timeout: 15_000 })
    await step('deleted-line-opens-its-diff')
  },
})
