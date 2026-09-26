import type { Scenario } from './index'
import type { Page } from 'playwright'
import {
  createModifiedFileFixture,
  openFixtureWorkspace,
  releaseFixture,
} from '../fixture-workspace'
import { openGitPanel, selectors } from '../selectors'
import { createScriptError } from '../../structured-errors'

const body = (call: string) => ['function f() {', '  if (a) {', `    ${call}`, '  }', '}']

export const gitDiffFold: Scenario = {
  name: 'git-diff-fold',
  description:
    'Focus a diff whose change sits inside an indented block and press Fold all (Ctrl+K Ctrl+0): the deleted and added rows must stay on screen, because a diff offers no fold regions.',
  async run(page, { step }) {
    const fixture = await createModifiedFileFixture(
      'diff-fold',
      'a.ts',
      body('before()'),
      body('after()'),
    )
    try {
      await openFixtureWorkspace(page, fixture)
      await openGitPanel(page)
      await selectors.worktreeFiles(page).first().click()
      await changedRow(page, 'after()').waitFor({ timeout: 15_000 })

      await changedRow(page, 'function f() {').click()
      await step('before-fold')
      await page.keyboard.press('ControlOrMeta+K')
      await page.keyboard.press('ControlOrMeta+0')
      await page.waitForTimeout(400)
      await step('after-fold')

      for (const text of ['before()', 'after()']) {
        if (await changedRow(page, text).isVisible()) continue
        throw createScriptError(`Fold all hid the diff row ${JSON.stringify(text)}`)
      }
    } finally {
      await releaseFixture(fixture)
    }
  },
}

function changedRow(page: Page, text: string) {
  return selectors.diffRows(page).filter({ hasText: text }).first()
}
