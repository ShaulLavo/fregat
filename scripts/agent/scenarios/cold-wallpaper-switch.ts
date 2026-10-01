import { ok, strictEqual } from 'node:assert/strict'
import type { Page, Request } from 'playwright'
import * as v from 'valibot'
import { themeBundleSchema } from '../../../packages/contracts/src/index'
import { preserveAppearance } from '../preserve-settings'
import {
  chooseColorMode,
  runPaletteCommand,
  selectors,
  wallpaperImageSelector,
  wallpaperStillSelector,
} from '../selectors'
import { serverApi } from '../server-api'
import type { Scenario } from './index'

type WallpaperFrame = {
  readonly phase: 'response' | 'decode' | 'settled'
  readonly oldMounted: boolean
  readonly oldPainted: boolean
  readonly replacementPainted: boolean
  readonly blank: boolean
}

// Delay the browser's real decode result, leaving the app's state and handlers untouched.
async function observeSwitch(page: Page, previous: string, replacement: string) {
  await page.evaluate(`(() => {
    const selector = ${JSON.stringify(wallpaperStillSelector)};
    const allImages = ${JSON.stringify(wallpaperImageSelector)};
    const previous = ${JSON.stringify(previous)};
    const replacement = ${JSON.stringify(replacement)};
    const oldImage = [...document.querySelectorAll(selector)].find(image => image.src.includes(previous));
    const decode = HTMLImageElement.prototype.decode;
    let releaseDecode;
    const decodeGate = new Promise(resolve => { releaseDecode = resolve; });
    const probe = {
      frames: [], running: true, phase: 'response', decodeArrived: false,
      releaseDecode,
      restoreDecode: () => { HTMLImageElement.prototype.decode = decode; },
    };
    window.__coldWallpaperSwitch = probe;
    HTMLImageElement.prototype.decode = async function() {
      await decode.call(this);
      if (!this.src.includes(replacement)) return;
      probe.decodeArrived = true;
      await decodeGate;
    };
    function painted(image) {
      if (!image?.isConnected || !image.complete || image.naturalWidth === 0) return false;
      const bounds = image.getBoundingClientRect();
      if (bounds.width === 0 || bounds.height === 0) return false;
      for (let node = image; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
      }
      return true;
    }
    function sample() {
      if (!probe.running) return;
      const images = [...document.querySelectorAll(selector)];
      const oldPainted = oldImage?.src.includes(previous) && painted(oldImage);
      const replacementPainted = images.some(image => image.src.includes(replacement) && painted(image));
      probe.frames.push({
        phase: probe.phase,
        oldMounted: oldImage?.isConnected === true,
        oldPainted: oldPainted === true,
        replacementPainted,
        blank: ![...document.querySelectorAll(allImages)].some(painted),
      });
      requestAnimationFrame(sample);
    }
    requestAnimationFrame(sample);
  })()`)
}

async function waitForFrames(page: Page, phase: WallpaperFrame['phase']) {
  const count = `window.__coldWallpaperSwitch.frames.filter(frame => frame.phase === ${JSON.stringify(phase)}).length`
  const before = await page.evaluate<number>(count)
  await page.waitForFunction(`${count} >= ${before + 8}`)
}

