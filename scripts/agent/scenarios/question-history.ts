import { deepStrictEqual, ok } from 'node:assert/strict'
import { selectors } from '../selectors'
import { isolatedNativeScenario, nativeLog, sendPrompt } from './native-provider-verification'

const PROMPT = 'Which language should the fixture use?'

/** Plan 126 INTERACTION-04: a blocking question's answer, with its file, stays in the work log. */
export const questionHistory = isolatedNativeScenario({
  name: 'question-history',
  description:
    'A fixture Codex asks a blocking question; the answer is picked with a digit and sent with a file. The provider gets the answer, and the work log keeps the question, the answer and the file.',
  fixture: new URL('../fixtures/native-codex.mjs', import.meta.url),
  async drive(page, { root, step }) {
    await sendPrompt(page, 'Ask the blocking question.')
    const question = selectors.asyncQuestion(page, PROMPT)
    await question.waitFor({ timeout: 30_000 })
    await selectors.questionFileInput(page, PROMPT).setInputFiles({
      name: 'answer-notes.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('Why Rust.\n'),
    })
    await selectors.questionAttachment(page, 'answer-notes.txt').waitFor()
    await selectors.questionPrompt(page, PROMPT).click()
    await page.keyboard.press('1')
    await step('blocking-question-answered')
    await selectors.asyncQuestionAction(page, PROMPT, 'Submit').click()

    const messages = selectors.chatMessages(page)
    await messages
      .getByText('QUESTION_HISTORY_VERIFIED', { exact: true })
      .waitFor({ timeout: 30_000 })
    const responses = (await nativeLog(root)).filter(
      (entry) => entry.event === 'user-input-response',
    )
    const answer = JSON.stringify(responses.map((entry) => entry.result))
    ok(answer.startsWith('[{"answers":{"language":{"answers":["Rust'), 'The provider gets Rust')
    ok(answer.includes('Attached file \\"answer-notes.txt\\"'), 'The file rides with the answer')
    deepStrictEqual(responses.length, 1)

    const submitted = messages.getByText('Question answer submitted', { exact: true }).first()
    if (!(await submitted.isVisible()))
      await messages
        .getByText(/^Worked for /)
        .first()
        .click()
    await submitted.click()
    const history = messages.locator('[data-question-answer-history]').first()
    await history.getByText(PROMPT, { exact: true }).waitFor()
    await history.getByText('Rust', { exact: true }).waitFor()
    ok((await history.getByText('answer-notes.txt').count()) > 0, 'The history names the file')
    await step('answer-history')
  },
})
