import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Page } from 'playwright'
import { preserveAppearance, writeUserOperations } from '../preserve-settings'
import { selectors } from '../selectors'
import type { Scenario } from './index'

const MODES = ['light', 'dark'] as const
const DENSITIES = ['cozy', 'compact'] as const
// agent:browser's default --workspace, which the file tree beside the picker shows.
const WORKSPACE = '/work/projects/platform'

async function openAt(page: Page, folder: string, row: string) {
  await selectors.projectMenu(page).click()
  await selectors.openFolderMenu(page).click()
  await selectors.pickerGoToFolder(page).click()
  await selectors.pickerFolderPath(page).fill(folder)
  await page.keyboard.press('Enter')
  await selectors.pickerRow(page, row).waitFor()
}

async function close(page: Page) {
  await page.keyboard.press('Escape')
  await selectors.pickerDialog(page).waitFor({ state: 'hidden' })
}

export const filePickerAppearance: Scenario = {
  name: 'file-picker-appearance',
  description:
    'The picker beside the file tree in light and dark, cozy and compact: the workspace folder in columns (same rows as the tree), then a fixture with a long file in the list.',
  async run(page, { step }) {
    const restore = await preserveAppearance(page, ['workbench.colorTheme', 'workbench.density'])
    const root = await mkdtemp('/work/tmp/fregat-picker-appearance-')
    await mkdir(path.join(root, 'src'))
    await writeFile(path.join(root, 'README.md'), '# Fixture\n')
    await writeFile(
      path.join(root, 'long.ts'),
      Array.from({ length: 4000 }, (_, index) => `export const line${index} = ${index}`).join('\n'),
    )
    try {
      for (const mode of MODES)
        for (const density of DENSITIES) {
          await writeUserOperations(page, [
            { kind: 'set', key: 'workbench.colorTheme', value: mode },
            { kind: 'set', key: 'workbench.density', value: density },
          ])
          await page.locator(`html[data-density="${density}"].${mode}`).waitFor()
          await step(`tree-${mode}-${density}`)
          await openAt(page, WORKSPACE, 'apps')
          await selectors.pickerView(page, 'Columns').click()
          await selectors.pickerRow(page, 'apps').click()
          await selectors.pickerColumn(page, 1).waitFor()
          await step(`picker-${mode}-${density}`)
          await close(page)
          await openAt(page, root, 'long.ts')
          await selectors.pickerView(page, 'List').click()
          await selectors.pickerRow(page, 'long.ts').click()
          await selectors.pickerPreviewNote(page).waitFor()
          await step(`preview-${mode}-${density}`)
          await close(page)
        }
    } finally {
      await restore()
      await rm(root, { recursive: true, force: true })
    }
  },
}
