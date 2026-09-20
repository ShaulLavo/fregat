import { ok } from 'node:assert/strict'
import type { Page } from 'playwright'
import type { Scenario } from './index'
import { diffPaneSelector, selectors } from '../selectors'

export const chatDiffSyntax: Scenario = {
  name: 'chat-diff-syntax',
  description: 'Verify syntax colors in a session diff opened through its address URL.',
  async run(page, { step }) {
    await selectors.diffRows(page).first().waitFor()
    await page.waitForTimeout(5000)
    await step('session-diff')
    const colors = await diffSyntaxColors(page)
    ok(colors.length > 1, `Expected syntax colors in the diff, found ${JSON.stringify(colors)}`)
    await selectors.diffExpandRows(page).first().click()
    await page.waitForTimeout(300)
    await step('expanded-context')
    ok((await diffSyntaxColors(page)).length > 1, 'Expanded context retains syntax colors')
  },
  inspect: diffSyntaxColors,
}

function diffSyntaxColors(page: Page) {
  return selectors
    .diffRows(page)
    .first()
    .evaluate((row, paneSelector) => {
      const colors = new Set<string>()
      for (const [name, highlight] of CSS.highlights.entries()) {
        if (!name.startsWith('editor-shared-token-')) continue
        const inDiff = [...highlight].some((range) =>
          range.startContainer.parentElement?.closest(paneSelector),
        )
        if (inDiff) colors.add(getComputedStyle(row, `::highlight(${name})`).color)
      }
      return [...colors].sort()
    }, diffPaneSelector)
}
