import { ok } from 'node:assert/strict'
import type { Page } from 'playwright'
import * as v from 'valibot'
import { themeBundleSchema, type ThemeBundle } from '../../../packages/contracts/src/index'
import { preserveAppearance } from '../preserve-settings'
import { chords, selectors } from '../selectors'
import type { Scenario } from './index'

async function mode(page: Page, value: 'light' | 'dark') {
  await page.keyboard.press(chords.commandPalette)
  await selectors.paletteInput(page).fill('>Choose light / dark mode')
  await selectors.commandOption(page, 'Choose light / dark mode').click()
  await selectors.colorModeOption(page, value).click()
  await selectors.paletteInput(page).waitFor({ state: 'hidden' })
}

function pairedAsset(theme: ThemeBundle, variant: 'light' | 'dark') {
  const selection = theme.variants[variant].wallpaper
  ok(selection.enabled && selection.source.kind === 'library', `${theme.id} ${variant} pairs`)
  return selection.source.asset
}

export const bundleWallpapers: Scenario = {
  name: 'bundle-wallpapers',
  description:
    'Select every bundled theme from the gallery in dark and light and wait for its paired wallpaper to paint. Restores the original settings.',
  async run(page, { step }) {
    const url = new URL(page.url())
    const base = url.pathname.startsWith('/platform/')
      ? `${url.origin}/platform`
      : 'http://localhost:3001'
    const headers = { origin: url.origin }
    const restore = await preserveAppearance(page)
    try {
      const library = v.parse(
        v.array(themeBundleSchema),
        await (await page.request.get(`${base}/themes/bundles`, { headers })).json(),
      )
      const bundled = library.filter((theme) => theme.source === 'bundled')
      ok(bundled.length >= 6, 'Six bundled themes are listed')
      await page.keyboard.press('Control+,')
      await selectors.settingsSearch(page).fill('Theme bundles')
      for (const variant of ['dark', 'light'] as const) {
        await mode(page, variant)
        for (const theme of bundled) {
          await selectors.themeCard(page, theme.id).click()
          const image = selectors.wallpaperAsset(page, pairedAsset(theme, variant))
          await image.waitFor()
          await image.evaluate((element) => (element as HTMLImageElement).decode())
          await step(`${theme.id}-${variant}`)
        }
      }
    } finally {
      await restore()
    }
  },
}
