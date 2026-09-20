import { deepStrictEqual, strictEqual, ok } from 'node:assert'
import type { Page } from 'playwright'
import { openFileByName, runPaletteCommand, selectors } from '../selectors'
import type { Scenario } from './index'

export const editorSplitActions: Scenario = {
  name: 'editor-split-actions',
  description:
    'Reorder by keyboard, move a tab into a split, split from its menu, enforce minimum sizes, and move through the group chooser.',
  async run(page, { file, step }) {
    await openFileByName(page, file)
    await openFileByName(page, 'README.md')
    strictEqual(await selectors.editorGroupTabs(page, 0).count(), 2)
    const originalIds = await tabIds(page, 0)
    await selectors.editorGroupTabs(page, 0).first().focus()
    await page.keyboard.press('Space')
    await step('keyboard-picked-up')
    await page.keyboard.press('ArrowRight')
    await step('keyboard-target')
    await page.keyboard.press('Space')
    await page.waitForTimeout(350)
    deepStrictEqual(
      await tabIds(page, 0),
      originalIds.toReversed(),
      'keyboard drag reorders within its strip',
    )
    await step('keyboard-reordered')

    const tab = await selectors.editorGroupTabs(page, 0).last().boundingBox()
    const target = await selectors.editorGroupContent(page, 0).boundingBox()
    ok(tab && target)
    await page.mouse.move(tab.x + 30, tab.y + tab.height / 2)
    await page.mouse.down()
    await page.mouse.move(tab.x + 40, tab.y + 45, { steps: 4 })
    await page.mouse.move(target.x + 10, target.y + target.height / 2, { steps: 16 })
    await selectors.editorDropPreview(page).waitFor()
    await step('move-left-preview')
    await page.mouse.up()
    await selectors.editorGroups(page).nth(1).waitFor()
    deepStrictEqual(await tabIds(page, 0), [originalIds[0]], 'move preserves the original view ID')
    deepStrictEqual(await tabIds(page, 1), [originalIds[1]])
    const untouched = await selectors.editorGroups(page).nth(1).boundingBox()
    ok(untouched)

    await selectors.editorGroupTabs(page, 0).first().click({ button: 'right' })
    await selectors.menuItem(page, 'Split Right').click()
    await selectors.editorGroups(page).nth(2).waitFor()
    const sibling = await selectors.editorGroups(page).nth(2).boundingBox()
    ok(
      sibling && Math.abs(sibling.width - untouched.width) < 3,
      'same-axis split preserves unrelated sibling width',
    )
    const left = await selectors.editorGroups(page).nth(0).boundingBox()
    const middle = await selectors.editorGroups(page).nth(1).boundingBox()
    ok(left && middle && Math.abs(left.width - middle.width) < 3, 'split halves only its target')
    await step('menu-split-three-columns')

    await selectors.editorGroupTabs(page, 0).first().click({ button: 'right' })
    strictEqual(
      await selectors.menuItem(page, 'Split Right').getAttribute('aria-disabled'),
      'true',
      'too-narrow group disables split',
    )
    await selectors.menuItem(page, 'Move to Group…').click()
    const dialog = selectors.editorGroupDialog(page)
    await dialog.waitFor()
    await page.waitForTimeout(200)
    await step('move-group-chooser')
    await dialog.getByRole('button', { name: 'Group 3', exact: true }).click()
    await selectors.editorGroups(page).nth(2).waitFor({ state: 'hidden' })
    await dialog.waitFor({ state: 'hidden' })
    deepStrictEqual(
      await tabIds(page, 1),
      [originalIds[1], originalIds[0]],
      'chooser appends the original tab to destination',
    )
    await step('moved-to-existing-group')

    await runPaletteCommand(page, 'Focus First Editor Group')
    await page.waitForTimeout(150)
    strictEqual(
      await selectors.editorGroups(page).nth(0).getAttribute('data-editor-group-active'),
      'true',
    )
    ok(
      await selectors
        .editorGroups(page)
        .nth(0)
        .evaluate((element) => element.contains(document.activeElement)),
    )
    await page.keyboard.press('Control+End')
    await step('independent-focus-scroll')
    const firstScroll = await firstVisibleRow(page, 0)
    const secondScroll = await firstVisibleRow(page, 1)
    ok(firstScroll > 0, 'first editor scrolls to its own cursor')
    strictEqual(secondScroll, 0, 'other occurrence keeps its scroll position')
    await page.waitForTimeout(1200)
    await page.reload()
    await selectors.editorGroupInput(page, 1).waitFor()
    await step('view-scroll-restored')
    strictEqual(await firstVisibleRow(page, 0), firstScroll, 'reload restores first view scroll')
    strictEqual(await firstVisibleRow(page, 1), secondScroll, 'reload restores second view scroll')
    const cloneId = (await tabIds(page, 0))[0]
    const moving = await selectors.editorGroupTabs(page, 1).first().boundingBox()
    const anchor = await selectors.editorGroupTabs(page, 0).first().boundingBox()
    ok(moving && anchor)
    await page.mouse.move(moving.x + 30, moving.y + moving.height / 2)
    await page.mouse.down()
    await page.mouse.move(moving.x + 40, moving.y + 40, { steps: 4 })
    await page.mouse.move(anchor.x + 8, anchor.y + anchor.height / 2, { steps: 16 })
    await selectors.editorTabInsertion(page).waitFor()
    await step('strip-insertion-preview')
    await page.mouse.up()
    await page.waitForTimeout(250)
    deepStrictEqual(
      await tabIds(page, 0),
      [originalIds[1], cloneId],
      'strip drop inserts before its anchor',
    )
    deepStrictEqual(await tabIds(page, 1), [originalIds[0]])
    await step('inserted-in-existing-strip')
  },
}

async function tabIds(page: Page, index: number) {
  return selectors
    .editorGroupTabs(page, index)
    .evaluateAll((elements) =>
      elements.map((element) => element.getAttribute('data-editor-tab-id')),
    )
}

async function firstVisibleRow(page: Page, index: number) {
  return selectors.editorGroupRows(page, index).evaluateAll((elements) => {
    const visible = elements.filter((element) => element.getClientRects().length > 0)
    return Math.min(
      ...visible.map((element) => Number(element.getAttribute('data-editor-virtual-row'))),
    )
  })
}
