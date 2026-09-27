import type { Page } from 'playwright'
import { selectors } from '../selectors'
import type { Scenario } from './index'

let report: unknown = null

export const phoneColdBoot: Scenario = {
  name: 'phone-cold-boot',
  description:
    'Cold phone first screen at 1.125 MB/s, 150 ms latency and 4x CPU, with request initiators and bytes.',
  capture: { width: 390, height: 844, scale: 2, touch: true },
  run: (page, context) => coldBoot(page, context, true),
  inspect: async () => report,
}

export const desktopColdBoot: Scenario = {
  name: 'desktop-cold-boot',
  description: 'Cold desktop boot to the window toolbar, with request initiators and bytes.',
  run: (page, context) => coldBoot(page, context, false),
  inspect: async () => report,
}

async function coldBoot(page: Page, { step }: Parameters<Scenario['run']>[1], phone: boolean) {
  const cdp = await page.context().newCDPSession(page)
  const requests: unknown[] = []
  cdp.on('Network.requestWillBeSent', (event) => requests.push(event))
  await cdp.send('Network.enable')
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
  if (phone) {
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 150,
      downloadThroughput: 1_125_000,
      uploadThroughput: 187_500,
    })
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
  }
  const selector = phone ? selectors.phoneFirstScreenSelector : selectors.desktopFirstScreenSelector
  await page.addInitScript(`(() => {
    window.__coldBoot = null
    const sample = () => {
      if (!document.querySelector(${JSON.stringify(selector)})) return requestAnimationFrame(sample)
      requestAnimationFrame(() => {
        window.__coldBoot = {
          firstScreenMs: performance.now(),
          document: performance.getEntriesByType('navigation').map(entry => ({
            encoded: entry.encodedBodySize, transfer: entry.transferSize,
          })),
          resources: performance.getEntriesByType('resource').map(entry => ({
            name: entry.name, start: entry.startTime, end: entry.responseEnd,
            encoded: entry.encodedBodySize, decoded: entry.decodedBodySize, transfer: entry.transferSize,
            initiator: entry.initiatorType,
          })),
        }
      })
    }
    requestAnimationFrame(sample)
  })()`)
  await page.reload({ waitUntil: 'commit' })
  await page.waitForFunction('window.__coldBoot !== null', undefined, { timeout: 60_000 })
  report = { ...(await page.evaluate<Record<string, unknown>>('window.__coldBoot')), requests }
  await step('first-screen')
  await cdp.detach()
}
