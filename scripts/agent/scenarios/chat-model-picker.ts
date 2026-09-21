import type { Scenario } from './index'
import { selectors, settleAnimations } from '../selectors'

// The panel fades and scales in. A frame captured mid-enter reads as a
// transparent, collapsed panel, so every step waits the animation out.

/**
 * Opens the composer's provider/model panel, searches it, and closes it.
 * Selects nothing, so the session keeps whatever model it already had.
 */
export const chatModelPicker: Scenario = {
  name: 'chat-model-picker',
  description:
    'Open the composer model picker, hover its trigger, search the list and close it. Selects no model.',
  async run(page, { step }) {
    await selectors.workspaceMode(page, 'Chat').click()
    await selectors.chatNewSession(page).click()

    const trigger = selectors.modelPickerTrigger(page)
    await trigger.waitFor({ timeout: 20_000 })
    await page.mouse.move(0, 0)
    await trigger.hover()
    await step('trigger-hover')

    await trigger.click()
    const panel = selectors.modelPickerPanel(page)
    await panel.waitFor({ timeout: 10_000 })
    await settleAnimations(panel)
    await step('panel-open')

    await selectors.modelPickerSearch(page).fill('opus')
    await settleAnimations(panel)
    await step('panel-search')

    await page.keyboard.press('Escape')
    await panel.waitFor({ state: 'hidden' })
    await step('panel-closed')
  },
}
