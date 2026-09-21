import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { strictEqual } from 'node:assert'

import type { Scenario } from './index'
import { fixtureGit, openFixtureWorkspace } from '../fixture-workspace'
import {
  diffPaneSelector,
  hoverShowedPlainCode,
  hoverTokenColor,
  hoverWord,
  openGitPanel,
  selectors,
  watchHoverPlainCode,
} from '../selectors'

const SAMPLE = 'diffHoverSample'

export const gitDiffHoverTokens: Scenario = {
  name: 'git-diff-hover-tokens',
  description:
    'Hover an identifier inside a diff pane and check its fenced code carries the editor token colours.',
  async run(page, { step }) {
    const fixture = await mkdtemp('/work/tmp/fregat-diff-hover-')
    try {
      await fixtureGit(fixture, ['init', '--quiet'])
      await fixtureGit(fixture, ['config', 'user.email', 'fregat@example.com'])
      await fixtureGit(fixture, ['config', 'user.name', 'Fregat'])
      await writeFile(path.join(fixture, 'a.ts'), `export const ${SAMPLE} = 1\n`)
      await fixtureGit(fixture, ['add', 'a.ts'])
      await fixtureGit(fixture, ['commit', '--quiet', '-m', 'initial'])
      await writeFile(path.join(fixture, 'a.ts'), `export const ${SAMPLE} = 2\n`)

      await openFixtureWorkspace(page, fixture)
      await openGitPanel(page)
      await selectors.worktreeFiles(page).first().click()
      await page.locator(diffPaneSelector).last().waitFor({ timeout: 15_000 })
      await page.waitForTimeout(3000)

      await watchHoverPlainCode(page)
      await hoverWord(page, SAMPLE, `${diffPaneSelector}:last-of-type`)
      strictEqual(
        await hoverTokenColor(page, SAMPLE),
        true,
        'a diff hover is painted by the backend the diff itself paints with',
      )
      strictEqual(await hoverShowedPlainCode(page), false, 'the hover opens coloured, never plain')
      await step('diff-hover')
    } finally {
      await rm(fixture, { force: true, recursive: true })
    }
  },
}
