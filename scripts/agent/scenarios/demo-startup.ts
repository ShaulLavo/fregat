import type { Scenario } from './index'
import { selectors } from '../selectors'
import { createScriptError } from '../../structured-errors'

export const demoStartup: Scenario = {
  name: 'demo-startup',
  surface: 'site',
  description: 'Verify the real demo stays visible during startup without a screenshot preview.',
  inspect: (page) => page.evaluate('window.__demoStartup ?? null'),
  async run(page, { step }) {
    await page.reload({ waitUntil: 'domcontentloaded' })
    const visible = await selectors.demoIframe(page).isVisible()
    const previews = await selectors.demoPreview(page).count()
    await page.evaluate((value) => Object.assign(globalThis, { __demoStartup: value }), {
      visible,
      previews,
    })
    await step('loading')
    await selectors.demoReady(page).waitFor({ timeout: 60_000 })
    await step('ready')
    if (previews !== 0) throw createScriptError('Startup still contains a screenshot preview.')
    if (!visible) throw createScriptError('The real app iframe is hidden during startup.')
  },
}
