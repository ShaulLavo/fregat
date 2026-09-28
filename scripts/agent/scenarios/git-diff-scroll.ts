import { strictEqual, ok } from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Page } from 'playwright'
import type { Scenario } from './index'
import {
  createGitFixture,
  fixtureGit,
  openFixtureWorkspace,
  releaseFixture,
} from '../fixture-workspace'
import { openGitPanel, selectors } from '../selectors'

export const gitDiffScroll: Scenario = {
  name: 'git-diff-scroll',
  description: 'New diffs start at the top and visited diffs restore their own scroll position.',
  async run(page, { step }) {
    const fixture = await createGitFixture('diff-scroll')
    try {
      await fixtureGit(fixture, ['commit', '--quiet', '-m', 'initial'])
      for (const file of ['b.txt', 'c.txt']) {
        await writeFile(
          path.join(fixture, file),
          Array.from({ length: 300 }, (_, i) => `${file} line ${i}`).join('\n'),
        )
      }
      await openFixtureWorkspace(page, fixture)
      await openGitPanel(page)
      await selectors.gitChangeRow(page, 'b.txt').dblclick()
      await selectors.diffRows(page).first().waitFor()
      await step('first-diff-top')
      const viewport = selectors.diffPanes(page).locator(selectors.diffScrollerSelector).first()
      await viewport.hover()
      await page.mouse.wheel(0, 1800)
      await page.waitForTimeout(400)
      const saved = await scrollTop(page)
      ok(saved > 500, `First diff must scroll, got ${saved}`)
      await step('first-diff-scrolled')
      await selectors.gitChangeRow(page, 'c.txt').dblclick()
      await page.waitForTimeout(500)
      await step('new-diff')
      strictEqual(await scrollTop(page), 0, 'An unvisited diff must start at the top')
      await selectors.gitChangeRow(page, 'b.txt').click()
      await page.waitForTimeout(400)
      strictEqual(await scrollTop(page), saved, 'A visited diff must restore its offset')
      await step('restored-first-diff')
    } finally {
      await releaseFixture(fixture)
    }
  },
}

function scrollTop(page: Page) {
  return selectors
    .diffPanes(page)
    .locator(selectors.diffScrollerSelector)
    .first()
    .evaluate((element) => element.scrollTop)
}
