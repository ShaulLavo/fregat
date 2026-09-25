import { ok } from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Page } from 'playwright'
import { selectors } from '../selectors'
import type { Scenario } from './index'

// A 2×2 red PNG, so the image preview has real pixels to load.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==',
  'base64',
)

async function createTree() {
  const root = await mkdtemp('/work/tmp/fregat-picker-browse-')
  await mkdir(path.join(root, 'nested', 'deeper'), { recursive: true })
  await writeFile(
    path.join(root, 'app.ts'),
    'export function greet(name: string) {\n  return `hi ${name}`\n}\n',
  )
  await writeFile(path.join(root, 'pixel.png'), PNG)
  await writeFile(path.join(root, 'nested', 'inside.md'), '# Inside\n')
  return root
}

async function goTo(page: Page, folder: string) {
  await selectors.pickerGoToFolder(page).click()
  await selectors.pickerFolderPath(page).fill(folder)
  await page.keyboard.press('Enter')
  await selectors.pickerRow(page, 'app.ts').waitFor()
}

export const filePickerBrowse: Scenario = {
  name: 'file-picker-browse',
  description:
    'Browse a fixture folder in the web picker: code, image and folder previews, the item count, and the ⌘[ ⌘] ⌘↓ chords.',
  async run(page, { step }) {
    const root = await createTree()
    try {
      await selectors.projectMenu(page).click()
      await selectors.openFolderMenu(page).click()
      await goTo(page, root)
      ok(
        /^\d+ items?$/.test(await selectors.pickerStatus(page).innerText()),
        'The footer counts the listing',
      )

      await selectors.pickerRow(page, 'app.ts').click()
      await selectors
        .pickerPreview(page)
        .locator('[data-file-preview-text]')
        .getByText('greet')
        .waitFor()
      await step('code-preview')

      await selectors.pickerRow(page, 'pixel.png').click()
      await page.waitForFunction(() => {
        const image = document.querySelector<HTMLImageElement>('[data-file-preview] img')
        return image !== null && image.complete && image.naturalWidth > 0
      })
      await step('image-preview')

      await selectors.pickerRow(page, 'nested').click()
      await selectors.pickerPreview(page).getByText('inside.md', { exact: true }).waitFor()
      await step('folder-preview')

      await page.keyboard.press('ControlOrMeta+ArrowDown')
      await selectors.pickerRow(page, 'inside.md').waitFor()
      await page.keyboard.press('ControlOrMeta+BracketLeft')
      await selectors.pickerRow(page, 'app.ts').waitFor()
      await page.keyboard.press('ControlOrMeta+BracketRight')
      await selectors.pickerRow(page, 'inside.md').waitFor()
      await step('history-chords')
      await page.keyboard.press('Escape')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  },
}
