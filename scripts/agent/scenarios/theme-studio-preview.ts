import { deepEqual } from 'node:assert/strict'
import type { Page } from 'playwright'
import { chords, runPaletteCommand, selectors } from '../selectors'
import type { Scenario } from './index'

async function primary(page: Page) {
  return page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--primary').trim(),
  )
}

async function previewCommand(page: Page, prefix: string) {
  await page.keyboard.press(chords.commandPalette)
  await selectors.paletteInput(page).fill(prefix)
  await selectors.paletteOptions(page).first().waitFor()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Escape')
}

export const themeStudioPreview: Scenario = {
  name: 'theme-studio-preview',
  description:
    'Keep a dirty studio preview across command previews; reopen the Themes tab and type backslashes in studio fields.',
  async run(page, { step }) {
    await runPaletteCommand(page, 'Theme studio')
    const studio = selectors.themeStudio(page)
    await selectors.themeStudioTab(page, 'Colors').click()
    const accent = studio.getByRole('textbox', { name: 'Accent', exact: true })
    await accent.fill('#d33682')
    await accent.press('Enter')
    await step('edited-accent')
    const edited = await primary(page)
    await selectors.themeStudioTab(page, 'Surfaces').click()
    await studio.getByRole('button', { name: 'Clear', exact: true }).click()
    await previewCommand(page, 'theme ')
    await step('after-theme-preview')
    const bundleRestored =
      (await page.evaluate(() =>
        document.documentElement.style.getPropertyValue('--surface-opacity'),
      )) === '55%'
    await previewCommand(page, 'colors ')
    await step('after-palette-preview')
    const paletteRestored = (await primary(page)) === edited

    await selectors.themeStudioTab(page, 'Wallpaper').click()
    await studio.getByRole('button', { name: 'Hide the studio', exact: true }).click()
    await selectors.titlebar(page).click({ button: 'right' })
    await selectors.menuItem(page, 'Theme…').click()
    await selectors.menuItem(page, 'Theme…').waitFor({ state: 'hidden' })
    await step('reopened-themes')
    const themesReopened =
      (await selectors.themeStudioTab(page, 'Themes').getAttribute('aria-selected')) === 'true'
    const expanded = await studio
      .getByRole('button', { name: 'Hide the studio', exact: true })
      .isVisible()
    const focused = await page.evaluate(() =>
      document.activeElement?.hasAttribute('data-studio-themes')
        ? true
        : document.activeElement?.outerHTML.slice(0, 180),
    )
    if (!expanded)
      await studio.getByRole('button', { name: 'Show the studio', exact: true }).click()

    await selectors.themeStudioTab(page, 'Wallpaper').click()
    const filter = studio.getByRole('textbox', { name: 'Filter wallpapers', exact: true })
    const darkBefore = await selectors.themeStudioTab(page, 'Dark').getAttribute('aria-selected')
    await filter.press('\\')
    const filterAcceptsSlash = (await filter.inputValue()) === '\\'
    const modeUnchanged =
      (await selectors.themeStudioTab(page, 'Dark').getAttribute('aria-selected')) === darkBefore
    await selectors.themeStudioTab(page, 'Colors').click()
    await accent.fill('#123456')
    await accent.press('End')
    await accent.press('\\')
    const hexAcceptsSlash = (await accent.inputValue()) === '#123456\\'
    await accent.press('Escape')
    await studio.getByRole('button', { name: 'Import palette…', exact: true }).click()
    const json = selectors.paletteImportText(page)
    await json.press('\\')
    const jsonAcceptsSlash = (await json.inputValue()) === '\\'
    await step('text-fields-own-backslash')
    await page.keyboard.press('Escape')
    await studio.getByRole('button', { name: 'Close', exact: true }).click()
    await studio.getByRole('button', { name: 'Close', exact: true }).click()
    deepEqual(
      {
        bundleRestored,
        paletteRestored,
        themesReopened,
        expanded,
        focused,
        filterAcceptsSlash,
        modeUnchanged,
        hexAcceptsSlash,
        jsonAcceptsSlash,
      },
      {
        bundleRestored: true,
        paletteRestored: true,
        themesReopened: true,
        expanded: true,
        focused: true,
        filterAcceptsSlash: true,
        modeUnchanged: true,
        hexAcceptsSlash: true,
        jsonAcceptsSlash: true,
      },
    )
  },
}
