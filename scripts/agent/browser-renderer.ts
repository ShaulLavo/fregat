import type { Browser } from 'playwright'
import type { Evidence } from './evidence'

export async function captureBrowserRenderer(
  browser: Browser,
  evidence: Evidence,
  headed: boolean,
) {
  const engine = browser.browserType().name()
  // GPU details come over CDP, which only Chromium speaks.
  if (engine !== 'chromium') {
    await evidence.json('browser-renderer.json', { headed, engine, version: browser.version() })
    return
  }
  const session = await browser.newBrowserCDPSession()
  try {
    const version = await session.send('Browser.getVersion')
    const system = await session.send('SystemInfo.getInfo')
    await evidence.json('browser-renderer.json', {
      headed,
      version,
      gpu: system.gpu,
      modelName: system.modelName,
      modelVersion: system.modelVersion,
    })
  } finally {
    await session.detach()
  }
}
