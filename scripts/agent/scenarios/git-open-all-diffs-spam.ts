import { strictEqual } from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fixtureGit, openFixtureWorkspace } from '../fixture-workspace'
import { openGitPanel, selectors } from '../selectors'
import type { Scenario } from './index'

const files = ['a.txt', 'b.txt', 'c.txt', 'd.txt', 'e.txt', 'f.txt']

export const gitOpenAllDiffsSpam: Scenario = {
  name: 'git-open-all-diffs-spam',
  description: 'Spam Open all diffs; every diff opens and no error surfaces.',
  async run(page, { step }) {
    const fixture = await mkdtemp('/work/tmp/fregat-git-open-diffs-')
    try {
      await fixtureGit(fixture, ['init', '-b', 'main'])
      for (const file of files) await writeFile(path.join(fixture, file), 'change\n')
      await openFixtureWorkspace(page, fixture)
      await openGitPanel(page)
      await selectors.gitChangeRow(page, files[0]).waitFor()
      await step('panel')

      // The group actions only take the pointer while the header is hovered.
      await selectors.changesToggle(page).hover()
      const openAll = selectors.gitRowAction(page, 'Open all diffs').first()
      for (let click = 0; click < 8; click += 1) await openAll.click({ delay: 0 })
      await page.waitForTimeout(4_000)
      await step('after-spam')

      const errors = await selectors.unexpectedError(page).count()
      const tabs = await selectors.editorTabs(page).count()
      console.log(JSON.stringify({ errors, tabs }))
      strictEqual(errors, 0, 'Spamming Open all diffs must not surface an error')
      strictEqual(tabs, files.length, 'Every change must end up with a diff tab')
    } finally {
      await rm(fixture, { recursive: true, force: true })
    }
  },
}
