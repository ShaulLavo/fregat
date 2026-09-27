import { deepStrictEqual, ok, strictEqual } from 'node:assert/strict'
import type { Page } from 'playwright'
import {
  chooseColorMode,
  runPaletteCommand,
  selectors,
  settleRunningAnimations,
} from '../selectors'
import { selectedThemeId, userSettings, type UserSettings } from '../server-api'
import type { Scenario } from './index'

type Material = { readonly contentOpacity?: number }
type Customizations = Record<string, Partial<Record<'light' | 'dark', { material?: Material }>>>

function contentOpacity(page: Page) {
  return page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--content-opacity').trim(),
  )
}

function editorWell(page: Page) {
  return page.evaluate(() => {
    const well = document.querySelector('[data-editor-group-content]')
    return well ? getComputedStyle(well).backgroundColor : null
  })
}

function shownMode(page: Page) {
  return page.evaluate(() =>
    document.documentElement.classList.contains('dark') ? 'dark' : 'light',
  )
}

// Every settings write in the page's mutation cache, whatever its origin.
function settingsMutations(page: Page) {
  return page.evaluate(() => {
    type Mutation = { options: { mutationKey?: unknown }; state: { variables: unknown } }
    type Client = { getMutationCache(): { getAll(): Mutation[] } }
    const clients = (globalThis as { __fregatQueryClients?: Map<string, Client> })
      .__fregatQueryClients
    return [...(clients?.values() ?? [])].flatMap((client) =>
      client
        .getMutationCache()
        .getAll()
        .filter(
          (mutation) => JSON.stringify(mutation.options.mutationKey) === '["settings","mutation"]',
        )
        .map((mutation) => JSON.stringify(mutation.state.variables)),
    )
  })
}

async function chooseTheme(page: Page) {
  await runPaletteCommand(page, 'Theme studio')
  const dock = selectors.themeStudio(page)
  await dock.waitFor()
  await dock.locator('[data-studio-themes]').focus()
  await page.keyboard.press('ArrowRight')
  await dock.getByRole('button', { name: 'Apply', exact: true }).click()
  await dock.waitFor({ state: 'detached' })
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const id = selectedThemeId(await userSettings(page))
    if (id) return id
    await page.waitForTimeout(100)
  }
  throw new Error('Apply did not select a theme')
}

// The rows directly under the Theme row, from the top of the Appearance section.
async function showAppearance(page: Page) {
  await selectors.settingsSearch(page).fill('')
  const theme = selectors.settingsRow(page, 'workbench.theme')
  await theme.waitFor()
  await theme.evaluate((element) => element.scrollIntoView({ block: 'start' }))
}

// Wallpaper down to Backdrop saturation, the last part row.
async function showLowerRows(page: Page) {
  const last = selectors.settingsRow(page, 'workbench.surface.saturation')
  await last.waitFor()
  await last.evaluate((element) => element.scrollIntoView({ block: 'end' }))
}

// Switching light and dark re-reads every per-mode part row.
async function modeNoted(page: Page, mode: 'light' | 'dark') {
  await page.waitForFunction(
    (dark) => document.documentElement.classList.contains('dark') === dark,
    mode === 'dark',
  )
  await settleRunningAnimations(page)
  const note = mode === 'dark' ? /Dark mode\.$/ : /Light mode\.$/
  for (const id of ['workbench.palette', 'workbench.wallpaper', 'workbench.surface.contentOpacity'])
    await selectors.settingsRow(page, id).getByText(note).waitFor({ timeout: 10_000 })
}

// The range input sits inside the thumb, which sits on the root's track.
async function dragTo(page: Page, slider: ReturnType<typeof selectors.settingsSlider>, at: number) {
  const track = await slider.locator('xpath=ancestor::*[@data-slot="slider"][1]').boundingBox()
  const thumb = await slider.locator('xpath=..').boundingBox()
  ok(track && thumb, 'The slider is on screen')
  const y = thumb.y + thumb.height / 2
  await page.mouse.move(thumb.x + thumb.width / 2, y)
  await page.mouse.down()
  await page.mouse.move(track.x + track.width * at, y, { steps: 12 })
  await page.mouse.up()
}

export const settingsAppearanceRows: Scenario = {
  name: 'settings-appearance-rows',
  description:
    'With a theme selected, the Appearance rows sit under the Theme row and the per-mode parts name the mode on screen, following a light/dark switch. Settings search "content" finds the Content opacity row. Dragging its slider writes one settings mutation (a theme.customize for that mode), repaints --content-opacity and the editor well, and the studio Surfaces tab shows the same number. Writes only the throwaway server.',
  async run(page, { step }) {
    const theme = await chooseTheme(page)
    const mode = await shownMode(page)
    const other = mode === 'dark' ? 'light' : 'dark'
    await page.keyboard.press('Control+,')
    await showAppearance(page)
    await modeNoted(page, mode)
    await step(`appearance-${mode}`)
    await showLowerRows(page)
    await step(`appearance-lower-${mode}`)
    await chooseColorMode(page, other)
    await modeNoted(page, other)
    await showAppearance(page)
    await step(`appearance-${other}`)
    await showLowerRows(page)
    await step(`appearance-lower-${other}`)
    await chooseColorMode(page, mode)
    await modeNoted(page, mode)

    await selectors.settingsSearch(page).fill('content')
    const slider = selectors.settingsSlider(page, 'Content opacity')
    await slider.waitFor()
    const before = { opacity: await contentOpacity(page), well: await editorWell(page) }
    const writesBefore = (await settingsMutations(page)).length
    await step('content-row')

    await dragTo(page, slider, 0.2)
    await page.waitForFunction(
      (was) =>
        getComputedStyle(document.documentElement).getPropertyValue('--content-opacity').trim() !==
        was,
      before.opacity,
    )
    const value = Number(await slider.getAttribute('aria-valuenow'))
    strictEqual(await contentOpacity(page), `${value}%`, '--content-opacity follows the slider')
    ok((await editorWell(page)) !== before.well, 'The editor well repaints')
    await step('dragged')

    const writes = (await settingsMutations(page)).slice(writesBefore)
    strictEqual(writes.length, 1, `One drag is one settings mutation: ${writes.join('\n')}`)
    ok(writes[0]!.includes('theme.customize'), 'A part edit under a theme customizes the theme')
    let saved: UserSettings = {}
    for (let attempt = 0; attempt < 50; attempt += 1) {
      saved = await userSettings(page)
      const halves = (saved['workbench.theme.customizations'] as Customizations | undefined)?.[
        theme
      ]
      if (halves?.[mode]?.material?.contentOpacity === value) break
      await page.waitForTimeout(100)
    }
    deepStrictEqual(
      (saved['workbench.theme.customizations'] as Customizations)[theme]?.[mode]?.material
        ?.contentOpacity,
      value,
      'The theme holds the new value for the mode on screen',
    )
    ok(
      !Object.hasOwn(saved, 'workbench.surface.contentOpacity'),
      'The user file gains no key the theme would ignore',
    )

    await runPaletteCommand(page, 'Theme studio')
    const dock = selectors.themeStudio(page)
    await dock.waitFor()
    await selectors.themeStudioTab(page, 'Surfaces').click()
    strictEqual(
      Number(
        await dock
          .getByRole('slider', { name: 'Content', exact: true })
          .getAttribute('aria-valuenow'),
      ),
      value,
      'The studio shows the value settings wrote',
    )
    await step('studio-surfaces')
    await dock.locator('[data-studio-themes]').or(dock).first().focus()
    await page.keyboard.press('Escape')
    await dock.waitFor({ state: 'detached' })
  },
}
