import { notStrictEqual, ok, strictEqual } from 'node:assert/strict'
import type { Page } from 'playwright'
import { runPaletteCommand, selectors } from '../selectors'
import { serverApi } from '../server-api'
import type { Scenario } from './index'

type UserSettings = Readonly<Record<string, unknown>>

async function userSettings(page: Page): Promise<UserSettings> {
  const { base, headers } = serverApi(page)
  const document = (await (await page.request.get(`${base}/settings`, { headers })).json()) as {
    layers: { id: string; raw: UserSettings }[]
  }
  return document.layers.find((layer) => layer.id === 'user')?.raw ?? {}
}

function themeId(settings: UserSettings) {
  return (settings['workbench.theme'] as { id?: string } | undefined)?.id ?? null
}

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
    strictEqual(themeId(await userSettings(page)), themeId(before), 'Browsing writes nothing')

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
    strictEqual(themeId(await userSettings(page)), themeId(before), 'Editing colors writes nothing')

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
    await dock.getByText('Press Escape again to discard').waitFor()
    await page.keyboard.press('Escape')
    await dock.waitFor({ state: 'detached' })
    await page.waitForFunction(
      (value) =>
        getComputedStyle(document.documentElement).getPropertyValue('--background').trim() ===
        value,
      saved,
    )
    strictEqual(themeId(await userSettings(page)), themeId(before), 'Discarding writes nothing')
    await step('discarded')

    await runPaletteCommand(page, 'Theme studio')
    await dock.waitFor()
    await page.keyboard.press('ArrowRight')
    await repainted(page, saved)
    await selectors.themeStudioTab(page, 'Colors').click()
    await setAccent(page, await cssToken(page, '--primary'))
    await dock.getByRole('button', { name: 'Apply', exact: true }).click()
    await dock.waitFor({ state: 'detached' })
    await page.waitForFunction(async () => true)
    let applied = themeId(await userSettings(page))
    for (let attempt = 0; attempt < 20 && applied === themeId(before); attempt += 1) {
      await page.waitForTimeout(100)
      applied = themeId(await userSettings(page))
    }
    notStrictEqual(applied, themeId(before), 'Apply writes the chosen theme')
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
  },
}
