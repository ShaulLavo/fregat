import type { Page } from 'playwright'
import type { Scenario } from './index'
import { chords, selectors, wallpaperStillSelector } from '../selectors'
import { createScriptError } from '../../structured-errors'

const MODES = ['Light', 'Dark'] as const
// Bytes no seed directory holds: a copy of an imported image would join that asset, not add one.
const UPLOAD_NAME = 'agent-scenario.png'
const UPLOAD = {
  name: UPLOAD_NAME,
  mimeType: 'image/png',
  buffer: Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAADAAAAAgCAIAAADbtmxLAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAASUlEQVRYhe2WAQkAQAwCF8VoRrnoH2PPOFgAET03NF/drCtAQdGhmiFsWdbxg2CMDtUMYcuyDiF80KJDNUPYssihCMY6HRwe1weCCwBbeEMuXAAAAABJRU5ErkJggg==',
    'base64',
  ),
}

async function openPicker(page: Page, mode: (typeof MODES)[number]) {
  await selectors.wallpaperTile(page, mode).click()
  await selectors.wallpaperPicker(page).waitFor()
}

async function selectedLabels(page: Page) {
  const labels: Record<string, string | null> = {}
  for (const mode of MODES) {
    await selectors.wallpaperMode(page, mode).click()
    labels[mode] = await selectors.wallpaperSelectedChoice(page).getAttribute('aria-label')
  }
  return labels
}

// The scenario writes real settings; whatever was chosen before comes back.
async function restore(page: Page, labels: Record<string, string | null>) {
  if (!(await selectors.wallpaperPicker(page).isVisible())) {
    await page.keyboard.press('Control+,')
    await selectors.settingsSearch(page).fill('wallpaper')
    await openPicker(page, 'Light')
  }
  await selectors.wallpaperFilter(page).fill('')
  for (const mode of MODES) {
    const label = labels[mode]
    if (!label) continue
    await selectors.wallpaperMode(page, mode).click()
    await selectors.wallpaperChoice(page, label).click()
  }
  await page.keyboard.press('Escape')
}

export const wallpaperLibrary: Scenario = {
  name: 'wallpaper-library',
  description:
    'Open the wallpaper picker from the settings row, upload and delete an image, filter, select per mode from the keyboard, and advance with Next wallpaper. Restores the previous selection.',
  async run(page, { step }) {
    await page.keyboard.press('Control+,')
    await selectors.settingsSearch(page).fill('wallpaper')
    await selectors.wallpaperTile(page, 'Light').waitFor()
    await step('settings-row')
    await openPicker(page, 'Light')
    const cards = selectors.wallpaperCards(page)
    await cards.first().waitFor({ timeout: 20_000 })
    if ((await cards.count()) < 2)
      throw createScriptError('Import at least two library wallpapers before this scenario.')
    const before = await selectedLabels(page)
    try {
      await selectors.wallpaperMode(page, 'Light').click()
      await step('picker-light')
      const ownsUpload = (await selectors.wallpaperCard(page, UPLOAD_NAME).count()) === 0
      if (ownsUpload) {
        await selectors.wallpaperUploadInput(page).setInputFiles(UPLOAD)
        await selectors
          .wallpaperCard(page, UPLOAD_NAME)
          .and(page.locator('[aria-pressed="true"]'))
          .waitFor({ timeout: 20_000 })
        await step('uploaded-and-selected')
      }
      await selectors.wallpaperFilter(page).fill('tokyo')
      await cards.first().focus()
      await page.keyboard.press('Enter')
      await step('filtered-keyboard-selection')
      await selectors.wallpaperFilter(page).fill('')
      await selectors.wallpaperMode(page, 'Dark').click()
      await cards.nth(1).click()
      await step('dark-selection')
      if (ownsUpload) {
        await selectors.wallpaperCard(page, UPLOAD_NAME).hover()
        await selectors.wallpaperActions(page, UPLOAD_NAME).click()
        await selectors.menuItem(page, 'Delete').click()
        await selectors.wallpaperCard(page, UPLOAD_NAME).waitFor({ state: 'detached' })
        await step('upload-deleted')
      }
      await page.keyboard.press('Escape')
      await step('settings-row-after')
      await page.keyboard.press('Escape')
      await selectors.wallpaperStill(page).waitFor()
      await step('workbench-wallpaper')
      const previous = await selectors.wallpaperStill(page).getAttribute('src')
      await page.keyboard.press(chords.commandPalette)
      await selectors.paletteInput(page).fill('>Next wallpaper')
      await selectors.commandOption(page, 'Next wallpaper').click()
      await page.waitForFunction(
        `document.querySelector(${JSON.stringify(wallpaperStillSelector)})?.getAttribute('src') !== ${JSON.stringify(previous)}`,
      )
      await step('next-wallpaper')
    } finally {
      await restore(page, before)
    }
    await step('restored')
  },
}
