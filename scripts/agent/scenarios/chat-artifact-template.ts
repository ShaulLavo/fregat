import { strictEqual } from 'node:assert/strict'
import { selectors } from '../selectors'
import { isolatedNativeScenario, sendPrompt } from './native-provider-verification'

const PROMPT = 'Create a document using this $artifact-template-weekly-report about…'

/** Plan 126 INTERACTION-10: an artifact-template directive renders as a card whose Use adds its prompt once. */
export const chatArtifactTemplate = isolatedNativeScenario({
  name: 'chat-artifact-template',
  description:
    'An answer carrying an artifact-template directive renders a card between its paragraphs; Use appends the template prompt to the composer once, however often it is clicked.',
  fixture: new URL('../fixtures/native-codex.mjs', import.meta.url),
  async drive(page, { step }) {
    await sendPrompt(page, 'Save a template.')
    const messages = selectors.chatMessages(page)
    const card = messages.locator('[data-artifact-kind="document"]')
    await card.waitFor({ timeout: 30_000 })
    await messages.getByText('Use it any time.', { exact: true }).waitFor()
    strictEqual(await messages.getByText('::artifact-template', { exact: false }).count(), 0)
    await step('template-card')

    await selectors.chatMessage(page).fill('Please:')
    await card.getByRole('button', { name: 'Use', exact: true }).click()
    await card.getByRole('button', { name: 'Use', exact: true }).click()
    await page.waitForTimeout(300)
    strictEqual((await selectors.chatMessage(page).innerText()).trim(), `Please: ${PROMPT}`)
    await step('prompt-appended-once')
    await selectors.chatMessage(page).fill('')
  },
})
