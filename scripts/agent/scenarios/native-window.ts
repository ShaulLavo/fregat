import { deepStrictEqual, notStrictEqual, ok, strictEqual } from 'node:assert/strict'
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
      { kind: 'set', key: 'workbench.surface.blur', value: 24 },
      { kind: 'set', key: 'window.material', value: 'none' },
    ])
    await page.addInitScript({
      content:
        `globalThis.__nativeWindowMessages = [];
        globalThis.webkit = { messageHandlers: { platformShell: { postMessage(body) { globalThis.__nativeWindowMessages.push(body); } } } };
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
        }\n` +
        shellBridge(page.url(), 'wkwebview', 'fixture-token', 'darwin', true) +
        `
        globalThis.platformBridge.capabilities.windowGlass = true;
        if (sessionStorage.getItem('fixture-opaque-browser') === 'true') {
          delete globalThis.platformBridge;
          delete globalThis.__platformShell;
        }
        `,
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
    const readPaint = () =>
      page.evaluate((selector) => {
        const shell = document.querySelector(selector)?.closest('[aria-busy]')
        return {
          body: getComputedStyle(document.body).backgroundColor,
          shell: shell ? getComputedStyle(shell).backgroundColor : null,
          surfaceOpacity: getComputedStyle(document.documentElement).getPropertyValue(
            '--surface-opacity',
          ),
          contentOpacity: getComputedStyle(document.documentElement)
            .getPropertyValue('--content-opacity')
            .trim(),
          surfaceBlur: getComputedStyle(document.documentElement)
            .getPropertyValue('--surface-blur')
            .trim(),
          wallpaperImages: document.querySelectorAll('[data-workbench-wallpaper-layer]').length,
        }
      }, selectors.desktopFirstScreenSelector)
    const paint = await readPaint()
    await page.screenshot({ path: evidence.file('native-window-alpha.png'), omitBackground: true })
    await evidence.json('native-window-paint.json', paint)
    strictEqual(paint.surfaceOpacity.trim(), '80%')
    strictEqual(paint.surfaceBlur, '0px')
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
    const appearanceMessages = () =>
      page.evaluate(() => {
        const messages = (
          globalThis as unknown as {
            __nativeWindowMessages: { method?: string; opacity?: number; material?: string }[]
          }
        ).__nativeWindowMessages
        return messages.filter((message) => message.method === 'setWindowAppearance')
      })
    const waitForAppearance = (opacity: number, material: string) =>
      page.waitForFunction(
        (expected) => {
          const messages = (
            globalThis as unknown as {
              __nativeWindowMessages: { method?: string; opacity?: number; material?: string }[]
            }
          ).__nativeWindowMessages
          const last = messages.filter((message) => message.method === 'setWindowAppearance').at(-1)
          return last?.opacity === expected.opacity && last.material === expected.material
        },
        { opacity, material },
      )
    const firstAppearance = (await appearanceMessages())[0]
    ok(firstAppearance, 'First paint sends window appearance')
    strictEqual(firstAppearance.opacity, 80)
    strictEqual(firstAppearance.material, 'none')
    await page.keyboard.press('Control+,')
    await selectors.settingsSearch(page).fill('Window material')
    const materialControl = selectors.settingsEnum(page, 'Window material')
    await materialControl.waitFor()
    const controlPaint = async () => ({
      selected: await selectors
        .settingsScopeIndicator(page)
        .evaluate((element) => getComputedStyle(element).backgroundColor),
      field: await materialControl.evaluate((element) => getComputedStyle(element).backgroundColor),
    })
    const originalControlPaint = await controlPaint()
    notStrictEqual(originalControlPaint.selected, 'rgba(0, 0, 0, 0)')
    notStrictEqual(originalControlPaint.field, 'rgba(0, 0, 0, 0)')
    await step('native-window-material-default')
    for (const [material, label] of [
      ['frosted', 'Frosted'],
      ['glass', 'Glass'],
      ['none', 'None'],
    ] as const) {
      await materialControl.click()
      await selectors.settingsEnumOption(page, label).click()
      await waitForAppearance(80, material)
      const materialPaint = await readPaint()
      deepStrictEqual(
        await controlPaint(),
        originalControlPaint,
        'Native material preserves selected and field control fills',
      )
      strictEqual(materialPaint.surfaceBlur, '0px')
      strictEqual(materialPaint.surfaceOpacity.trim(), material === 'none' ? '80%' : '0%')
      strictEqual(materialPaint.contentOpacity, material === 'none' ? paint.contentOpacity : '0%')
      await selectors.settingsSearch(page).fill('Pane opacity')
      strictEqual(
        await selectors.settingsSlider(page, 'Pane opacity').isDisabled(),
        material !== 'none',
      )
      await step(`native-window-material-${material}`)
      await selectors.settingsSearch(page).fill('Window material')
    }
    await selectors.settingsSearch(page).fill('Pane opacity')
    const opacityControl = selectors.settingsSlider(page, 'Pane opacity')
    await opacityControl.waitFor()
    await opacityControl.focus()
    await page.keyboard.press('Home')
    await waitForAppearance(0, 'none')
    await step('native-window-opacity-independent')
    await evidence.json('native-window-appearance-messages.json', await appearanceMessages())
    await writeSettings(page, server.origin, [
      { kind: 'set', key: 'workbench.surface.opacity', value: 80 },
    ])
    await page.waitForFunction(
      () =>
        getComputedStyle(document.documentElement).getPropertyValue('--surface-opacity').trim() ===
        '80%',
    )
    await selectors.settingsSearch(page).fill('Backdrop blur')
    strictEqual(await selectors.settingsRow(page, 'workbench.surface.blur').count(), 0)
    await selectors.editorGroupTabs(page, 0).first().click({ button: 'right' })
    await selectors.menuItem(page, 'Close').click()
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
    deepStrictEqual(await readPaint(), paint, 'Reload preserves the clear window underlay')
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
    await page.evaluate(() => sessionStorage.setItem('fixture-opaque-browser', 'true'))
    await page.reload()
    await waitForApp(page)
    strictEqual(
      await page.evaluate(() => document.documentElement.getAttribute('data-backdrop')),
      'app',
    )
    const opaquePaint = await readPaint()
    notStrictEqual(opaquePaint.body, 'rgba(0, 0, 0, 0)')
    notStrictEqual(opaquePaint.shell, 'rgba(0, 0, 0, 0)')
    notStrictEqual(
      await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor),
      'rgba(0, 0, 0, 0)',
    )
    await page.keyboard.press('Control+,')
    await selectors.settingsSearch(page).fill('Window material')
    strictEqual(await selectors.settingsEnum(page, 'Window material').isDisabled(), true)
    await selectors.editorGroupTabs(page, 0).first().click({ button: 'right' })
    await selectors.menuItem(page, 'Close').click()
    await evidence.json('opaque-browser-paint.json', opaquePaint)
    await step('opaque-browser-floor-preserved')
  },
}
