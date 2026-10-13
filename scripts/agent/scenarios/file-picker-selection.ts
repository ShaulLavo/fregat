import { scratchPath } from '../paths'
import { deepEqual, ok } from 'node:assert/strict'
import { mkdir, mkdtemp } from 'node:fs/promises'
import path from 'node:path'
import { selectors } from '../selectors'
import { releaseFixture } from '../fixture-workspace'
import type { Scenario } from './index'

export const filePickerSelection: Scenario = {
  name: 'file-picker-selection',
  description:
    'Wait for a typed folder to load before Open, leave an empty column, select its sibling, then hide a selected hidden folder.',
  async run(page, { step }) {
    const root = await mkdtemp(scratchPath('fregat-picker-selection-'))
    await Promise.all(
      ['empty-review-folder', 'sibling-review-folder/child', '.hidden'].map((folder) =>
        mkdir(path.join(root, folder), { recursive: true }),
      ),
    )
    const listingEntered = Promise.withResolvers<void>()
    const listingReleased = Promise.withResolvers<void>()
    const listingRoute = `**/fs/tree?*`
    await page.route(listingRoute, async (route) => {
      if (new URL(route.request().url()).searchParams.get('path') === root.slice(1)) {
        listingEntered.resolve()
        await listingReleased.promise
      }
      await route.continue()
    })
    try {
      await selectors.projectMenu(page).click()
      await selectors.openFolderMenu(page).click()
      await selectors.pickerGoToFolder(page).click()
      await selectors.pickerFolderPath(page).fill(root)
      await page.keyboard.press('Enter')
      await listingEntered.promise
      ok(await selectors.pickerFolderPath(page).isVisible(), 'The pending path stays visible')
      ok(await selectors.pickerChoose(page).isDisabled(), 'Open waits for the destination')
      await step('typed-folder-loading')
      listingReleased.resolve()
      await selectors.pickerFolderPath(page).waitFor({ state: 'hidden' })
      ok(await selectors.pickerChoose(page).isEnabled(), 'Open becomes available after loading')
      await step('typed-folder-ready')
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
      listingReleased.resolve()
      await page.unroute(listingRoute)
      await releaseFixture(root)
    }
  },
}
