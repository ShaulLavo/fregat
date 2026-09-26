import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { countBlankFrames } from '../blank-frames'
import { selectors } from '../selectors'
import type { Scenario } from './index'

// A 2×2 red PNG, so the image preview has real pixels to decode.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==',
  'base64',
)

async function createTree() {
  const root = await mkdtemp('/work/tmp/fregat-picker-locations-')
  await mkdir(path.join(root, 'b-folder'))
  await writeFile(path.join(root, 'b-folder', 'inside.md'), '# Inside\n')
  await writeFile(path.join(root, 'c-first.ts'), 'export const first = 1\n')
  await writeFile(path.join(root, 'd-pixel.png'), PNG)
  await writeFile(path.join(root, 'e-second.ts'), 'export const second = 2\n')
  await writeFile(path.join(root, 'f-notes.md'), '# Notes\n')
  return root
}

export const filePickerLocations: Scenario = {
  name: 'file-picker-locations',
  description:
    'The picker sidebar: places, detected project folders and drives; pin and unpin the open folder; then arrow through text, image and folder previews and count the frames the preview showed no content.',
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
      await selectors.pickerRow(page, 'c-first.ts').waitFor()
      await selectors.pickerPinFolder(page, false).click()
      const pinned = selectors.pickerSidebarSection(page, 'Pinned')
      await pinned.getByRole('button', { name: path.basename(root) }).waitFor()
      await step('pinned')
      await selectors.pickerPinFolder(page, true).click()
      await pinned.waitFor({ state: 'detached' })

      await selectors.pickerView(page, 'List').click()
      await selectors.pickerRow(page, 'b-folder').click()
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
