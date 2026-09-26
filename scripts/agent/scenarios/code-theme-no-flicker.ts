import { notStrictEqual, ok, strictEqual } from 'node:assert/strict'
import type { Locator, Page } from 'playwright'
import { countBlankFrames, recordFrames } from '../blank-frames'
import { chords, runPaletteCommand, selectors } from '../selectors'
import type { Scenario } from './index'

type PreviewFrame = { id: string | null; label: string | null }

async function delayThemes(page: Page) {
  await page.route(/\/themes\/dist\/.*\.mjs/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 500))
    await route.continue()
  })
}

async function arrowThroughThemes(
  page: Page,
  list: Locator,
  step: Parameters<Scenario['run']>[1]['step'],
) {
  const content = page.locator(selectors.codeThemePreviewContentSelector)
  const header = page.locator(selectors.codeThemePreviewHeaderSelector)
  const labels = new Map([
    [await content.getAttribute('data-theme-id'), await header.textContent()],
  ])
  const samples = await recordFrames<PreviewFrame>(
    page,
    `() => ({
    id: document.querySelector(${JSON.stringify(selectors.codeThemePreviewContentSelector)})?.getAttribute('data-theme-id') ?? null,
    label: document.querySelector(${JSON.stringify(selectors.codeThemePreviewHeaderSelector)})?.textContent ?? null,
  })`,
    async () => {
      const blank = await countThemeSwitches(page, list, labels, step)
      await step(`blank-frames-${blank}`)
      strictEqual(blank, 0, 'Every frame keeps a highlighted code theme sample')
    },
  )
  ok(samples.length > 0, 'The sampler observed rendered frames')
  for (const sample of samples) {
    strictEqual(
      sample.label,
      labels.get(sample.id),
      'The header and highlighted body name the same theme',
    )
  }
  await step('header-body-mismatches-0')
}

async function countThemeSwitches(
  page: Page,
  list: Locator,
  labels: Map<string | null, string | null>,
  step: Parameters<Scenario['run']>[1]['step'],
) {
  return countBlankFrames(page, selectors.codeThemePreviewContentSelector, async () => {
    for (let index = 0; index < 3; index += 1) {
      await arrowToTheme(page, list, labels, step, index)
    }
  })
}

async function arrowToTheme(
  page: Page,
  list: Locator,
  labels: Map<string | null, string | null>,
  step: Parameters<Scenario['run']>[1]['step'],
  index: number,
) {
  const content = page.locator(selectors.codeThemePreviewContentSelector)
  const header = page.locator(selectors.codeThemePreviewHeaderSelector)
  const previousId = await content.getAttribute('data-theme-id')
  await page.keyboard.press('ArrowDown')
  await page.waitForTimeout(150)
  await step(`switch-${index}-waiting`)
  await page.waitForTimeout(800)
  const selected = await list.getByRole('option', { selected: true }).innerText()
  strictEqual(
    await header.textContent(),
    selected.trim(),
    'The settled label follows the selected row',
  )
  const nextId = await content.getAttribute('data-theme-id')
  notStrictEqual(nextId, previousId, 'The replacement paints after loading')
  labels.set(nextId, await header.textContent())
}

export const paletteThemeNoFlicker: Scenario = {
  name: 'palette-theme-no-flicker',
  description:
    'Arrow through cold code themes and verify the palette keeps each label with its sample.',
  async run(page, { step }) {
    await delayThemes(page)
    await page.keyboard.press(chords.commandPalette)
    await selectors.paletteInput(page).fill('code ')
    await page.locator(selectors.codeThemePreviewContentSelector).waitFor()
    await step('first-preview')
    await arrowThroughThemes(page, selectors.codeThemeDialog(page), step)
    await page.keyboard.press('Escape')
  },
}

export const studioThemeNoFlicker: Scenario = {
  name: 'studio-theme-no-flicker',
  description:
    'Arrow through cold code themes and verify the studio keeps each label with its sample.',
  async run(page, { step }) {
    await delayThemes(page)
    await runPaletteCommand(page, 'Theme studio')
    await selectors.themeStudioTab(page, 'Code').click()
    await page.locator(selectors.codeThemePreviewContentSelector).waitFor()
    const list = selectors.studioCodeColors(page)
    await list.focus()
    await page.keyboard.press('Home')
    await page.waitForTimeout(1000)
    await step('first-preview')
    await arrowThroughThemes(page, list, step)
  },
}
