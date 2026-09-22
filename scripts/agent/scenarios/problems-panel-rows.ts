import { ok } from 'node:assert/strict'
import type { Scenario } from './index'
import { focusEditor, openFileByName, selectors } from '../selectors'

const SECOND_FILE = 'use-tree.ts'

export const problemsPanelRows: Scenario = {
  name: 'problems-panel-rows',
  description:
    'Read the populated Problems panel: one section per file holding markers, severity rows with recoverable titles, and no counter tiles.',
  async run(page, { file, step }) {
    await openFileByName(page, file)
    await focusEditor(page)
    await selectors.bottomTab(page, 'Problems').click()
    await step('empty')

    // Typing an unresolvable identifier guarantees the server has something to report;
    // the row asserted below is whichever diagnostic lands first, not necessarily this one.
    await page.keyboard.press('Control+End')
    await page.keyboard.press('Enter')
    await page.keyboard.type('notAnIdentifierAnywhere')
    await selectors.diagnosticsRows(page).first().waitFor({ timeout: 30_000 })
    const rows = await selectors.diagnosticsRows(page).count()
    ok(rows > 0, 'The language server must report at least one diagnostic')
    await step(`rows ${rows}`)

    // The four severity tiles were removed: the row carries its severity, the tab the total.
    const tiles = await page.getByText(/^(Errors|Warnings|Hints)$/).count()
    ok(tiles === 0, `The Problems panel must not render counter tiles; found ${tiles}`)

    const title = await selectors.diagnosticsRows(page).first().getAttribute('title')
    ok(title?.includes(':'), `A diagnostic row must recover its file and line, got "${title}"`)

    // The marker store is keyed by (owner, resource), so a second file's diagnostics join the
    // panel instead of replacing the first's — the active tab no longer scopes it.
    const firstLists = await selectors.diagnosticsList(page).count()
    await openFileByName(page, SECOND_FILE)
    await focusEditor(page)
    await page.keyboard.press('Control+End')
    await page.keyboard.press('Enter')
    await page.keyboard.type('alsoNotAnIdentifier')
    await selectors.bottomTab(page, 'Problems').click()
    await page
      .locator(`[role="listbox"][aria-label="Diagnostics"]`)
      .nth(firstLists)
      .waitFor({ timeout: 30_000 })
    const lists = await selectors.diagnosticsList(page).count()
    ok(lists > firstLists, `A second file must add a section, had ${firstLists}, now ${lists}`)
    await step(`two files ${lists}`)
  },
}
