import { strictEqual } from 'node:assert/strict'
import type { Page } from 'playwright'
import { createSpeechRecognitionFixture } from '../../../apps/web/test/factories/speech-recognition'
import { selectors } from '../selectors'
import { readCaches } from '../cache-snapshot'
import { isolatedNativeScenario, withUserSetting } from './native-provider-verification'

export const chatDictation = isolatedNativeScenario({
  name: 'chat-dictation',
  description:
    'T3-style dictation replaces selected text, freezes sending and editing, discards cancelled speech, reports microphone failures, scrolls the visible caret to every newest live word across growing text, right-to-left text and phone resizing, and finishes at the configured limit. The external browser speech API is a fixture; actual microphone transcription is a manual check.',
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
    const recordingCaches = await page.evaluate(readCaches)
    const voiceCapture = recordingCaches
      .find((cache) => cache.scope === 'resources')
      ?.mutations.find((mutation) => mutation.key.startsWith('["chat","voice"'))
    strictEqual(voiceCapture?.status, 'pending')
    strictEqual(voiceCapture?.scope, 'chat-voice-input')
    await step('recording-selected-text')
    const longPreview =
      'This is a longer sentence that keeps growing as I speak and should keep the newest words visible. '.repeat(
        8,
      )
    await page.evaluate(
      (text) => window.speechRecognitionFixture?.current?.result(text, false),
      `${longPreview}lighthouse`,
    )
    await selectors.dictationPreview(page).getByText('lighthouse', { exact: false }).waitFor()
    await step('long-live-preview')
    await assertVisibleTail(page, 'lighthouse')
    await selectors.dictationPreview(page).evaluate((element) => {
      element.scrollLeft = 0
    })
    let spokenPreview = `${longPreview}lighthouse`
    for (const word of ['beside', 'the', 'shore']) {
      spokenPreview += ` ${word}`
      await page.evaluate(
        (text) => window.speechRecognitionFixture?.current?.result(text, false),
        spokenPreview,
      )
      await assertVisibleTail(page, word)
    }
    await step('live-preview-follows-end')
    await page.evaluate(
      (text) => window.speechRecognitionFixture?.current?.result(text, false),
      `${'זה משפט ארוך שממשיך להתעדכן בזמן הדיבור '.repeat(12)}סיום`,
    )
    await assertVisibleTail(page, 'סיום')
    await step('live-preview-right-to-left')
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
    await selectors.phoneLevel(page, 'session').waitFor()
    await selectors.dictationStart(page).waitFor()
    const mic = await selectors.dictationStart(page).boundingBox()
    strictEqual(mic !== null && mic.x >= 0 && mic.x + mic.width <= 390, true)
    await step('phone-composer')
    await selectors.dictationStart(page).click()
    await page.evaluate(
      (text) => window.speechRecognitionFixture?.current?.result(text, false),
      `${longPreview}lighthouse`,
    )
    await assertVisibleTail(page, 'lighthouse')
    await step('phone-live-preview-follows-end')
    await page.setViewportSize({ width: 320, height: 844 })
    await assertVisibleTail(page, 'lighthouse')
    await step('phone-narrow-live-preview-follows-end')
    await selectors.dictationCancel(page).click()
    await selectors.dictationStart(page).waitFor()
    await page.setViewportSize({ width: 1440, height: 900 })
    return { recordingCaches, completedCaches: await page.evaluate(readCaches) }
  },
})

async function assertVisibleTail(page: Page, word: string) {
  await page.waitForFunction(({ element, lastWord }) => element?.textContent?.endsWith(lastWord), {
    element: await selectors.dictationPreview(page).elementHandle(),
    lastWord: word,
  })
  await page.waitForFunction(
    (element) => {
      if (!element) return false
      const distance = element.scrollWidth - element.clientWidth
      return Math.abs(element.scrollLeft) >= distance - 1
    },
    await selectors.dictationPreview(page).elementHandle(),
  )
  const geometry = await selectors.dictationPreview(page).evaluate((element, lastWord) => {
    const text = document.createTreeWalker(element, NodeFilter.SHOW_TEXT).nextNode()
    if (!(text instanceof Text)) return { visible: false, reason: 'missing text' }
    const end = text.length
    const range = document.createRange()
    range.setStart(text, end - lastWord.length)
    range.setEnd(text, end)
    const tail = range.getBoundingClientRect()
    const caret = element.querySelector('[data-dictation-caret]')?.getBoundingClientRect()
    const scrollRange = element.scrollWidth - element.clientWidth
    const rtl = getComputedStyle(element).direction === 'rtl'
    const viewport = element.getBoundingClientRect()
    return {
      visible:
        caret !== undefined &&
        caret.left >= viewport.left - 1 &&
        caret.right <= viewport.right + 1 &&
        (rtl ? caret.right <= tail.left + 1 : caret.left >= tail.right - 1) &&
        scrollRange > 0 &&
        Math.abs(element.scrollLeft) >= scrollRange - 1 &&
        text.data.endsWith(lastWord) &&
        tail.width > 0 &&
        tail.left >= viewport.left - 1 &&
        tail.right <= viewport.right + 1,
      scrollLeft: element.scrollLeft,
      scrollRange,
      caretLeft: caret?.left,
      caretRight: caret?.right,
      tailLeft: tail.left,
      tailRight: tail.right,
      viewportLeft: viewport.left,
      viewportRight: viewport.right,
    }
  }, word)
  strictEqual(geometry.visible, true, JSON.stringify(geometry))
}
