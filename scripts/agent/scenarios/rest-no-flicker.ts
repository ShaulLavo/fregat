import { strictEqual } from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { countBlankFrames } from '../blank-frames'
import {
  createGitFixture,
  fixtureGit,
  openFixtureWorkspace,
  releaseFixture,
} from '../fixture-workspace'
import { openFileByName, selectors } from '../selectors'
import type { Scenario } from './index'

let report: Record<string, number> = {}

export const restNoFlicker: Scenario = {
  name: 'rest-no-flicker',
  description: 'Toggle picker visibility and settings views, then choose a delayed font sample.',
  async run(page, { step }) {
    report = {}
    const root = await createGitFixture('rest-no-flicker')
    try {
      await fixtureGit(root, ['commit', '--quiet', '-m', 'fixture'])
      await mkdir(path.join(root, 'visible-folder'))
      await mkdir(path.join(root, '.hidden-folder'))
      await writeFile(path.join(root, 'visible.txt'), 'visible')
      await mkdir(path.join(root, 'columns/visible-folder'), { recursive: true })
      await mkdir(path.join(root, 'columns/.hidden-folder'))
      await selectors.projectMenu(page).click()
      await selectors.openFolderMenu(page).click()
      await selectors.pickerGoToFolder(page).click()
      await selectors.pickerFolderPath(page).fill(root)
      await page.keyboard.press('Enter')
      await selectors.pickerRow(page, 'visible-folder').waitFor()
      await page.route('**/fs/tree?*', async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 400))
        await route.continue()
      })
      for (const view of ['List', 'Columns'] as const) {
        if (view === 'Columns') {
          await selectors.pickerGoToFolder(page).click()
          await selectors.pickerFolderPath(page).fill(path.join(root, 'columns'))
          await page.keyboard.press('Enter')
        }
        await selectors.pickerView(page, view).click()
        if (view === 'Columns')
          await selectors.pickerFolderColumn(page, path.join(root, 'columns')).waitFor()
        await selectors.pickerRow(page, 'visible-folder').waitFor()
        report[view] = await countBlankFrames(
          page,
          selectors.pickerLoadedRowsSelector,
          async () => {
            await selectors.pickerHiddenToggle(page, false).click()
            await selectors.pickerRow(page, '.hidden-folder').waitFor()
            await selectors.pickerHiddenToggle(page, true).click()
            await selectors.pickerRow(page, '.hidden-folder').waitFor({ state: 'hidden' })
          },
        )
        await step(`${view}-blank-frames-${report[view]}`)
      }
      await page.keyboard.press('Escape')
      await page.unroute('**/fs/tree?*')
      await page.keyboard.press('Control+,')
      await selectors.settingsSearch(page).waitFor()
      report.settings = await countBlankFrames(
        page,
        selectors.settingsContentSelector,
        async () => {
          await selectors.settingsJsonView(page).click()
          await selectors.editorInput(page).first().waitFor()
          await selectors.settingsScopeTab(page, 'Defaults').click()
          await selectors.settingsDefaultsBanner(page).waitFor()
          await selectors.settingsFormView(page).click()
          await selectors.settingsSearch(page).waitFor()
        },
      )
      await step(`settings-blank-frames-${report.settings}`)
      await selectors.settingsSearch(page).fill('font')
      await page.route('**/fonts/preview?*', async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 1500))
        await route.continue()
      })
      await selectors.settingsFontPicker(page, 'Code font').click()
      await selectors.fontPickerSearch(page).fill('adwaita mono')
      const option = selectors.fontPickerOption(page, /^Adwaita Mono/u).first()
      await option.waitFor()
      report.font = await countBlankFrames(page, selectors.fontSampleReadySelector, async () => {
        await option.click()
        await page.waitForTimeout(250)
        await step('font-wait')
        await page.waitForTimeout(1950)
      })
      await step(`font-blank-frames-${report.font}`)
      await openFixtureWorkspace(page, root)
      await openFileByName(page, 'visible.txt')
      await openFileByName(page, 'a.txt')
      report.breadcrumbs = await countBlankFrames(
        page,
        selectors.breadcrumbLoadedSelector,
        async () => {
          for (const name of ['visible.txt', 'a.txt']) {
            await selectors.editorTabNamed(page, new RegExp(name)).click()
            await selectors.breadcrumbCrumb(page, name).waitFor()
          }
        },
      )
      await step(`breadcrumbs-blank-frames-${report.breadcrumbs}`)
      for (const [site, count] of Object.entries(report)) strictEqual(count, 0, `${site} blanked`)
    } finally {
      await releaseFixture(root)
    }
  },
  inspect: async () => report,
}
