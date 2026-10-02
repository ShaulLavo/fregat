import { ok, strictEqual } from 'node:assert/strict'
import { selectors, waitForApp } from '../selectors'
import type { Scenario } from './index'

export const installedApp: Scenario = {
  name: 'installed-app',
  description:
    'Open a bridge-free installed-like client, change WCO control edges, deliver a focus-only launch, and use the server-filesystem picker with unverified locality.',
  async run(page, { step }) {
    await page.addInitScript(() => {
      const media = window.matchMedia.bind(window)
      window.matchMedia = (query) => {
        const result = media(query)
        if (query.startsWith('(display-mode:'))
          Object.defineProperty(result, 'matches', {
            value: query === '(display-mode: window-controls-overlay)',
          })
        return result
      }
      let visible = true
      let rect = { x: 80, y: 0, width: window.innerWidth - 80, height: 40 }
      const overlay = new EventTarget()
      Object.defineProperty(overlay, 'visible', { get: () => visible })
      Object.assign(overlay, { getTitlebarAreaRect: () => rect })
      Object.defineProperty(navigator, 'windowControlsOverlay', { value: overlay })
      let consumer: ((launch: { targetURL?: string }) => void) | undefined
      Object.defineProperty(window, 'launchQueue', {
        value: {
          setConsumer: (next: typeof consumer) => {
            consumer = next
          },
        },
      })
      Object.assign(window, {
        installedAppProbe: {
          geometry(x: number, width: number, show = true) {
            visible = show
            rect = { ...rect, x, width }
            overlay.dispatchEvent(new Event('geometrychange'))
          },
          launch(targetURL: string) {
            consumer?.({ targetURL })
          },
        },
      })
    })
    await page.reload()
    await waitForApp(page)
    const toolbar = selectors.windowToolbar(page)
    await toolbar.waitFor()
    strictEqual(await page.evaluate(() => 'platformBridge' in window), false)
    await page.waitForFunction(
      (selector) => document.querySelector<HTMLElement>(selector)?.style.marginLeft === '80px',
      selectors.desktopFirstScreenSelector,
    )
    await step('installed-like-controls-left')
    const before = page.url()
    await page.evaluate(() => {
      const host = window as unknown as {
        installedAppProbe: {
          launch(url: string): void
          geometry(x: number, width: number, show?: boolean): void
        }
      }
      host.installedAppProbe.launch(new URL('./', location.href).href)
      host.installedAppProbe.launch('https://outside.example/platform/?workspace=unexpected')
      host.installedAppProbe.geometry(0, window.innerWidth - 140)
    })
    strictEqual(page.url(), before)
    await page.waitForFunction(
      (selector) => document.querySelector<HTMLElement>(selector)?.style.marginLeft === '0px',
      selectors.desktopFirstScreenSelector,
    )
    const drag = await toolbar.evaluate((element) =>
      getComputedStyle(element).getPropertyValue('-webkit-app-region'),
    )
    strictEqual(drag, 'drag')
    const noDrag = await selectors
      .projectMenu(page)
      .evaluate((element) => getComputedStyle(element).getPropertyValue('-webkit-app-region'))
    strictEqual(noDrag, 'no-drag')
    await step('installed-like-controls-right-focus-retained')
    await page.evaluate(() => {
      const host = window as unknown as {
        installedAppProbe: { geometry(x: number, width: number, show?: boolean): void }
      }
      host.installedAppProbe.geometry(0, window.innerWidth, false)
    })
    await page.waitForFunction(
      (selector) => document.querySelector<HTMLElement>(selector)?.style.width === '',
      selectors.desktopFirstScreenSelector,
    )
    await step('browser-owned-titlebar-overlay-off')
    await selectors.projectMenu(page).click()
    await selectors.openFolderMenu(page).click()
    await selectors.pickerDialog(page).waitFor()
    ok(await selectors.pickerSearch(page).isVisible())
    await step('unverified-locality-server-filesystem-picker')
    await page.keyboard.press('Escape')
  },
}
