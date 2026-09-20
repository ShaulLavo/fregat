import { deepStrictEqual, ok } from 'node:assert/strict'
import { appendFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { selectors } from '../selectors'
import { isolatedNativeScenario, nativeLog } from './native-provider-verification'

export const asyncQuestions = isolatedNativeScenario({
  name: 'async-questions',
  description:
    'Answer optional native questions while running and idle, reload and dismiss, and verify native turn messages.',
  fixture: new URL('../fixtures/native-codex.mjs', import.meta.url),
  async drive(page, { step, root, orchestration, sessionId }) {
    await selectors.chatMessage(page).fill('Ask isolated optional questions.')
    await selectors.chatSend(page).click()
    await selectors
      .asyncQuestion(page, 'Verification running question')
      .waitFor({ timeout: 30_000 })
    await step('native-async-questions')
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4gAAAABJRU5ErkJggg==',
      'base64',
    )
    await selectors.questionFileInput(page, 'Verification running question').setInputFiles([
      {
        name: 'verification.png',
        mimeType: 'image/png',
        buffer: png,
      },
      {
        name: 'question.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('Question attachment verification.\n'),
      },
    ])
    await selectors.questionAttachment(page, 'verification.png').waitFor()
    await selectors.questionAttachment(page, 'question.txt').waitFor()
    await selectors.questionPrompt(page, 'Verification running question').click()
    await page.keyboard.press('1')
    await selectors.asyncQuestionAction(page, 'Verification running question', 'Submit').click()
    try {
      await selectors
        .chatMessages(page)
        .getByText('ASYNC_STEER_VERIFIED', { exact: true })
        .waitFor()
    } catch (error) {
      const detail = await page.request.get(`${orchestration}/session-detail`, {
        params: { sessionId },
        headers: { Origin: new URL(page.url()).origin },
      })
      await appendFile(
        join(root, 'native.jsonl'),
        `${JSON.stringify({ event: 'failed-steer-detail', detail: await detail.json() })}\n`,
      )
      await step('steer-result-missing')
      throw error
    }
    await selectors.asyncQuestionAction(page, 'Verification idle question', 'Go').click()
    await selectors.asyncQuestionAction(page, 'Verification idle question', 'Submit').click()
    await selectors.chatMessages(page).getByText('ASYNC_START_VERIFIED', { exact: true }).waitFor()
    await page.reload()
    await selectors
      .asyncQuestionAction(page, 'Verification dismiss question', 'Dismiss')
      .click({ trial: true })
    await step('pending-question-after-reload')
    const second = await page.context().newPage()
    try {
      await second.goto(page.url())
      await selectors
        .asyncQuestion(second, 'Verification dismiss question')
        .waitFor({ timeout: 30_000 })
      await selectors.asyncQuestionAction(page, 'Verification dismiss question', 'Dismiss').click()
      await selectors
        .asyncQuestion(second, 'Verification dismiss question')
        .waitFor({ state: 'hidden' })
    } finally {
      await second.close()
    }
    await selectors
      .asyncQuestion(page, 'Verification dismiss question')
      .waitFor({ state: 'hidden' })
    await page.reload()
    await selectors.chatMessage(page).waitFor()
    await selectors
      .asyncQuestion(page, 'Verification dismiss question')
      .waitFor({ state: 'hidden' })
    const native = (await nativeLog(root)).filter((entry) =>
      ['turn/start', 'turn/steer'].includes(entry.event),
    )
    deepStrictEqual(
      native.map((entry) => entry.event),
      ['turn/start', 'turn/steer', 'turn/start'],
    )
    deepStrictEqual(
      native
        .slice(1)
        .map((entry) =>
          Array.isArray(entry.input)
            ? entry.input.filter(
                (item) => item.type === 'text' && !String(item.text).startsWith('Attached file '),
              )
            : entry.input,
        ),
      [
        [
          {
            type: 'text',
            text: 'Verification running question\nRust',
            text_elements: [],
          },
        ],
        [
          {
            type: 'text',
            text: 'Verification idle question\nGo',
            text_elements: [],
          },
        ],
      ],
    )
    ok(
      Array.isArray(native[1]?.input) && native[1].input.some((item) => item.type === 'localImage'),
      'Image reaches native steer with its question answer',
    )
    const fileReference = Array.isArray(native[1]?.input)
      ? native[1].input.find(
          (item) =>
            item.type === 'text' && String(item.text).startsWith('Attached file "question.txt": '),
        )
      : undefined
    ok(fileReference, 'File reaches native steer with its question answer')
    const filePath = JSON.parse(
      String(fileReference.text).slice('Attached file "question.txt": '.length),
    )
    deepStrictEqual(await readFile(filePath, 'utf8'), 'Question attachment verification.\n')
    await step('answers-and-dismissal-complete')
  },
})