export const coldWallpaperSwitch: Scenario = {
  name: 'cold-wallpaper-switch',
  requiresIsolatedServer: true,
  description:
    'Switch a saved bundled theme to its unseen light wallpaper with the studio closed; retain the decoded dark image through a held display response and browser decode, then swap with no blank animation frame.',
  async run(page, { step, evidence }) {
    const restore = await preserveAppearance(page)
    const responseGate = Promise.withResolvers<void>()
    let displayRoute: string | undefined
    const displays = new Set<string>()
    const observeDisplay = (request: Request) => {
      if (request.url().endsWith('/display')) displays.add(request.url())
    }
    page.on('request', observeDisplay)
    try {
      const { base, headers } = serverApi(page)
      const themes = v.parse(
        v.array(themeBundleSchema),
        await (await page.request.get(`${base}/themes/bundles`, { headers })).json(),
      )
      const theme = themes.find((entry) => entry.source === 'bundled' && entry.id === 'tokyo-night')
      ok(theme, 'Tokyo Night is a bundled theme')
      const dark = theme.variants.dark.wallpaper.source
      const light = theme.variants.light.wallpaper.source
      ok(dark.kind === 'library' && light.kind === 'library', 'Both variants have library images')
      ok(dark.asset !== light.asset, 'The variants use different wallpaper assets')

      await chooseColorMode(page, 'dark')
      await runPaletteCommand(page, 'Choose theme')
      await selectors.themeBundlePaletteOption(page).filter({ hasText: theme.name }).click()
      await selectors.paletteInput(page).waitFor({ state: 'hidden' })
      await selectors.wallpaperAsset(page, dark.asset).waitFor({ timeout: 20_000 })
      await selectors.wallpaperAsset(page, dark.asset).evaluate('image => image.decode()')
      await step('decoded-dark-wallpaper-studio-closed')
      ok(
        ![...displays].some((url) => url.includes(light.asset)),
        'The replacement display has never been requested in this fresh server and browser',
      )

      displayRoute = `**/themes/wallpapers/${light.asset}/display`
      await page.route(displayRoute, async (route) => {
        await responseGate.promise
        await route.continue()
      })
      await observeSwitch(page, dark.asset, light.asset)
      await waitForFrames(page, 'response')
      await evidence.json(
        'known-good-wallpaper-frames.json',
        await page.evaluate('window.__coldWallpaperSwitch.frames'),
      )
      ok(
        await page.evaluate<boolean>(
          'window.__coldWallpaperSwitch.frames.every(frame => frame.oldMounted && frame.oldPainted && !frame.blank)',
        ),
        'The frame probe observes the known-good decoded dark image before switching',
      )
      const requested = page.waitForRequest(displayRoute, { timeout: 20_000 })
      await chooseColorMode(page, 'light')
      await requested
      await selectors.paletteInput(page).waitFor({ state: 'hidden' })
      strictEqual(await selectors.themeStudio(page).count(), 0, 'The studio remains closed')
      await waitForFrames(page, 'response')
      await step('replacement-display-response-held')

      await page.evaluate("window.__coldWallpaperSwitch.phase = 'decode'")
      responseGate.resolve()
      await page.waitForFunction('window.__coldWallpaperSwitch.decodeArrived', null, {
        timeout: 20_000,
      })
      await waitForFrames(page, 'decode')
      await step('replacement-browser-decode-held')
      await page.evaluate('window.__coldWallpaperSwitch.releaseDecode()')
      await selectors.wallpaperAsset(page, light.asset).waitFor({ timeout: 20_000 })
      await page.evaluate("window.__coldWallpaperSwitch.phase = 'settled'")
      await waitForFrames(page, 'settled')
      await step('decoded-light-wallpaper-swapped')
      const frames = await page.evaluate<WallpaperFrame[]>(`(() => {
        window.__coldWallpaperSwitch.running = false;
        return window.__coldWallpaperSwitch.frames;
      })()`)
      const blank = frames.filter((frame) => frame.blank)
      const lostPrevious = frames.filter(
        (frame) => !frame.replacementPainted && (!frame.oldMounted || !frame.oldPainted),
      )
      await evidence.json('wallpaper-switch-frames.json', {
        previous: dark.asset,
        replacement: light.asset,
        frames,
        blankFrames: blank.length,
        previousLostBeforeReplacement: lostPrevious.length,
      })
      strictEqual(blank.length, 0, 'Every animation frame has a decoded, painted wallpaper')
      strictEqual(
        lostPrevious.length,
        0,
        'The same decoded old image stays mounted and painted until the replacement paints',
      )
      ok(
        frames
          .filter((frame) => frame.phase === 'settled')
          .every((frame) => frame.replacementPainted && !frame.oldPainted),
        'The decoded replacement takes over the painted wallpaper after the swap',
      )
    } catch (error) {
      await step('failed-switch-before-restoration')
      throw error
    } finally {
      page.off('request', observeDisplay)
      responseGate.resolve()
      await page.evaluate(`(() => {
        const probe = window.__coldWallpaperSwitch;
        if (!probe) return;
        probe.running = false;
        probe.releaseDecode();
        probe.restoreDecode();
      })()`)
      if (displayRoute) await page.unroute(displayRoute)
      await restore()
    }
  },
}
