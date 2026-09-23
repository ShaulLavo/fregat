import { ok } from 'node:assert'
import type { Page } from 'playwright'
import { openFileByName, selectors } from '../selectors'
import type { Scenario } from './index'

const FILES = [
  'AGENTS.md',
  'PLAN.md',
  'README.md',
  'BASELINE.md',
  'AUDIT-FINDINGS-PLAN.md',
  'package.json',
  'tsconfig.json',
  'turbo.json',
  'knip.json',
  'lefthook.yml',
  'skills-lock.json',
]

export const editorTabReveal: Scenario = {
  name: 'editor-tab-reveal',
  description:
    'Overflow the tab strip, check the newest tab is revealed, then reselect the clipped first tab.',
  async run(page, { step }) {
    for (const name of FILES) await openFileByName(page, name)
    await page.waitForTimeout(600)
    await assertActiveTabVisible(page, 'the newest tab is revealed as it opens')
    await step('newest-tab-revealed')

    await openFileByName(page, FILES[0]!)
    await page.waitForTimeout(600)
    await assertActiveTabVisible(page, 'reselecting a clipped tab scrolls back to it')
    await step('first-tab-revealed')
  },
}

async function assertActiveTabVisible(page: Page, message: string) {
  const strip = await selectors.editorTabStrip(page, 0).boundingBox()
  const tab = await selectors
    .editorGroupTabs(page, 0)
    .and(page.locator('[aria-selected="true"]'))
    .boundingBox()
  ok(strip && tab, message)
  ok(tab.x >= strip.x - 1 && tab.x + tab.width <= strip.x + strip.width + 1, message)
}
