import { reloadDelayedDemo } from '../demo-startup'
import type { Scenario } from './index'
import { selectors, wallpaperLayerSelector } from '../selectors'
import { createScriptError } from '../../structured-errors'

const captureWallpaper = `(() => {
  if (window.parent === window) return;
  window.__wallpaperFrames = [];
  const started = performance.now();
  function sample() {
    const image = document.querySelector(${JSON.stringify(wallpaperLayerSelector)});
    if (image?.complete && image.naturalWidth > 0) {
      const { x, y, width, height } = image.getBoundingClientRect();
      const bounds = { x, y, width, height };
      const key = JSON.stringify(bounds);
      if (window.__wallpaperFrames.at(-1)?.key !== key) {
        const sceneWidth = innerWidth / 0.85;
        const sceneHeight = innerHeight / 0.84;
        const expected = [(innerWidth - sceneWidth) / 2, (innerHeight - sceneHeight) / 2, sceneWidth, sceneHeight];
        const aligned = Object.values(bounds).every((value, i) => Math.abs(value - expected[i]) < 1);
        window.__wallpaperFrames.push({ ...bounds, key, aligned, at: performance.now() });
      }
    }
    if (performance.now() - started < 15000) requestAnimationFrame(sample);
  }
  requestAnimationFrame(sample);
})()`

export const demoWallpaperStartup: Scenario = {
  name: 'demo-wallpaper-startup',
  surface: 'site',
  description:
    'Keep the embedded wallpaper aligned from its first visible frame through readiness.',
  inspect: async (page) => {
    const frame = await (await selectors.demoIframe(page).elementHandle())?.contentFrame()
    return frame?.evaluate('window.__wallpaperFrames ?? []') ?? null
  },
  async run(page, { step }) {
    await page.addInitScript(captureWallpaper)
    const frame = await reloadDelayedDemo(page, '**/*.ttf', 3000)
    await frame.waitForFunction('window.__wallpaperFrames?.length > 0')
    await step('first-wallpaper')
    await selectors.demoReady(page).waitFor({ timeout: 60_000 })
    await step('ready')
    const aligned = await frame.evaluate<boolean>(
      'window.__wallpaperFrames.every(frame => frame.aligned)',
    )
    if (!aligned)
      throw createScriptError('The wallpaper painted before its final crop was applied.')
  },
}
