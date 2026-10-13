import { notStrictEqual, strictEqual } from 'node:assert/strict'
import { shellBridge } from '../../../apps/desktop/src/launcher/shell-bridge'
import { selectors, waitForApp } from '../selectors'
import type { Scenario } from './index'

export const nativePhoneHeader: Scenario = {
  name: 'native-phone-header',
  description:
    'Narrow a native macOS window into the phone shell and check traffic-light spacing through full-screen entry, exit, and a regular phone browser.',
  requiresIsolatedServer: true,
  capture: { width: 600, height: 900 },
  async run(page, { step }) {
    const desktopViewport = { width: 1440, height: 1000 }
    await page.addInitScript({
      content:
        `globalThis.webkit = { messageHandlers: { platformShell: { postMessage() {} } } };\n` +
        shellBridge(page.url(), 'wkwebview', 'fixture-token', 'darwin', true) +
        `
        if (sessionStorage.getItem('fixture-phone-browser') === 'true') {
          delete globalThis.platformBridge;
          delete globalThis.__platformShell;
        }
        `,
    })
    await page.setViewportSize(desktopViewport)
    await page.reload()
    await waitForApp(page)
    const projectArea = selectors.windowToolbar(page).locator(':scope > div').first()
    const windowedPadding = await projectArea.evaluate(
      (element) => getComputedStyle(element).paddingLeft,
    )
    strictEqual(windowedPadding, '76px', 'The desktop reserves the native traffic lights')
    await step('native-desktop-windowed')

    await page.setViewportSize({ width: 600, height: 900 })
    const phoneHeader = selectors.phoneHeader(page)
    await phoneHeader.waitFor()
    await step('native-phone-windowed')
    strictEqual(
      await phoneHeader.evaluate((element) => getComputedStyle(element).paddingLeft),
      windowedPadding,
      'The phone header reserves the native traffic lights',
    )
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-native-fullscreen', '')
      window.dispatchEvent(new Event('platform-native-window-state'))
    })
    notStrictEqual(
      await phoneHeader.evaluate((element) => getComputedStyle(element).paddingLeft),
      windowedPadding,
      'Full-screen entry removes the phone traffic-light inset',
    )
    await step('native-phone-fullscreen')
    await page.evaluate(() => {
      document.documentElement.removeAttribute('data-native-fullscreen')
      window.dispatchEvent(new Event('platform-native-window-state'))
    })
    strictEqual(
      await phoneHeader.evaluate((element) => getComputedStyle(element).paddingLeft),
      windowedPadding,
      'Full-screen exit restores the phone traffic-light inset',
    )
    await step('native-phone-windowed-restored')
    await page.setViewportSize(desktopViewport)
    await selectors.windowToolbar(page).waitFor()
    strictEqual(
      await projectArea.evaluate((element) => getComputedStyle(element).paddingLeft),
      windowedPadding,
      'Widening restores the desktop traffic-light inset',
    )
    await step('native-desktop-after-resize')

    await page.evaluate(() => sessionStorage.setItem('fixture-phone-browser', 'true'))
    await page.setViewportSize({ width: 390, height: 844 })
    await page.reload()
    await waitForApp(page)
    await phoneHeader.waitFor()
    notStrictEqual(
      await phoneHeader.evaluate((element) => getComputedStyle(element).paddingLeft),
      windowedPadding,
      'A phone browser uses its normal header padding',
    )
    await step('phone-browser-header')
  },
}
