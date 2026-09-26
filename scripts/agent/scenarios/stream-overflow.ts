import { equal } from 'node:assert/strict'
import { selectors } from '../selectors'
import { readSessionDetail } from './chat-verification'
import { isolatedNativeScenario, sendPrompt } from './native-provider-verification'

const PARAGRAPHS = 2500
const EXPECTED = Array.from(
  { length: PARAGRAPHS },
  (_, index) => `Overflow paragraph ${index + 1}.\n\n`,
).join('')

/** A burst past the live-delivery budget resumes from the last applied event; no text is lost or doubled. */
export const streamOverflow = isolatedNativeScenario({
  name: 'stream-overflow',
  description:
    'A native answer arrives as 2,500 paragraph deltas at once, more live events than one subscription holds; the transcript ends with the exact text, once, and the last paragraph is on screen.',
  fixture: new URL('../fixtures/native-codex.mjs', import.meta.url),
  async drive(page, { step, orchestration, sessionId }) {
    await sendPrompt(page, 'Write the long answer.')
    await selectors
      .chatMessages(page)
      .getByText(`Overflow paragraph ${PARAGRAPHS}.`, { exact: true })
      .waitFor({ timeout: 60_000 })
    await step('last-paragraph-shown')
    const detail = await readSessionDetail(page, orchestration, sessionId)
    const answers = detail.messages.filter((message) => message.role === 'assistant')
    equal(answers.length, 1, 'One assistant message')
    equal(answers[0]?.text, EXPECTED, 'The exact text, with nothing missing or doubled')
    await page.reload()
    await selectors
      .chatMessages(page)
      .getByText(`Overflow paragraph ${PARAGRAPHS}.`, { exact: true })
      .waitFor({ timeout: 60_000 })
    await step('same-text-after-reload')
  },
})
