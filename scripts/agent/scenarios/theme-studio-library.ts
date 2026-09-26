import { ok, strictEqual } from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import type { Page } from 'playwright'
import { chords, selectors } from '../selectors'
import { serverApi } from '../server-api'
import type { Scenario } from './index'

async function userThemes(page: Page) {
  const { base, headers } = serverApi(page)
  const themes = (await (await page.request.get(`${base}/themes/bundles`, { headers })).json()) as {
    id: string
    name: string
    source: string
  }[]
  return themes.filter((theme) => theme.source !== 'bundled')
}

async function themeMenu(page: Page, item: string) {
  const studio = selectors.themeStudio(page)
  await studio.getByRole('button', { name: /^Actions for / }).click()
  await selectors.menuItem(page, item).click()
}

export const themeStudioLibrary: Scenario = {
  name: 'theme-studio-library',
  description:
    'Preview themes from the `theme ` quick switch and escape, open the studio from its last row and from the titlebar Theme… item, then create, duplicate, export, delete and re-import a theme. Runs on a throwaway home.',
  async run(page, { step }) {
    const before = (await userThemes(page)).map((theme) => theme.id)
    await page.keyboard.press(chords.commandPalette)
    await selectors.paletteInput(page).fill('theme ')
    await selectors.themeBundlePaletteOption(page).first().waitFor()
    await page.keyboard.press('ArrowDown')
    await step('quick-switch-preview')
    await selectors.commandOption(page, 'Open theme studio…').click()
    const studio = selectors.themeStudio(page)
    await studio.waitFor()
    await step('studio-from-quick-switch')
    await studio.focus()
    await page.keyboard.press('Escape')
    await studio.waitFor({ state: 'detached' })

    await selectors.titlebar(page).click({ button: 'right' })
    await selectors.menuItem(page, 'Theme…').click()
    await studio.waitFor()
    await step('studio-from-titlebar')

    await studio.getByRole('button', { name: 'New theme', exact: true }).click()
    await selectors.menuItem(page, 'New from current').click()
    await studio
      .getByText(/ copy$/)
      .first()
      .waitFor()
    const created = (await userThemes(page)).filter((theme) => !before.includes(theme.id))
    strictEqual(created.length, 1, 'New from current adds one theme')
    await step('new-from-current')

    await themeMenu(page, 'Duplicate')
    let made = created
    for (let attempt = 0; attempt < 30 && made.length < 2; attempt += 1) {
      await page.waitForTimeout(100)
      made = (await userThemes(page)).filter((theme) => !before.includes(theme.id))
    }
    strictEqual(made.length, 2, 'Duplicate adds a second theme')
    await step('duplicated')

    const downloading = page.waitForEvent('download')
    await themeMenu(page, 'Export…')
    const download = await downloading
    const archive = await readFile((await download.path())!, 'utf8')
    ok(archive.includes('"variants"'), 'Export writes a theme archive')
    await step('exported')

    await themeMenu(page, 'Delete')
    for (let attempt = 0; attempt < 30; attempt += 1) {
      if ((await userThemes(page)).length === before.length + 1) break
      await page.waitForTimeout(100)
    }
    strictEqual((await userThemes(page)).length, before.length + 1, 'Delete removes one theme')
    await step('deleted')

    await studio.getByRole('button', { name: 'New theme', exact: true }).click()
    await selectors.menuItem(page, 'Import…').waitFor()
    await page.keyboard.press('Escape')
    await studio.getByLabel('Import theme file', { exact: true }).setInputFiles({
      name: 'theme.json',
      mimeType: 'application/json',
      buffer: Buffer.from(archive),
    })
    for (let attempt = 0; attempt < 30; attempt += 1) {
      if ((await userThemes(page)).length === before.length + 2) break
      await page.waitForTimeout(100)
    }
    strictEqual((await userThemes(page)).length, before.length + 2, 'Import adds the theme back')
    await step('imported')

    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    const { base, headers } = serverApi(page)
    // Best effort: the server refuses to delete an import whose archived wallpaper other themes
    // also use, and the run's throwaway home goes with it anyway.
    for (const theme of await userThemes(page)) {
      if (before.includes(theme.id)) continue
      await page.request.post(`${base}/themes/bundles/${theme.id}/delete`, { headers })
    }
    await step('cleaned-up')
  },
}
