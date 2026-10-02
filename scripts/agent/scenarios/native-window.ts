import { strictEqual } from 'node:assert/strict'
import { shellBridge } from '../../../apps/desktop/src/launcher/shell-bridge'
import { selectors, waitForApp } from '../selectors'
import type { Scenario } from './index'

export const nativeWindow: Scenario = {
  name: 'native-window',
  description:
    'Use the native host initialization script, verify a clear page root, and follow traffic-light spacing through full-screen entry and exit.',
  async run(page, { step }) {
    await page.addInitScript({
      content:
        `globalThis.webkit = { messageHandlers: { platformShell: { postMessage() {} } } };
        Object.defineProperty(navigator, 'userAgentData', { value: { platform: 'macOS' } });
        const publishWindowState = () => {
          document.documentElement.toggleAttribute('data-native-fullscreen', sessionStorage.getItem('fixture-native-fullscreen') === 'true');
          window.dispatchEvent(new Event('platform-native-window-state'));
        };
        if (document.documentElement) publishWindowState();
        else {
          const observer = new MutationObserver(() => {
            if (!document.documentElement) return;
            observer.disconnect();
            publishWindowState();
          });
          observer.observe(document, { childList: true });
        }\n` + shellBridge(page.url(), 'wkwebview', 'fixture-token', 'darwin', true),
    })
    await page.reload()
    await waitForApp(page)
    strictEqual(
      await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor),
      'rgba(0, 0, 0, 0)',
    )
    strictEqual(
      await page.evaluate(() => document.documentElement.getAttribute('data-backdrop')),
      'transparent',
    )
    const projectArea = selectors.windowToolbar(page).locator(':scope > div').first()
    const windowedPadding = await projectArea.evaluate(
      (element) => getComputedStyle(element).paddingLeft,
    )
    strictEqual(windowedPadding, '76px')
    await step('native-transparent-root-windowed')
    await page.evaluate(() => {
      sessionStorage.setItem('fixture-native-fullscreen', 'true')
      document.documentElement.setAttribute('data-native-fullscreen', '')
      window.dispatchEvent(new Event('platform-native-window-state'))
    })
    await page.waitForFunction(
      (selector) =>
        !document.querySelector(selector)?.firstElementChild?.classList.contains('pl-[4.75rem]'),
      selectors.desktopFirstScreenSelector,
    )
    await step('native-fullscreen-inset-removed')
    const previousDocument = await page.evaluate(() => performance.timeOrigin)
    await page.reload()
    await waitForApp(page)
    strictEqual(
      await page.evaluate((previous) => performance.timeOrigin > previous, previousDocument),
      true,
    )
    await page.waitForFunction(
      (selector) =>
        document.documentElement.hasAttribute('data-native-fullscreen') &&
        !document.querySelector(selector)?.firstElementChild?.classList.contains('pl-[4.75rem]'),
      selectors.desktopFirstScreenSelector,
    )
    await step('native-fullscreen-reloaded-inset-removed')
    await page.evaluate(() => {
      sessionStorage.removeItem('fixture-native-fullscreen')
      document.documentElement.removeAttribute('data-native-fullscreen')
      window.dispatchEvent(new Event('platform-native-window-state'))
    })
    await page.waitForFunction(
      (selector) =>
        document.querySelector(selector)?.firstElementChild?.classList.contains('pl-[4.75rem]'),
      selectors.desktopFirstScreenSelector,
    )
    strictEqual(
      await projectArea.evaluate((element) => getComputedStyle(element).paddingLeft),
      windowedPadding,
    )
    await step('native-windowed-inset-restored')
  },
}
