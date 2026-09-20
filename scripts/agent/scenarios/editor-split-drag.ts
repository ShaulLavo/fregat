import { strictEqual, ok } from 'node:assert'
import type { Page } from 'playwright'
import { createScriptError } from '../../structured-errors'
import { openFileByName, selectors } from '../selectors'
import type { Scenario } from './index'

export const editorSplitDrag: Scenario = {
  name: 'editor-split-drag',
  description:
    'Drag to split, copy shared text, nest and resize groups, restore them, then merge duplicate tabs.',
  async run(page, { file, step }) {
    await openFileByName(page, file)
    await step('one-group')
    await dragTo(page, 0, 0, 'right')
    strictEqual(
      await selectors.editorDropPreview(page).count(),
      0,
      'moving a lone tab against its own edge is invalid',
    )
    await page.keyboard.down('Control')
    await selectors.editorDropPreview(page).waitFor()
    await page.keyboard.up('Control')
    await selectors.editorDropPreview(page).waitFor({ state: 'hidden' })
    await page.mouse.up()
    strictEqual(await selectors.editorGroups(page).count(), 1)

    await page.keyboard.down('Control')
    await dragTo(page, 0, 0, 'right')
    await selectors.editorDropPreview(page).waitFor()
    strictEqual(
      await selectors.editorDropPreview(page).getAttribute('data-editor-drop-preview'),
      'right',
    )
    await step('copy-preview')
    await page.mouse.up()
    await page.keyboard.up('Control')
    await selectors.editorGroups(page).nth(1).waitFor()
    await selectors.editorGroupInput(page, 1).waitFor()
    await step('split-right')
    ok(
      await selectors
        .editorGroups(page)
        .nth(1)
        .evaluate((element) => element.contains(document.activeElement)),
      'drop focuses the new group',
    )
    const original = await selectors
      .editorGroupTabs(page, 0)
      .first()
      .getAttribute('data-editor-tab-id')
    const copy = await selectors.editorGroupTabs(page, 1).first().getAttribute('data-editor-tab-id')
    ok(original !== copy, 'same file has independent view identities')

    await selectors.editorGroupInput(page, 1).focus()
    await page.keyboard.press('Control+Home')
    await page.keyboard.type('split_view_probe')
    await selectors
      .editorGroupRows(page, 0)
      .filter({ hasText: 'split_view_probe' })
      .first()
      .waitFor()
    await selectors
      .editorGroupRows(page, 1)
      .filter({ hasText: 'split_view_probe' })
      .first()
      .waitFor()
    await step('shared-edit')
    await selectors.editorGroupInput(page, 0).focus()
    ok(
      await selectors
        .editorGroupInput(page, 0)
        .evaluate((input) => input === document.activeElement),
      'undo starts from the original view',
    )
    await page.keyboard.press('Control+z')
    await selectors
      .editorGroupRows(page, 1)
      .filter({ hasText: 'split_view_probe' })
      .waitFor({ state: 'hidden' })

    await page.keyboard.down('Control')
    await dragTo(page, 1, 1, 'bottom')
    await selectors.editorDropPreview(page).waitFor()
    await step('nested-preview')
    await page.mouse.up()
    await page.keyboard.up('Control')
    await selectors.editorGroups(page).nth(2).waitFor()
    await step('nested-split')
    const left = await selectors.editorGroups(page).nth(0).boundingBox()
    const upper = await selectors.editorGroups(page).nth(1).boundingBox()
    const lower = await selectors.editorGroups(page).nth(2).boundingBox()
    ok(left && upper && lower)
    ok(upper.x > left.x && lower.y > upper.y, 'nested right column has a top and bottom group')
    const handle = await selectors.editorSplitHandles(page).last().boundingBox()
    ok(handle)
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
    await page.mouse.down()
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2 + 45, {
      steps: 12,
    })
    await page.mouse.up()
    const resized = await selectors.editorGroups(page).nth(1).boundingBox()
    ok(resized && resized.height > upper.height + 20, 'divider resize changes the group height')
    await step('resized')
    await page.waitForTimeout(1200)
    await page.reload()
    await selectors.editorGroups(page).nth(2).waitFor()
    await selectors.editorGroupInput(page, 2).waitFor()
    const restored = await selectors.editorGroups(page).nth(1).boundingBox()
    ok(
      restored && Math.abs(restored.height - resized.height) < 3,
      'reload retains divider position',
    )
    await step('restored')

    await dragTo(page, 2, 0, 'center')
    await selectors.editorDropPreview(page).waitFor()
    await page.keyboard.press('Escape')
    await page.mouse.up()
    strictEqual(await selectors.editorGroups(page).count(), 3, 'Escape leaves layout untouched')
    await dragTo(page, 2, 0, 'center')
    await page.mouse.up()
    await selectors.editorGroups(page).nth(2).waitFor({ state: 'hidden' })
    strictEqual(
      await selectors.editorGroupTabs(page, 0).count(),
      1,
      'destination duplicate is selected, not appended',
    )
    strictEqual(
      await selectors.editorGroupTabs(page, 0).first().getAttribute('data-editor-tab-id'),
      original,
    )
    await dragTo(page, 1, 0, 'center')
    await page.mouse.up()
    await selectors.editorGroups(page).nth(1).waitFor({ state: 'hidden' })
    await step('merged-one-group')
    await page.keyboard.down('Control')
    await dragTo(page, 0, 0, 'top')
    await selectors.editorDropPreview(page).waitFor()
    await step('split-top-preview')
    await page.mouse.up()
    await page.keyboard.up('Control')
    await selectors.editorGroups(page).nth(1).waitFor()
    await step('split-top')
  },
}

async function dragTo(
  page: Page,
  source: number,
  destination: number,
  edge: 'right' | 'bottom' | 'top' | 'center',
) {
  const tab = await selectors.editorGroupTabs(page, source).first().boundingBox()
  const target = await selectors.editorGroupContent(page, destination).boundingBox()
  if (!tab || !target) throw createScriptError('Editor drag target is not visible')
  const x = edge === 'right' ? target.x + target.width - 12 : target.x + target.width / 2
  let y = target.y + target.height / 2
  if (edge === 'bottom') y = target.y + target.height - 12
  if (edge === 'top') y = target.y + 12
  await page.mouse.move(tab.x + 35, tab.y + tab.height / 2)
  await page.mouse.down()
  await page.mouse.move(tab.x + 50, tab.y + tab.height / 2 + 12, { steps: 4 })
  await page.mouse.move(x, y, { steps: 16 })
  await page.waitForTimeout(150)
}
