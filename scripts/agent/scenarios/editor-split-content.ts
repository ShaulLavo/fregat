import { openFixtureWorkspace, fixtureGit } from '../fixture-workspace'
import { selectedEditorTabId as selectedTabId } from '../selectors'
import { deepStrictEqual, ok, strictEqual } from 'node:assert'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Page } from 'playwright'
import { openFileByName, runPaletteCommand, selectors, waitForApp } from '../selectors'
import type { Scenario } from './index'

const inspection = new WeakMap<Page, { fixture: string; phases: string[]; diskChanged: boolean }>()
const sample = '# Split content fixture\n\nA committed file for editor tab verification.\n'

export const editorSplitContent: Scenario = {
  name: 'editor-split-content',
  description:
    'Move singleton tools and split read-only references, empty comparisons, and history or comparison diffs.',
  async run(page, { step }) {
    const originalUrl = page.url()
    const fixture = await mkdtemp('/work/tmp/fregat-split-content-')
    const result = { fixture, phases: [] as string[], diskChanged: false }
    inspection.set(page, result)
    try {
      await writeFile(path.join(fixture, 'README.md'), sample)
      await fixtureGit(fixture, ['init', '--quiet'])
      await fixtureGit(fixture, ['add', 'README.md'])
      await fixtureGit(fixture, [
        '-c',
        'user.name=Split verification',
        '-c',
        'user.email=split@example.invalid',
        'commit',
        '--quiet',
        '-m',
        'Split content fixture',
      ])
      await openFixtureWorkspace(page, fixture)
      await openFileByName(page, 'README.md')
      await splitDownOrRight(page, 0, 'Split Right')
      await selectors.editorGroups(page).nth(1).waitFor()

      await page.keyboard.press('Control+,')
      await selectors.settingsSearch(page).waitFor()
      const settingsId = await selectedTabId(page, 1)
      await assertSingletonAndMove(page, 1, 1)
      strictEqual(await selectedTabId(page, 0), settingsId)
      await assertFocused(page, 0)
      result.phases.push('settings-moved-singleton')
      await step('settings-moved-singleton')

      await runPaletteCommand(page, 'Open Search Editor')
      await selectors.workspaceSearch(page).waitFor()
      const searchId = await selectedTabId(page, 0)
      await assertSingletonAndMove(page, 0, 2)
      strictEqual(await selectedTabId(page, 1), searchId)
      await assertFocused(page, 1)
      result.phases.push('search-moved-singleton')
      await step('search-moved-singleton')

      await selectors.editorGroupTabs(page, 1).first().click()
      await runPaletteCommand(page, 'Open file at HEAD')
      await selectors.editorGroupTabs(page, 1).filter({ hasText: '(HEAD)' }).waitFor()
      await selectors.editorGroupInput(page, 1).waitFor()
      await splitDownOrRight(page, 1, 'Split Down')
      await selectors.editorGroupInput(page, 2).waitFor()
      await assertFocused(page, 2)
      const before = await selectors.editorGroupRows(page, 2).allTextContents()
      await step('head-before-readonly')
      await page.keyboard.type('MUST_NOT_EDIT_HEAD')
      deepStrictEqual(await selectors.editorGroupRows(page, 2).allTextContents(), before)
      result.phases.push('head-copied-readonly')
      await step('head-copied-readonly')
      await closeSelected(page, 2)

      await selectors.editorGroupTabs(page, 1).first().click()
      await runPaletteCommand(page, 'Compare with saved')
      await selectors.editorGroupEmptyText(page, 1, 'No unsaved changes.').waitFor()
      await splitDownOrRight(page, 1, 'Split Down')
      await selectors.editorGroupEmptyText(page, 2, 'No unsaved changes.').waitFor()
      await assertFocused(page, 2)
      result.phases.push('empty-comparison-copied-focused')
      await step('empty-comparison-copied-focused')
      await closeSelected(page, 2)

      await selectors.editorGroupTabs(page, 1).first().click()
      await runPaletteCommand(page, 'Show history')
      await selectors.editorGroupHistoryStates(page, 1).waitFor()
      await splitDownOrRight(page, 1, 'Split Down')
      await selectors.editorGroupHistoryStates(page, 2).waitFor()
      await assertFocused(page, 2)
      result.phases.push('current-history-copied-focused')
      await step('current-history-copied-focused')
      await closeSelected(page, 2)

      await selectors.editorGroupTabs(page, 1).first().click()
      await selectors.editorGroupInput(page, 1).focus()
      await page.keyboard.press('Control+End')
      await page.keyboard.insertText('split_content_probe\n')
      await runPaletteCommand(page, 'Show history')
      await selectors.editorGroupHistoryStates(page, 1).getByRole('option').first().click()
      await copyDiffAndCheckFocus(page, 'split_content_probe')
      result.phases.push('history-diff-copy-retains-selection')
      await step('history-diff-copy-retains-selection')
      await closeSelected(page, 2)

      await selectors.editorGroupTabs(page, 1).first().click()
      await runPaletteCommand(page, 'Compare with saved')
      await copyDiffAndCheckFocus(page, 'split_content_probe')
      result.phases.push('saved-comparison-diff-copied-focused')
      await step('saved-comparison-diff-copied-focused')
      result.diskChanged = (await readFile(path.join(fixture, 'README.md'), 'utf8')) !== sample
    } finally {
      await page.goto(originalUrl)
      await waitForApp(page)
      await rm(fixture, { recursive: true, force: true })
    }
  },
  async inspect(page) {
    return inspection.get(page)
  },
}

async function selectedTabMenu(page: Page, group: number) {
  const tabs = selectors.editorGroupTabs(page, group)
  const activeIndex = await tabs.evaluateAll((elements) =>
    elements.findIndex((element) => element.getAttribute('aria-selected') === 'true'),
  )
  ok(activeIndex >= 0, 'group has a selected tab')
  await tabs.nth(activeIndex).click({ button: 'right' })
}

async function splitDownOrRight(page: Page, group: number, action: 'Split Right' | 'Split Down') {
  await selectedTabMenu(page, group)
  await selectors.menuItem(page, action).click()
}

async function closeSelected(page: Page, group: number) {
  await selectedTabMenu(page, group)
  await selectors.menuItem(page, 'Close').click()
  await selectors.editorGroups(page).nth(group).waitFor({ state: 'hidden' })
}

async function assertSingletonAndMove(page: Page, source: number, destinationNumber: number) {
  await selectedTabMenu(page, source)
  strictEqual(await selectors.menuItem(page, 'Split Right').getAttribute('aria-disabled'), 'true')
  strictEqual(await selectors.menuItem(page, 'Split Down').getAttribute('aria-disabled'), 'true')
  await selectors.menuItem(page, 'Move to Group…').click()
  const dialog = selectors.editorGroupDialog(page)
  await dialog.getByRole('button', { name: `Group ${destinationNumber}`, exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
}

async function assertFocused(page: Page, group: number) {
  await page.waitForTimeout(150)
  ok(
    await selectors
      .editorGroups(page)
      .nth(group)
      .evaluate((element) => element.contains(document.activeElement)),
    'selected tab receives focus in its group',
  )
}

async function copyDiffAndCheckFocus(page: Page, text: string) {
  await selectors.editorGroupDiffRows(page, 1).filter({ hasText: text }).first().waitFor()
  await splitDownOrRight(page, 1, 'Split Down')
  await selectors.editorGroupDiffRows(page, 2).filter({ hasText: text }).first().waitFor()
  await assertFocused(page, 2)
}
