import { openFixtureWorkspace } from '../fixture-workspace'
import { selectedEditorTabId as selectedTabId } from '../selectors'
import { ok, strictEqual } from 'node:assert'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Page } from 'playwright'
import { openFileFromTree, runPaletteCommand, selectors, waitForApp } from '../selectors'
import type { Scenario } from './index'

const barrierText = 'Earlier history is behind a workspace edit.'
const currentText = 'This is the current state.'
const observations = new WeakMap<Page, { phases: string[]; movedTabId: string | null }>()

export const editorSplitHistoryState: Scenario = {
  name: 'editor-split-history-state',
  description:
    'Move a selected history barrier into a group showing another history tab, preserving each tab’s selection.',
  async run(page, { step }) {
    const originalUrl = page.url()
    const fixture = await mkdtemp('/work/tmp/fregat-split-history-')
    const result = { phases: [] as string[], movedTabId: null as string | null }
    observations.set(page, result)
    try {
      await Promise.all([
        writeFile(path.join(fixture, 'a.ts'), 'export const renameMe = 1\n'),
        writeFile(path.join(fixture, 'b.ts'), 'export const renameMe = 2\n'),
      ])
      await openFixtureWorkspace(page, fixture)
      await openFileFromTree(page, 'a.ts')
      await openFileFromTree(page, 'b.ts')
      await selectors.sidebarTab(page, 'Search').click()
      await selectors.workspaceSearch(page).fill('renameMe')
      await selectors.replaceToggle(page).click()
      await selectors.replaceBox(page).fill('renamedValue')
      await selectors.workspaceReplaceAll(page).click()
      await selectors.workspaceEditApplyAll(page).click()
      await selectors.workspaceEditApplyAll(page).waitFor({ state: 'hidden' })
      await selectors.editorGroupRows(page, 0).filter({ hasText: 'renamedValue' }).first().waitFor()
      await step('workspace-edit-created')

      await selectedTabMenu(page, 0)
      await selectors.menuItem(page, 'Split Right').click()
      await selectors.editorGroupInput(page, 1).waitFor()
      await runPaletteCommand(page, 'Show history')
      await selectors.editorGroupEmptyText(page, 1, currentText).waitFor()
      await selectors
        .editorGroupTabs(page, 0)
        .filter({ hasText: /^a\.ts$/ })
        .click()
      await runPaletteCommand(page, 'Show history')
      await selectors
        .editorGroupHistoryStates(page, 0)
        .getByRole('option', { name: /Workspace edit/ })
        .click()
      await selectors.editorGroupEmptyText(page, 0, barrierText).waitFor()
      await selectors.editorGroupEmptyText(page, 1, currentText).waitFor()
      result.movedTabId = await selectedTabId(page, 0)
      result.phases.push('independent-history-selections')
      await step('independent-history-selections')

      await selectedTabMenu(page, 0)
      await selectors.menuItem(page, 'Move to Group…').click()
      await selectors
        .editorGroupDialog(page)
        .getByRole('button', { name: 'Group 2', exact: true })
        .click()
      await selectors.editorGroupDialog(page).waitFor({ state: 'hidden' })
      strictEqual(await selectors.editorGroups(page).count(), 2, 'source group survives the move')
      strictEqual(await selectedTabId(page, 1), result.movedTabId, 'moved history keeps its tab ID')
      await selectors.editorGroupEmptyText(page, 1, barrierText).waitFor({ timeout: 5000 })
      result.phases.push('moved-history-retains-barrier')
      await step('moved-history-retains-barrier')

      await selectors.editorGroupTabs(page, 1).filter({ hasText: 'b.ts (history)' }).click()
      await selectors.editorGroupEmptyText(page, 1, currentText).waitFor()
      await selectors.editorGroupTabs(page, 1).filter({ hasText: 'a.ts (history)' }).click()
      await selectors.editorGroupEmptyText(page, 1, barrierText).waitFor()
      result.phases.push('switching-history-tabs-retains-each-selection')
      await step('switching-history-tabs-retains-each-selection')
      strictEqual(
        await readFile(path.join(fixture, 'a.ts'), 'utf8'),
        'export const renameMe = 1\n',
        'browsing history leaves the dirty workspace edit unsaved',
      )
      strictEqual(
        await readFile(path.join(fixture, 'b.ts'), 'utf8'),
        'export const renameMe = 2\n',
        'browsing history leaves the other dirty file unsaved',
      )
    } finally {
      await page.goto(originalUrl)
      await waitForApp(page)
      await rm(fixture, { recursive: true, force: true })
    }
  },
  async inspect(page) {
    return observations.get(page)
  },
}

async function selectedTabMenu(page: Page, group: number) {
  const tabs = selectors.editorGroupTabs(page, group)
  const index = await tabs.evaluateAll((elements) =>
    elements.findIndex((element) => element.getAttribute('aria-selected') === 'true'),
  )
  ok(index >= 0, 'group has a selected tab')
  await tabs.nth(index).click({ button: 'right' })
}
