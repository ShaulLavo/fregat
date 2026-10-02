import { ok, strictEqual } from 'node:assert/strict'
import { writeSettings } from './native-provider-verification'
import { shellBridge } from '../../../apps/desktop/src/launcher/shell-bridge'
import { selectors, waitForApp } from '../selectors'
import type { Scenario } from './index'

export const nativeWindow: Scenario = {
  name: 'native-window',
  description:
    'Use the native host initialization script, verify a clear page root, and follow traffic-light spacing through full-screen entry and exit.',
  requiresIsolatedServer: true,
  async run(page, { step, server, evidence }) {
    ok(server, 'Window appearance settings use the throwaway server')
    await writeSettings(page, server.origin, [
      {
        kind: 'set',
        key: 'workbench.wallpaper',
        value: { enabled: true, source: { kind: 'desktop' } },
      },
      { kind: 'set', key: 'workbench.surface.opacity', value: 80 },
    ])
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
    const paint = await page.evaluate((selector) => {
      const shell = document.querySelector(selector)?.closest('[aria-busy]')
      return {
        body: getComputedStyle(document.body).backgroundColor,
        shell: shell ? getComputedStyle(shell).backgroundColor : null,
        surfaceOpacity: getComputedStyle(document.documentElement).getPropertyValue(
          '--surface-opacity',
        ),
        wallpaperImages: document.querySelectorAll('[data-workbench-wallpaper-layer]').length,
      }
    }, selectors.desktopFirstScreenSelector)
    await evidence.json('native-window-paint.json', paint)
    strictEqual(paint.surfaceOpacity.trim(), '80%')
    strictEqual(paint.wallpaperImages, 0)
    strictEqual(
      paint.body,
      'rgba(0, 0, 0, 0)',
      'The body must leave native panes their own opacity',
    )
    strictEqual(
      paint.shell,
      'rgba(0, 0, 0, 0)',
      'The shell must leave native panes their own opacity',
    )
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
