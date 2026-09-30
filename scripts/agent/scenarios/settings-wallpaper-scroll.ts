import { ok } from 'node:assert/strict'
import { chords, pressShortcut, selectors } from '../selectors'
import type { Scenario } from './index'

export const settingsWallpaperScroll: Scenario = {
  name: 'settings-wallpaper-scroll',
  description:
    'Rapidly scroll the phone Settings page through Appearance into Wallpaper, without changing appearance.',
  capture: { width: 390, height: 844, touch: true },
  async run(page, { step }) {
    await pressShortcut(page, chords.settings)
    await selectors.settingsRow(page, 'keybindings.overrides').waitFor({ state: 'attached' })
    await step('settings-ready')
    const form = selectors.settingsForm(page)
    const wallpaper = selectors.settingsRow(page, 'workbench.wallpaper')
    await form.hover()
    for (let index = 0; index < 10; index++) {
      const box = await wallpaper.boundingBox()
      if (box && box.y < 650) break
      await page.mouse.wheel(0, 600)
      await page.waitForTimeout(80)
    }
    await wallpaper.scrollIntoViewIfNeeded()
    await step('wallpaper-arrival')
    await page.waitForTimeout(800)
    await step('wallpaper-visible')
    ok(
      (await wallpaper.locator('img').count()) > 0,
      'the wallpaper library contains preview images',
    )
  },
  async inspect(page) {
    return {
      images: await selectors
        .settingsRow(page, 'workbench.wallpaper')
        .locator('img')
        .evaluateAll((nodes) =>
          nodes.flatMap((node) =>
            node instanceof HTMLImageElement
              ? [
                  {
                    url: node.currentSrc,
                    width: node.naturalWidth,
                    height: node.naturalHeight,
                    decoding: node.decoding,
                    displayedWidth: Math.round(node.getBoundingClientRect().width),
                  },
                ]
              : [],
          ),
        ),
    }
  },
}
