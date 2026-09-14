import type { Page } from 'playwright'
import type { Scenario } from './index'
import { selectors } from '../selectors'
import { createScriptError } from '../../structured-errors'

const fontSnapshot = `({
  status: document.fonts.status,
  faces: Array.from(document.fonts, face => ({family: face.family, status: face.status})),
  at: performance.now(),
  delayedLoads: window.__fontLoadDelays ?? 0,
})`

export const demoFontLoad: Scenario = {
  name: 'demo-font-load',
  surface: 'site',
  description: 'Delay editor font loading and verify the demo reveals only the loaded face.',
  inspect: (page) => page.evaluate('window.__demoFontEvidence ?? null'),
  async run(page, { step }) {
    await page.addInitScript(`(() => {
      const load = FontFace.prototype.load;
      FontFace.prototype.load = async function () {
        if (this.family === 'JetBrainsMono Nerd Font') {
          window.__fontLoadDelays = (window.__fontLoadDelays ?? 0) + 1;
          await new Promise(resolve => setTimeout(resolve, 6000));
        }
        return load.call(this);
      };
    })()`)
    const session = await page.context().newCDPSession(page)
    await session.send('Network.clearBrowserCache')
    await session.detach()
    await page.reload({ waitUntil: 'domcontentloaded' })
    await selectors.demoReady(page).waitFor({ timeout: 60_000 })
    const frame = await editorFrame(page)
    const revealed = await frame.evaluate(fontSnapshot)
    await page.evaluate(
      (value) => Object.assign(globalThis, { __demoFontEvidence: { revealed: value } }),
      revealed,
    )
    await step('revealed')
    await frame.waitForFunction(
      `Array.from(document.fonts).some(
      face => face.family === 'JetBrainsMono Nerd Font' && face.status === 'loaded'
    )`,
      undefined,
      { timeout: 15_000 },
    )
    const loaded = await frame.evaluate(fontSnapshot)
    await page.evaluate((value) => Object.assign(globalThis, { __demoFontEvidence: value }), {
      revealed,
      loaded,
    })
    await step('font-loaded')
    const valid = await page.evaluate(`window.__demoFontEvidence.revealed.faces.some(
      face => face.family === 'JetBrainsMono Nerd Font' && face.status === 'loaded'
    )`)
    if (!valid) throw createScriptError('Demo revealed before the editor font was registered.')
  },
}

async function editorFrame(page: Page) {
  const element = await selectors.demoIframe(page).elementHandle()
  const frame = await element?.contentFrame()
  if (!frame) throw createScriptError('The demo iframe did not mount.')
  return frame
}
