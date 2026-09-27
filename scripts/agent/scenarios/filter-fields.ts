import { strictEqual, ok } from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { committedFixture, fixtureGit, openFixtureWorkspace } from '../fixture-workspace'
import { openGitPanel, selectors } from '../selectors'
import { treeRow } from '../tree-parity/states'
import type { Scenario } from './index'

export const filterFields: Scenario = {
  name: 'filter-fields',
  description:
    'Filter files and commit history with typing, IME keys, clear buttons, Escape and ArrowDown.',
  async run(page, { step }) {
    const fixture = await committedFixture('filter-fields')
    try {
      await mkdir(path.join(fixture.path, 'docs'))
      await writeFile(path.join(fixture.path, 'docs', 'notes.txt'), 'notes\n')
      await fixtureGit(fixture.path, ['add', '.'])
      await fixtureGit(fixture.path, ['commit', '--quiet', '-m', 'Add notes'])
      await openFixtureWorkspace(page, fixture.path)
      await treeRow(page, 'docs/').click()
      await treeRow(page, 'docs/notes.txt').waitFor()
      await treeRow(page, 'a.txt').focus()
      await page.keyboard.type('notes')
      const filter = selectors.treeFilterInput(page)
      strictEqual(await filter.inputValue(), 'notes')
      const heights = await filter.evaluate((node) => ({
        input: node.getBoundingClientRect().height,
        group: node.closest('[data-slot="input-group"]')!.getBoundingClientRect().height,
      }))
      strictEqual(heights.input, heights.group - 2)
      await treeRow(page, 'docs/notes.txt').waitFor()
      await step('tree-filter-match')
      await filter.dispatchEvent('keydown', { key: 'Escape', isComposing: true })
      strictEqual(await filter.inputValue(), 'notes')
      await filter.press('ArrowDown')
      ok(await treeRow(page, 'docs/notes.txt').evaluate((node) => node === document.activeElement))
      strictEqual(await filter.inputValue(), 'notes')
      await filter.fill('zzzz-no-match')
      await treeRow(page, 'docs/notes.txt').waitFor({ state: 'hidden' })
      strictEqual(await treeRow(page, 'docs/').getAttribute('aria-expanded'), 'false')
      await step('tree-filter-empty')
      await filter.press('Escape')
      strictEqual(await filter.inputValue(), '')
      await treeRow(page, 'docs/notes.txt').waitFor()
      await filter.press('Escape')
      ok(await filter.evaluate((node) => node !== document.activeElement))
      await filter.fill('notes')
      await selectors.treeFilterClear(page).click()
      strictEqual(await filter.inputValue(), '')
      ok(await filter.evaluate((node) => node === document.activeElement))
      await step('tree-filter-cleared')

      const tabsBefore = await selectors.editorTabs(page).count()
      for (const key of ['Enter', 'Space']) {
        await filter.fill('notes')
        await filter.press('Tab')
        ok(
          await selectors.treeFilterClear(page).evaluate((node) => node === document.activeElement),
        )
        await page.keyboard.press(key)
        strictEqual(await filter.inputValue(), '')
        ok(await filter.evaluate((node) => node === document.activeElement))
        strictEqual(await selectors.editorTabs(page).count(), tabsBefore)
        await step(`tree-filter-cleared-${key.toLowerCase()}`)
      }

      await openGitPanel(page)
      await selectors.graphButton(page).click()
      await selectors.historyRows(page).nth(1).waitFor()
      const search = selectors.historySearch(page)
      const searched = page.waitForResponse(
        (response) =>
          response.url().endsWith('/git/history') &&
          response.request().postDataJSON()?.search === 'Add notes',
      )
      await search.fill('Add notes')
      await searched
      await selectors.historyRows(page).nth(1).waitFor({ state: 'hidden' })
      await step('history-filter-match')
      await search.press('ArrowDown')
      ok(await selectors.historyList(page).evaluate((node) => node === document.activeElement))
      strictEqual(await search.inputValue(), 'Add notes')
      await search.focus()
      await search.press('Escape')
      strictEqual(await search.inputValue(), '')
      await search.press('Escape')
      ok(await search.evaluate((node) => node !== document.activeElement))
      await search.fill('fixture')
      await selectors.historyClearSearch(page).click()
      strictEqual(await search.inputValue(), '')
      await selectors.historyRows(page).nth(1).waitFor()
      await step('history-filter-cleared')
    } finally {
      await fixture.release()
    }
  },
}
