import type { Scenario } from './index'
import { selectors } from '../selectors'
import { createScriptError } from '../../structured-errors'
import type { Page } from 'playwright'

export const demoReset: Scenario = {
  name: 'demo-reset',
  surface: 'site',
  inspect: async (page) => (await demoFrame(page)).evaluate('window.__fregatDemo ?? null'),
  description:
    'Edit the embedded real workspace, then use the landing page reset action and verify the seed returns.',
  async run(page, { step }) {
    const frame = await demoFrame(page)
    await step('ready')
    await selectors.demoEditor(page).focus()
    await page.keyboard.press('Control+End')
    await page.keyboard.type('\n// reset-verification\n')
    await page.keyboard.press('Control+s')
    await frame.waitForFunction(
      `async () => {
      const response = await fetch(window.__fregatDemo.apiOrigin + '/fs/read?path=/garden/src/garden.ts');
      return (await response.text()).includes('reset-verification');
    }`,
      undefined,
      { timeout: 15_000 },
    )
    await step('changed')
    await selectors.demoReset(page).click()
    await selectors.demoReady(page).waitFor({ timeout: 60_000 })
    await frame.waitForFunction(
      `async () => {
      const response = await fetch(window.__fregatDemo.apiOrigin + '/fs/read?path=/garden/src/garden.ts');
      return !(await response.text()).includes('reset-verification');
    }`,
      undefined,
      { timeout: 15_000 },
    )
    await step('reset')
  },
}

async function demoFrame(page: Page) {
  const element = await selectors.demoIframe(page).elementHandle()
  const frame = await element?.contentFrame()
  if (!frame) throw createScriptError('The landing page demo iframe did not mount.')
  return frame
}
