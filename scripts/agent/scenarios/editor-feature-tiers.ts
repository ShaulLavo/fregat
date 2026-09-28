import { strictEqual } from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Page } from 'playwright'
import {
  createGitFixture,
  fixtureGit,
  openFixtureWorkspace,
  releaseFixture,
  waitForFileContent,
} from '../fixture-workspace'
import { focusEditor, openFileFromTree, selectors } from '../selectors'
import type { Scenario } from './index'

export const editorFeatureTiers: Scenario = {
  name: 'editor-feature-tiers',
  description:
    'Change live size budgets, edit and undo in large file mode, then restore document features.',
  async run(page, { step }) {
    const fixture = await createGitFixture('editor-feature-tiers')
    const content = 'function hello() {\n  return 42\n}\n'
    const diskPath = path.join(fixture, 'tiers.js')
    try {
      await writeFile(diskPath, content)
      await fixtureGit(fixture, ['add', '.'])
      await fixtureGit(fixture, ['commit', '--quiet', '-m', 'fixture'])
      await openFixtureWorkspace(page, fixture)
      await openFileFromTree(page, 'tiers.js')
      await selectors.editorMinimap(page).waitFor()
      strictEqual(await selectors.editorLargeFileNotice(page).count(), 0)
      await step('normal-features')
      await setBudget(page, 'Analysis size limit', '0')
      await selectors.editorGroupTabs(page, 0).filter({ hasText: 'tiers.js' }).click()
      await selectors.editorLargeFileNotice(page).waitFor()
      await selectors.editorMinimap(page).waitFor()
      await step('analysis-paused')
      await setBudget(page, 'Minimap size limit', '0')
      await selectors.editorGroupTabs(page, 0).filter({ hasText: 'tiers.js' }).click()
      await selectors.editorMinimap(page).waitFor({ state: 'detached' })
      await focusEditor(page)
      await page.keyboard.press('Control+Home')
      await page.keyboard.type('x')
      await page.keyboard.press('Control+z')
      await page.keyboard.press('Control+Home')
      await page.keyboard.type('// saved\n')
      await page.keyboard.press('Control+s')
      await waitForFileContent(diskPath, '// saved\n' + content)
      await step('plaintext-edit-and-save')
      await setBudget(page, 'Analysis size limit', '1')
      await setBudget(page, 'Minimap size limit', '1', true)
      await selectors.editorGroupTabs(page, 0).filter({ hasText: 'tiers.js' }).click()
      await selectors.editorLargeFileNotice(page).waitFor({ state: 'detached' })
      await selectors.editorMinimap(page).waitFor()
      await step('features-restored')
    } finally {
      await releaseFixture(fixture)
    }
  },
}

async function setBudget(page: Page, title: string, value: string, settingsOpen = false) {
  if (!settingsOpen) await page.keyboard.press('Control+,')
  await selectors.settingsSearch(page).fill(title)
  const field = selectors.settingsNumber(page, title)
  await field.fill(value)
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith('/settings/write') && response.request().method() === 'POST',
  )
  await field.press('Tab')
  strictEqual((await saved).status(), 200)
}
