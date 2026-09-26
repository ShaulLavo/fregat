import { deepStrictEqual, strictEqual } from 'node:assert'
import type { Page } from 'playwright'
import { openFileByName, selectors } from '../selectors'
import type { Scenario } from './index'

export const editorSplitOrder: Scenario = {
  name: 'editor-split-order',
  description: 'Keep distinct tab orders in two groups when opening a file and reloading.',
  async run(page, { file, step }) {
    await openFileByName(page, file)
    await openFileByName(page, 'README.md')
    const left = await tabs(page, 0)
    strictEqual(left.length, 2)
    await selectors.editorGroupTabs(page, 0).last().click({ button: 'right' })
    await selectors.menuItem(page, 'Split Right').click()
    await selectors.editorGroupInput(page, 1).waitFor()
    await openFileByName(page, file)
    await page.waitForTimeout(250)
    const right = await tabs(page, 1)
    deepStrictEqual(
      right.map((tab) => tab.path),
      left.map((tab) => tab.path).toReversed(),
    )
    await step('independent-tab-orders')

    await openFileByName(page, 'docs/settings-reference.md')
    await page.waitForTimeout(250)
    const withThird = await tabs(page, 1)
    strictEqual(withThird.length, 3)
    deepStrictEqual(await tabs(page, 0), left, 'opening a file preserves the other group')
    deepStrictEqual(withThird.slice(0, 2), right, 'opening a file preserves its group tab order')
    await step('order-preserved-after-opening-file')

    await page.waitForTimeout(1200)
    await page.reload()
    await selectors.editorGroupInput(page, 1).waitFor()
    deepStrictEqual(await tabs(page, 0), left, 'reload preserves the first group')
    deepStrictEqual(await tabs(page, 1), withThird, 'reload preserves the second group')
    await step('independent-tab-orders-restored')
  },
}

async function tabs(page: Page, index: number) {
  return selectors.editorGroupTabs(page, index).evaluateAll((elements) =>
    elements.map((element) => ({
      id: element.getAttribute('data-editor-tab-id'),
      path: element.getAttribute('data-editor-tab-path'),
    })),
  )
}
