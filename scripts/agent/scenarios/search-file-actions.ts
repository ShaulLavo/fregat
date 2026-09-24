import { ok, strictEqual } from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Page } from 'playwright'

import type { Scenario } from './index'
import { expectClipboard } from '../clipboard'
import {
  createGitFixture,
  fixtureGit,
  openFixtureWorkspace,
  releaseFixture,
} from '../fixture-workspace'
import { searchEditorSelector, selectors } from '../selectors'

const RELATIVE = 'src/deep/app.ts'

async function createFixture() {
  const fixture = await createGitFixture('search-file-actions')
  await mkdir(join(fixture, 'src/deep'), { recursive: true })
  await writeFile(join(fixture, RELATIVE), 'const a = 1\nconst b = 2\nconst needle = 3\n')
  await fixtureGit(fixture, ['add', '--all'])
  await fixtureGit(fixture, ['commit', '--quiet', '-m', 'fixture'])
  return fixture
}

async function menuLabels(page: Page) {
  await page.getByRole('menuitem').first().waitFor()
  return page.getByRole('menuitem').allTextContents()
}

export const searchFileActions: Scenario = {
  name: 'search-file-actions',
  description:
    'Search rows in a disposable workspace offer Open Match, Open File and the copy-path pair by right-click and Shift+F10, in the sidebar and the search editor, without opening or toggling the row.',
  async run(page, { step }) {
    const fixture = await createFixture()
    try {
      await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
      await openFixtureWorkspace(page, fixture)

      // Files is the reference: Search must copy the same relative path.
      // The tree compacts src/deep into one row; expanding it reveals the file.
      const file = selectors.treeItem(page, 'app.ts')
      if (!(await file.isVisible()))
        await selectors.folderTree(page).getByRole('treeitem').first().click()
      await file.click({ button: 'right' })
      await selectors.menuItem(page, 'Copy Relative Path').click()
      await expectClipboard(page, RELATIVE, 'Files copies the relative path')

      await selectors.sidebarTab(page, 'Search').click()
      await selectors.workspaceSearch(page).fill('needle')
      const tree = selectors.searchResultTree(page)
      const group = tree.getByRole('treeitem').filter({ hasText: 'app.ts' }).first()
      await group.waitFor({ timeout: 20_000 })
      const expanded = await group.getAttribute('aria-expanded')

      await page.evaluate(() => navigator.clipboard.writeText(''))
      await group.click({ button: 'right' })
      strictEqual(
        JSON.stringify(await menuLabels(page)),
        JSON.stringify(['Open File', 'Copy Path', 'Copy Relative Path']),
      )
      await step('file-heading-menu')
      await selectors.menuItem(page, 'Copy Relative Path').click()
      await expectClipboard(page, RELATIVE, 'Search copies the same relative path as Files')
      strictEqual(await group.getAttribute('aria-expanded'), expanded, 'The menu never toggles')

      const match = tree.getByRole('treeitem').filter({ hasText: 'needle' }).first()
      await match.click({ button: 'right' })
      ok((await menuLabels(page)).includes('Open Match'), 'A match row offers Open Match')
      await step('match-menu')
      await selectors.menuItem(page, 'Open Match').click()
      await selectors
        .editorTabNamed(page, /app\.ts/)
        .first()
        .waitFor({ timeout: 15_000 })
      await step('opened-match')

      await tree.focus()
      await page.keyboard.press('Home')
      const active = await tree.getAttribute('aria-activedescendant')
      await page.keyboard.press('Shift+F10')
      await page.getByRole('menuitem', { name: 'Open File' }).waitFor()
      await step('keyboard-menu')
      await page.keyboard.press('Escape')
      await page.getByRole('menuitem').first().waitFor({ state: 'hidden' })
      strictEqual(await tree.getAttribute('aria-activedescendant'), active, 'Cursor stays put')
      strictEqual(
        await tree.evaluate((element) => element === element.ownerDocument.activeElement),
        true,
        'Escape returns focus to the results tree',
      )

      await selectors.openSearchEditor(page).click()
      const header = page.locator(searchEditorSelector).getByRole('treeitem', { level: 1 }).first()
      await header.waitFor({ timeout: 20_000 })
      await header.click({ button: 'right' })
      strictEqual(
        JSON.stringify(await menuLabels(page)),
        JSON.stringify(['Open File', 'Copy Path', 'Copy Relative Path']),
      )
      await step('editor-heading-menu')
      await page.keyboard.press('Escape')
      await page.locator(searchEditorSelector).focus()
      await page.keyboard.press('Shift+F10')
      await page.getByRole('menuitem', { name: 'Open File' }).waitFor()
      await step('editor-keyboard-menu')
      await page.keyboard.press('Escape')
    } finally {
      await releaseFixture(fixture)
    }
  },
}
