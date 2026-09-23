import { mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { Scenario } from './index'
import type { Page } from 'playwright'
import { fixtureGit, openFixtureWorkspace, releaseFixture } from '../fixture-workspace'
import { openGitPanel, selectors } from '../selectors'
import { createScriptError } from '../../structured-errors'

const LINES = Array.from({ length: 40 }, (_, index) => `const line${index + 1} = ${index + 1}`)
const CHANGED_LINE = 30

export const gitDiffLineComment: Scenario = {
  name: 'git-diff-line-comment',
  description:
    'Drag a line range in a diff: the selection bar must name the dragged lines, and still name the right ones after unhiding the unmodified lines above shifts every row.',
  async run(page, { step }) {
    const fixture = await mkdtemp('/work/tmp/fregat-diff-comment-')
    try {
      await fixtureGit(fixture, ['init', '--quiet'])
      await fixtureGit(fixture, ['config', 'user.email', 'fregat@example.com'])
      await fixtureGit(fixture, ['config', 'user.name', 'Fregat'])
      await writeFile(path.join(fixture, 'a.ts'), `${LINES.join('\n')}\n`)
      await fixtureGit(fixture, ['add', 'a.ts'])
      await fixtureGit(fixture, ['commit', '--quiet', '-m', 'initial'])
      const changed = LINES.with(CHANGED_LINE - 1, 'const changed = true')
      await writeFile(path.join(fixture, 'a.ts'), `${changed.join('\n')}\n`)

      await openFixtureWorkspace(page, fixture)
      await openGitPanel(page)
      await selectors.worktreeFiles(page).first().click()
      await selectors.diffExpandRows(page).first().waitFor({ timeout: 15_000 })

      await dragChangedLine(page)
      await step('collapsed-selection')
      await assertLabel(page, 'collapsed')

      await selectors.diffExpandRows(page).first().click()
      await page.waitForTimeout(400)
      await dragChangedLine(page)
      await step('expanded-selection')
      await assertLabel(page, 'expanded')
    } finally {
      await releaseFixture(fixture)
    }
  },
}

async function dragChangedLine(page: Page): Promise<void> {
  const row = selectors.diffRows(page).filter({ hasText: 'const changed = true' }).first()
  // `hover` waits for the row to stop moving; a box read while the pane is still scrolling is stale.
  await row.hover({ position: { x: 40, y: 8 } })
  await page.mouse.down()
  await page.mouse.up()
}

async function assertLabel(page: Page, when: string): Promise<void> {
  const label = await selectors.diffLineSelectionLabel(page).textContent({ timeout: 5_000 })
  if (label?.includes(`new line ${CHANGED_LINE}`)) return

  throw createScriptError(`The ${when} selection named the wrong line: ${JSON.stringify(label)}`)
}
