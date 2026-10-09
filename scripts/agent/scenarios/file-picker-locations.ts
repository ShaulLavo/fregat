import { scratchPath } from '../paths'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { countBlankFrames } from '../blank-frames'
import { selectors } from '../selectors'
import type { Scenario } from './index'

// The folder picker lists folders only, so each previewed folder holds a subfolder for its
// preview to list beside a file it hides.
const FOLDERS = ['b-alpha', 'c-beta', 'd-gamma', 'e-delta', 'f-epsilon']

async function createTree() {
  const root = await mkdtemp(scratchPath('fregat-picker-locations-'))
  for (const folder of FOLDERS) {
    await mkdir(path.join(root, folder, 'inner'), { recursive: true })
    await writeFile(path.join(root, folder, 'notes.md'), `# ${folder}\n`)
  }
  return root
}

export const filePickerLocations: Scenario = {
  name: 'file-picker-locations',
  description:
    'The picker sidebar: places, detected project folders and drives; pin and unpin the open folder; then arrow through folder previews and count the frames the preview showed no content.',
  async run(page, { step }) {
    const root = await createTree()
    try {
      await selectors.projectMenu(page).click()
      await selectors.openFolderMenu(page).click()
      await selectors.pickerSidebarSection(page, 'Places').waitFor()
      await selectors.pickerSidebarSection(page, 'Drives').waitFor()
      await step('sidebar')

      await selectors.pickerGoToFolder(page).click()
      await selectors.pickerFolderPath(page).fill(root)
      await page.keyboard.press('Enter')
      await selectors.pickerRow(page, 'b-alpha').waitFor()
      await selectors.pickerPinFolder(page, false).click()
      const pinned = selectors.pickerSidebarSection(page, 'Pinned')
      await pinned.getByRole('button', { name: path.basename(root) }).waitFor()
      await step('pinned')
      await selectors.pickerPinFolder(page, true).click()
      await pinned.waitFor({ state: 'detached' })

      await selectors.pickerView(page, 'List').click()
      await selectors.pickerRow(page, 'b-alpha').click()
      await page.locator(selectors.pickerPreviewContentSelector).first().waitFor()
      const blank = await countBlankFrames(
        page,
        selectors.pickerPreviewContentSelector,
        async () => {
          for (let index = 0; index < 4; index += 1) {
            await page.keyboard.press('ArrowDown')
            await page.waitForTimeout(450)
          }
        },
      )
      await step(`preview-blank-frames-${blank}`)
      await page.keyboard.press('Escape')
    } finally {
      await rm(root, { force: true, recursive: true })
    }
  },
}
