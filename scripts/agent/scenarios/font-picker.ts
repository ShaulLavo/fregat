import { ok, strictEqual } from 'node:assert/strict'
import type { Page } from 'playwright'

import { focusEditor, openFileByName, selectors, waitForApp } from '../selectors'
import { clickColumns } from './editor-proportional-font'
import type { Scenario } from './index'

const rootFont = (page: Page, name: '--font-ui' | '--font-code') =>
  page.evaluate(
    (property) => getComputedStyle(document.documentElement).getPropertyValue(property),
    name,
  )

async function waitForRootFont(page: Page, name: '--font-ui' | '--font-code', family: string) {
  await page.waitForFunction(
    ({ property, expected }) =>
      getComputedStyle(document.documentElement).getPropertyValue(property).includes(expected),
    { property: name, expected: family },
  )
}

// The rail button, not the chord: on a fresh workspace the terminal holds focus and eats it.
async function openSettings(page: Page) {
  await waitForApp(page)
  await selectors.sidebarSettingsButton(page).click()
  await selectors.settingsSearch(page).fill('font')
}

async function pick(
  page: Page,
  role: 'Interface font' | 'Code font',
  query: string,
  option: RegExp,
) {
  await selectors.settingsFontPicker(page, role).click()
  await selectors.fontPickerSearch(page).fill(query)
  await selectors.fontPickerOption(page, option).first().click()
}

let report: unknown = null

export const fontPicker: Scenario = {
  name: 'font-picker',
  description:
    'Open the interface-font picker on suggestions, hover a searched font to preview the app in it, Escape back, choose it, reload into it, then pick a Nerd Font for code and check editor clicks land.',
  async run(page, { file, step }) {
    await openSettings(page)
    const savedUi = await rootFont(page, '--font-ui')

    await selectors.settingsFontPicker(page, 'Interface font').click()
    await selectors.fontPickerGroup(page, 'Suggested').waitFor()
    await step('ui-suggested')

    await selectors.fontPickerSearch(page).fill('geist')
    await selectors
      .fontPickerOption(page, /^Geist\b/u)
      .first()
      .hover()
    await waitForRootFont(page, '--font-ui', 'geist Fontsource')
    await page.evaluate(() => document.fonts.load('1em "geist Fontsource"'))
    await step('ui-hover-geist')

    await page.keyboard.press('Escape')
    await page.waitForFunction(
      (saved) => getComputedStyle(document.documentElement).getPropertyValue('--font-ui') === saved,
      savedUi,
    )
    await step('ui-escape-restored')

    await pick(page, 'Interface font', 'geist', /^Geist\b/u)
    await waitForRootFont(page, '--font-ui', 'geist Fontsource')
    // The boot mirror is written from the confirmed snapshot; wait for it before reloading.
    await page.waitForFunction(() =>
      (localStorage.getItem('platform.settings-boot-mirror.v1') ?? '').includes('fontsource:geist'),
    )

    await page.reload()
    await waitForApp(page)
    // The first frame after reload: the stylesheet was render-blocking and the face is ready.
    const firstFrame = await page.evaluate(() => ({
      link: document.querySelector<HTMLLinkElement>('link[data-font-ref="fontsource:geist"]')
        ?.dataset.state,
      bodyFont: getComputedStyle(document.body).fontFamily,
      loaded: document.fonts.check('1em "geist Fontsource"'),
    }))
    await step('reload-geist')
    ok(firstFrame.bodyFont.startsWith('"geist Fontsource"'), `body font was ${firstFrame.bodyFont}`)

    await openSettings(page)
    // Fonts installed on the server's machine are searchable beside the downloadable ones.
    await selectors.settingsFontPicker(page, 'Code font').click()
    await selectors.fontPickerSearch(page).fill('adwaita mono')
    await selectors
      .fontPickerOption(page, /^Adwaita Mono/u)
      .first()
      .waitFor()
    await step('code-search-installed')
    await page.keyboard.press('Escape')

    await pick(page, 'Code font', 'firacode', /^FiraCode Nerd Font/u)
    await waitForRootFont(page, '--font-code', 'FiraCode Nerd Font')
    await page.evaluate(() => document.fonts.load('1em "FiraCode Nerd Font"'))
    await step('code-firacode')
    // The popup must be gone, or the palette chord lands in its search field.
    await selectors.fontPickerSearch(page).waitFor({ state: 'detached' })

    await openFileByName(page, file)
    await focusEditor(page)
    await page.keyboard.press('Control+Home')
    await page.waitForTimeout(1000)
    await step('editor-open')
    const editorFont = await page.evaluate(() =>
      getComputedStyle(document.querySelector('.editor-virtualized')!).getPropertyValue(
        '--editor-font-family',
      ),
    )
    const clicks = await clickColumns(page)
    await step('editor-firacode')

    report = { savedUi, firstFrame, editorFont, clicks }
    strictEqual(
      clicks.misses.length,
      0,
      `${clicks.misses.length} of ${clicks.checked} clicks missed`,
    )
    ok(editorFont.includes('FiraCode Nerd Font'), `editor font was ${editorFont}`)
  },
  inspect: async () => report,
}
