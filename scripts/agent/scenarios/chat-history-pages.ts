import { selectors } from '../selectors'
import { isolatedNativeScenario } from './native-provider-verification'

export const chatHistoryPages = isolatedNativeScenario({
  name: 'chat-history-pages',
  description: 'Reload a long conversation and load its earlier messages through the timeline.',
  fixture: new URL('../fixtures/native-codex.mjs', import.meta.url),
  async drive(page, { step }) {
    await selectors.chatMessage(page).fill('Create the history page fixture.')
    await selectors.chatSend(page).click()
    await selectors
      .chatMessages(page)
      .getByText('HISTORY_ROW_229', { exact: true })
      .waitFor({ timeout: 30_000 })
    await page.reload()
    const messages = selectors.chatMessages(page)
    await messages.waitFor()
    await messages.focus()
    await page.keyboard.press('Control+Home')
    const earlier = page.getByRole('button', { name: 'Load earlier', exact: true })
    await earlier.waitFor()
    await step('history-window-before-page')
    await earlier.click()
    await earlier.waitFor({ state: 'hidden' })
    await page
      .getByRole('button', { name: 'Loading earlier', exact: true })
      .waitFor({ state: 'hidden' })
    await messages.focus()
    await page.keyboard.press('Control+Home')
    await messages.getByText('Create the history page fixture.', { exact: true }).waitFor()
    await step('earliest-message-loaded')
    await messages.focus()
    await page.keyboard.press('Control+End')
    await messages.getByText('HISTORY_ROW_229', { exact: true }).waitFor()
    await step('latest-message-preserved')
  },
})
