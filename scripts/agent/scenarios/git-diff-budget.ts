import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  createGitFixture,
  fixtureGit,
  openFixtureWorkspace,
  releaseFixture,
} from '../fixture-workspace'
import { openGitPanel } from '../selectors'
import { strictEqual } from 'node:assert/strict'
import { selectors } from '../selectors'
import type { Scenario } from './index'

export const gitDiffBudget: Scenario = {
  name: 'git-diff-budget',
  description: 'The machine Git size budget defaults to 50 MiB and persists a new value.',
  async run(page, { step }) {
    await page.keyboard.press('Control+,')
    await selectors.settingsSearch(page).fill('Diff file size limit')
    const field = selectors.settingsNumber(page, 'Diff file size limit')
    await field.waitFor()
    strictEqual(await field.inputValue(), '50')
    await step('default-budget')
    await field.fill('1')
    const saved = page.waitForResponse(
      (response) =>
        response.url().endsWith('/settings/write') && response.request().method() === 'POST',
    )
    await field.press('Tab')
    strictEqual((await saved).status(), 200)
    await page.reload()
    await selectors.settingsSearch(page).fill('Diff file size limit')
    await field.waitFor()
    strictEqual(await field.inputValue(), '1')
    await step('saved-budget')
    const fixture = await createGitFixture('diff-size-limit')
    try {
      await fixtureGit(fixture, ['commit', '--quiet', '-m', 'initial'])
      await writeFile(
        path.join(fixture, 'large.txt'),
        'large original\n' + ('x'.repeat(100) + '\n').repeat(11000),
      )
      await openFixtureWorkspace(page, fixture)
      await openGitPanel(page)
      await selectors.gitChangeRow(page, 'large.txt').dblclick()
      await selectors.gitSizeLimitNotice(page).waitFor()
      strictEqual(await selectors.fixWithAi(page).count(), 0)
      await step('oversized-untracked-file')
      await writeFile(path.join(fixture, 'large.txt'), 'later disk version\n')
      await page.keyboard.press('Control+,')
      await selectors.settingsSearch(page).fill('Diff file size limit')
      await field.fill('2')
      const raised = page.waitForResponse(
        (response) =>
          response.url().endsWith('/settings/write') && response.request().method() === 'POST',
      )
      await field.press('Tab')
      strictEqual((await raised).status(), 200)
      await selectors.editorGroupTabs(page, 0).filter({ hasText: 'large.txt' }).click()
      await selectors.diffRows(page).filter({ hasText: 'large original' }).waitFor()
      strictEqual(await selectors.gitSizeLimitNotice(page).count(), 0)
      await step('raised-budget-pinned-snapshot')
    } finally {
      await releaseFixture(fixture)
    }
  },
}
