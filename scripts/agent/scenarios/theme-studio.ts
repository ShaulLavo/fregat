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

function background(page: Page) {
  return page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--background').trim(),
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
    'Open the theme studio, arrow through themes with the app repainting and nothing written, flip light and dark, discard with Escape twice, then choose again and Apply in one write.',
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
    await step('applied')
  },
}
