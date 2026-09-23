import { BOOT_MIRROR_KEY } from '../../../apps/web/src/lib/boot-keys'
import type { Scenario } from './index'
import { waitForApp } from '../selectors'
import { createScriptError } from '../../structured-errors'

type Handoff = { href: string; status: string } | null

export const wallpaperBootHandoff: Scenario = {
  name: 'wallpaper-boot-handoff',
  description:
    'A macOS tab booting with the desktop wallpaper preloads it and hands the outcome to the app as a record, not a link attribute.',
  async run(page, { step }) {
    // Linux composites over the real desktop and preloads nothing, and a theme's own wallpaper
    // wins over the desktop one, so the boot has to see a macOS tab and a theme-less mirror.
    await page.addInitScript((key) => {
      Object.defineProperty(navigator, 'userAgentData', { value: { platform: 'macOS' } })
      localStorage.setItem(
        key,
        JSON.stringify({ 'workbench.wallpaper': { enabled: true, source: { kind: 'desktop' } } }),
      )
    }, BOOT_MIRROR_KEY)
    await page.reload()
    await waitForApp(page)
    await page
      .waitForFunction(() => window.platformBootWallpaper?.status === 'ready', null, {
        timeout: 15_000,
      })
      .catch(async () => {
        const handoff = await page.evaluate<Handoff>(() => window.platformBootWallpaper ?? null)
        throw createScriptError(`The boot preload never reported ready: ${JSON.stringify(handoff)}`)
      })
    await step('handed-over')

    const handoff = await page.evaluate<Handoff>(() => window.platformBootWallpaper ?? null)
    if (!handoff?.href.endsWith('/wallpaper/still')) {
      throw createScriptError(`The record names the wrong wallpaper: ${JSON.stringify(handoff)}`)
    }
  },
}
