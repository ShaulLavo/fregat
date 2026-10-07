import { strictEqual } from 'node:assert/strict'
import { createSpeechRecognitionFixture } from '../../../apps/web/test/factories/speech-recognition'
import { selectors } from '../selectors'
import { isolatedNativeScenario, withUserSetting } from './native-provider-verification'

export const chatDictation = isolatedNativeScenario({
  name: 'chat-dictation',
  description:
    'T3-style dictation replaces selected text, freezes sending and editing, discards cancelled speech, reports microphone failures and finishes at the configured limit. The external browser speech API is a fixture; actual microphone transcription is a manual check.',
  fixture: new URL('../fixtures/native-codex.mjs', import.meta.url),
  async drive(page, { step, orchestration }) {
    await page.addInitScript({
      content: `window.speechRecognitionFixture = (${createSpeechRecognitionFixture.toString()})(); window.SpeechRecognition = window.speechRecognitionFixture;`,
    })
    await page.reload()
    const composer = selectors.chatMessage(page)
    await composer.waitFor()
    await composer.fill('Hello world')
    await page.keyboard.press('End')
    await page.keyboard.press('ControlOrMeta+Shift+ArrowLeft')
    await selectors.dictationStart(page).click()
    await page.waitForFunction(
      (input) => input?.getAttribute('contenteditable') === 'false',
      await composer.elementHandle(),
    )
    strictEqual(await composer.getAttribute('contenteditable'), 'false')
    strictEqual(await selectors.chatSend(page).isDisabled(), true)
    await page.evaluate(() => window.speechRecognitionFixture?.current?.result('friend', false))
    await selectors.dictationStatus(page).getByText('friend', { exact: true }).waitFor()
    await step('recording-selected-text')
    await page.evaluate(() => window.speechRecognitionFixture?.current?.result('friend'))
    await selectors.dictationFinish(page).click()
    await selectors.dictationStart(page).waitFor()
    strictEqual(await composer.innerText(), 'Hello friend')
    await page.waitForFunction(
      (input) => input?.getAttribute('contenteditable') === 'true',
      await composer.elementHandle(),
    )
    strictEqual(await composer.getAttribute('contenteditable'), 'true')
    strictEqual(
      await selectors.chatMessages(page).getByText('Hello friend', { exact: true }).count(),
      0,
    )
    await step('transcript-in-draft')

    await selectors.dictationStart(page).click()
    await page.evaluate(() => window.speechRecognitionFixture?.current?.result('discard this'))
    await selectors.dictationCancel(page).click()
    await selectors.dictationStart(page).waitFor()
    strictEqual(await composer.innerText(), 'Hello friend')
    strictEqual(await page.evaluate(() => window.speechRecognitionFixture?.current?.aborted), true)
    await step('cancel-preserves-draft')

    await page.evaluate(() => {
      if (window.speechRecognitionFixture) window.speechRecognitionFixture.failure = 'not-allowed'
    })
    await selectors.dictationStart(page).click()
    await page.getByText('Speech recognition stopped.', { exact: true }).waitFor()
    strictEqual(await composer.innerText(), 'Hello friend')
    await step('microphone-error')
    await page.evaluate(() => {
      if (window.speechRecognitionFixture) window.speechRecognitionFixture.failure = null
    })

    await withUserSetting(
      page,
      orchestration,
      { key: 'chat.dictationLimitSeconds', value: 10 },
      async () => {
        await composer.click()
        await page.keyboard.press('End')
        await selectors.dictationStart(page).click()
        await page.evaluate(() => window.speechRecognitionFixture?.current?.result('again'))
        await selectors.dictationStart(page).waitFor({ timeout: 15_000 })
        strictEqual(await composer.innerText(), 'Hello friend again')
        await step('time-limit-finishes')
      },
    )
    await page.setViewportSize({ width: 390, height: 844 })
    await step('phone-composer')
    await page.setViewportSize({ width: 1440, height: 900 })
  },
})
