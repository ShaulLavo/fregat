import { notStrictEqual, ok, strictEqual } from 'node:assert/strict'
import type { Page } from 'playwright'
import { openFileByName, runPaletteCommand, selectors, waitForApp } from '../selectors'
import { selectedThemeId, userSettings } from '../server-api'
import type { Scenario } from './index'

function cssToken(page: Page, name: string) {
  return page.evaluate(
    (token) => getComputedStyle(document.documentElement).getPropertyValue(token).trim(),
    name,
  )
}

function background(page: Page) {
  return cssToken(page, '--background')
}

// An accent no bundled palette uses, so the repaint is unambiguous.
async function setAccent(page: Page, from: string) {
  const accent = selectors.themeStudio(page).getByRole('textbox', { name: 'Accent', exact: true })
  await accent.fill('#d33682')
  await accent.press('Enter')
  await page.waitForFunction(
    (before) =>
      getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() !== before,
    from,
  )
}

async function repainted(page: Page, from: string) {
  await page.waitForFunction(
    (before) =>
      getComputedStyle(document.documentElement).getPropertyValue('--background').trim() !== before,
    from,
  )
}

export const themeStudio: Scenario = {
  name: 'theme-studio',
  description:
    'Open the theme studio, arrow through themes with the app repainting and nothing written, flip light and dark, edit the accent, sort wallpapers by match and take colors from one, discard with Escape twice, then choose again, edit, and Apply.',
  async run(page, { step }) {
    const before = await userSettings(page)
    const saved = await background(page)
    await runPaletteCommand(page, 'Theme studio')
    const dock = selectors.themeStudio(page)
    await dock.waitFor()
    await page.keyboard.press('ArrowRight')
    await repainted(page, saved)
    await step('previewing-next-theme')
    strictEqual(
      selectedThemeId(await userSettings(page)),
      selectedThemeId(before),
      'Browsing writes nothing',
    )
    const previewing = await background(page)
    await openFileByName(page, 'README.md')
    await dock.waitFor()
    strictEqual(await background(page), previewing, 'The draft stays on screen while working')
    await step('working-under-the-draft')
    await dock.locator('[data-studio-themes]').focus()

    const dark = await page.evaluate(() => document.documentElement.classList.contains('dark'))
    await page.keyboard.press('\\')
    await page.waitForFunction(
      (was) => document.documentElement.classList.contains('dark') !== was,
      dark,
    )
    await step('other-half')
    strictEqual(
      (await userSettings(page))['workbench.colorTheme'],
      before['workbench.colorTheme'],
      'Flipping halves writes nothing',
    )

    await dock.getByRole('tab', { name: 'Code', exact: true }).click()
    await dock.getByRole('listbox', { name: 'Code colors' }).focus()
    await page.keyboard.press('ArrowDown')
    await step('code-tab')
    await dock.getByRole('tab', { name: 'Surfaces', exact: true }).click()
    await dock.getByRole('button', { name: 'Solid', exact: true }).click()
    await step('surfaces-tab')

    const beforeAccent = await cssToken(page, '--primary')
    await selectors.themeStudioTab(page, 'Colors').click()
    await setAccent(page, beforeAccent)
    await step('colors-forked')
    strictEqual(
      selectedThemeId(await userSettings(page)),
      selectedThemeId(before),
      'Editing colors writes nothing',
    )

    await selectors.themeStudioTab(page, 'Wallpaper').click()
    await dock.getByRole('tab', { name: 'Matches', exact: true }).click()
    await dock.getByText('Closest to these colors').waitFor()
    const closest = dock.getByRole('button', { name: /^Select .+/ }).first()
    await closest.waitFor({ timeout: 20_000 })
    await step('wallpaper-matches')
    await closest.click()
    const beforeImage = await background(page)
    await dock.getByRole('button', { name: 'Colors from this image', exact: true }).click()
    await repainted(page, beforeImage)
    await step('colors-from-image')

    await dock.getByRole('listbox', { name: 'Code colors' }).or(dock).first().focus()
    await page.keyboard.press('Escape')
    await dock.getByText('Repeat to drop your edits').waitFor()
    await page.keyboard.press('Escape')
    await dock.waitFor({ state: 'detached' })
    await page.waitForFunction(
      (value) =>
        getComputedStyle(document.documentElement).getPropertyValue('--background').trim() ===
        value,
      saved,
    )
    strictEqual(
      selectedThemeId(await userSettings(page)),
      selectedThemeId(before),
      'Discarding writes nothing',
    )
    await step('discarded')

    await runPaletteCommand(page, 'Theme studio')
    await dock.waitFor()
    await page.keyboard.press('ArrowRight')
    await repainted(page, saved)
    await selectors.themeStudioTab(page, 'Colors').click()
    await setAccent(page, await cssToken(page, '--primary'))
    await dock.getByRole('button', { name: 'Save and use', exact: true }).click()
    await dock.waitFor({ state: 'detached' })
    let applied = selectedThemeId(await userSettings(page))
    for (let attempt = 0; attempt < 20 && applied === selectedThemeId(before); attempt += 1) {
      await page.waitForTimeout(100)
      applied = selectedThemeId(await userSettings(page))
    }
    notStrictEqual(applied, selectedThemeId(before), 'Apply writes the chosen theme')
    ok((await background(page)) !== saved, 'The applied theme stays on screen')
    const customization = (
      (await userSettings(page))['workbench.theme.customizations'] as
        | Record<string, Record<string, { palette?: string }>>
        | undefined
    )?.[applied ?? '']
    ok(
      Object.values(customization ?? {}).some((half) => half.palette),
      'Apply saves the edited colors as a palette and points the theme at it',
    )
    await step('applied')

    const appliedLook = {
      background: await background(page),
      primary: await cssToken(page, '--primary'),
    }
    await page.reload()
    await waitForApp(page)
    await page.waitForFunction(
      (look) =>
        getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() ===
        look.primary,
      appliedLook,
    )
    strictEqual(await background(page), appliedLook.background, 'Reload lands on the applied theme')
    await step('reloaded')
  },
}
