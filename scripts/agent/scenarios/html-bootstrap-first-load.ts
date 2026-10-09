import { holdSettingsResponses } from '../hold-settings'
import { strictEqual } from 'node:assert/strict'
import type { Request } from 'playwright'
import { BOOT_MIRROR_KEY } from '../../../apps/web/src/lib/boot-keys'
import { writeUserOperations } from '../preserve-settings'
import { selectors, waitForApp, wallpaperMediaSelector } from '../selectors'
import { serverApi } from '../server-api'
import type { Scenario } from './index'

export const wallpaperFirstLoad: Scenario = {
  name: 'wallpaper-first-load',
  description:
    'A fresh phone opens while settings are held, then confirms wallpaper off without painting or fetching a wallpaper.',
  requiresIsolatedServer: true,
  capture: { width: 390, height: 844, scale: 2, touch: true },
  async run(page, { step, evidence }) {
    await writeUserOperations(page, [
      { kind: 'set', key: 'workbench.theme', value: null },
      {
        kind: 'set',
        key: 'workbench.wallpaper',
        value: { enabled: false, source: { kind: 'desktop' } },
      },
    ])
    const { base } = serverApi(page)
    const hold = await holdSettingsResponses(page, base)
    const wallpaperRequests: string[] = []
    const observe = (request: Request) => {
      if (
        /\/wallpaper(?:\/|$)|\/wallpaper\.jpg|\/themes\/wallpapers\/.+\/display/.test(request.url())
      )
        wallpaperRequests.push(request.url())
    }
    page.on('request', observe)
    await page.addInitScript(
      ({ key, selector }) => {
        if (!sessionStorage.getItem('wallpaper-first-load-initialized'))
          localStorage.removeItem(key)
        sessionStorage.setItem('wallpaper-first-load-initialized', 'true')
        const frames: number[] = []
        Object.assign(window, { wallpaperFirstLoadFrames: frames })
        const sample = () => {
          frames.push(document.querySelectorAll(selector).length)
          requestAnimationFrame(sample)
        }
        requestAnimationFrame(sample)
      },
      { key: BOOT_MIRROR_KEY, selector: wallpaperMediaSelector },
    )
    try {
      await page.reload({ waitUntil: 'domcontentloaded' })
      await hold.requested
      await waitForApp(page)
      await step('app-open-settings-held')
      const before = await selectors.wallpaperMedia(page).count()
      const confirmed = page.waitForResponse(`${base}/settings`)
      hold.resume()
      await confirmed
      strictEqual((await (await confirmed).json()).values['workbench.wallpaper'].enabled, false)
      await page.waitForFunction(() =>
        document.documentElement.hasAttribute('data-wallpaper-hidden'),
      )
      await step('confirmed-wallpaper-off')
      const frames = await page.evaluate<number[]>('window.wallpaperFirstLoadFrames')
      await evidence.json('first-load-wallpaper.json', { before, frames, wallpaperRequests })
      strictEqual(before, 0, 'The app opens with no wallpaper while settings are unknown')
      strictEqual(Math.max(...frames), 0, 'No startup frame mounts a wallpaper')
      strictEqual(wallpaperRequests.length, 0, 'Wallpaper off makes no wallpaper requests')
      await page.reload({ waitUntil: 'domcontentloaded' })
      await waitForApp(page)
      await step('cached-wallpaper-off')
      strictEqual(await selectors.wallpaperMedia(page).count(), 0, 'Cached off stays off')
      strictEqual(wallpaperRequests.length, 0, 'Cached off makes no wallpaper requests')
    } finally {
      hold.resume()
      page.off('request', observe)
      await hold.close()
    }
  },
}

export const desktopWallpaperFirstLoad: Scenario = {
  ...wallpaperFirstLoad,
  name: 'desktop-wallpaper-first-load',
  description: 'A fresh desktop confirms wallpaper off without painting or fetching a wallpaper.',
  capture: { width: 1440, height: 1000, scale: 1, touch: false },
}
