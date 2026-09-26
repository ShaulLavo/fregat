import { deepEqual } from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import { selectors } from '../selectors'
import type { Scenario } from './index'

export const filePickerSelection: Scenario = {
  name: 'file-picker-selection',
  description: 'Leave an empty column, select its sibling, then hide a selected hidden folder.',
  async run(page, { step }) {
    const root = await mkdtemp('/work/tmp/fregat-picker-selection-')
    await Promise.all(
      ['empty-review-folder', 'sibling-review-folder/child', '.hidden'].map((folder) =>
        mkdir(path.join(root, folder), { recursive: true }),
      ),
    )
    try {
      await selectors.projectMenu(page).click()
      await selectors.openFolderMenu(page).click()
      await selectors.pickerGoToFolder(page).click()
      await selectors.pickerFolderPath(page).fill(root)
      await page.keyboard.press('Enter')
      await selectors.pickerRow(page, 'empty-review-folder').click()
      await page.keyboard.press('ArrowRight')
      await selectors.pickerColumn(page, 1).focus()
      await page.keyboard.press('ArrowLeft')
      await page.keyboard.press('ArrowDown')
      await selectors.pickerColumn(page, 1).getByText('child', { exact: true }).waitFor()
      await selectors
        .pickerPreviewPath(page, path.join(root, 'sibling-review-folder').slice(1))
        .waitFor()
      await step('sibling-after-empty-column')
      const siblingSelection = await selectors.pickerPreview(page).getAttribute('data-file-preview')

      const show = selectors.pickerHiddenToggle(page, false)
      if (await show.isVisible()) await show.click()
      await selectors.pickerRow(page, '.hidden').click()
      await selectors.pickerColumn(page, 1).waitFor()
      await selectors.pickerHiddenToggle(page, true).click()
      await selectors.pickerRow(page, '.hidden').waitFor({ state: 'hidden' })
      await selectors.pickerPreviewPath(page, root.slice(1)).waitFor()
      await step('hidden-selection-cleared')
      const hiddenSelection = await selectors.pickerPreview(page).getAttribute('data-file-preview')
      await page.keyboard.press('Escape')
      deepEqual(
        { siblingSelection, hiddenSelection },
        {
          siblingSelection: path.join(root, 'sibling-review-folder').slice(1),
          hiddenSelection: root.slice(1),
        },
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  },
}
