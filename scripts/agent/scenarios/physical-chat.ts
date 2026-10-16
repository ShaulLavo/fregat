import { ok, strictEqual } from 'node:assert/strict'
import type { Page } from 'playwright'
import { feedbackSoundCount, installFeedbackProbe } from '../feedback-probe'
import { selectors } from '../selectors'
import { dispatch } from './chat-verification'
import { isolatedNativeScenario, writeSettings } from './native-provider-verification'

export const physicalChat = isolatedNativeScenario({
  name: 'physical-chat',
  description:
    'Verify streamed arrivals, silent scrolling and committed pointer chat selection with physical feel.',
  fixture: new URL('../fixtures/native-codex.mjs', import.meta.url),
  async drive(page, { step, orchestration, sessionId, providerInstanceId, worktreeId }) {
    const base = orchestration.replace(/\/orchestration$/, '')
    const feel = process.env.PHYSICAL_BASELINE === '1' ? 'flat' : 'playful'
    await writeSettings(page, base, [
      { kind: 'set', key: 'workbench.feel', value: feel },
      { kind: 'set', key: 'workbench.sounds.controls', value: true },
    ])
    await page.waitForFunction((value) => document.documentElement.dataset.feel === value, feel)
    await selectors
      .chatMessage(page)
      .fill(
        'Verify buffered response and full reasoning retention.\n' +
          'A line in the long user message.\n'.repeat(100),
      )
    await selectors.chatSend(page).click()
    await selectors.chatExactText(page, 'RESPONSE_DELIVERY_VERIFIED').waitFor({ timeout: 30_000 })
    await page.waitForTimeout(1200)
    await step('stream-complete')
    const messages = selectors.chatMessages(page)
    const counts = await messages.evaluate(async (element) => {
      let entrances = 0
      const observer = new MutationObserver((records) => {
        entrances += records.filter(
          (record) =>
            record.target instanceof HTMLElement && record.target.hasAttribute('data-entering'),
        ).length
      })
      observer.observe(element, {
        subtree: true,
        attributes: true,
        attributeFilter: ['data-entering'],
      })
      for (const position of [0, element.scrollHeight, 0, element.scrollHeight]) {
        element.scrollTop = position
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      observer.disconnect()
      return entrances
    })
    strictEqual(counts, 0, 'Virtualized scroll must never replay an entrance')
    await step('scroll-without-entrances')
    await installFeedbackProbe(page)
    const otherId = crypto.randomUUID()
    const titles = ['Feedback chat first', 'Feedback chat second']
    try {
      await dispatch(page, orchestration, {
        type: 'session.meta.update',
        sessionId,
        title: titles[0],
      })
      await dispatch(page, orchestration, {
        type: 'session.create',
        sessionId: otherId,
        title: titles[1],
        modelSelection: { providerInstanceId, model: 'gpt-5.5' },
        worktreeTarget: { kind: 'current', worktreeId },
      })
      await selectors.sessionSearch(page).fill('Feedback chat')
      const first = selectors.sessionByTitle(page, titles[0]!)
      const second = selectors.sessionByTitle(page, titles[1]!)
      const before = await feedbackSoundCount(page)
      await first.click()
      await page.waitForTimeout(100)
      strictEqual(await feedbackSoundCount(page), before, 'Current chat stays silent')
      await second.hover()
      await page.mouse.down()
      strictEqual(await feedbackSoundCount(page), before, 'Pointer-down stays silent')
      await page.mouse.up()
      await page.waitForURL((url) => url.href.includes(otherId))
      await waitForSoundCount(page, before + 1)
      await step('different-chat-clicks-after-selection')
      await first.click({ modifiers: ['Control'] })
      await page.waitForTimeout(100)
      strictEqual(await feedbackSoundCount(page), before + 1, 'Multiple selection stays silent')
      await selectors.sessionRail(page).focus()
      await page.keyboard.press('End')
      await page.waitForURL((url) => url.href.includes(sessionId))
      await page.waitForTimeout(100)
      strictEqual(await feedbackSoundCount(page), before + 1, 'Keyboard selection stays silent')
      await step('keyboard-and-multiple-selection-stay-silent')
      const dragBefore = await feedbackSoundCount(page)
      const dragBox = await second.boundingBox()
      ok(dragBox, 'The draggable chat row is visible')
      await second.hover()
      await page.mouse.down()
      await page.mouse.move(dragBox.x + dragBox.width / 2, dragBox.y + dragBox.height / 2 + 20, {
        steps: 5,
      })
      await selectors.sessionDraggingRow(page).waitFor()
      strictEqual(await feedbackSoundCount(page), dragBefore, 'Dragging a chat stays silent')
      await page.keyboard.press('Escape')
      await page.mouse.up()
      await step('dragging-stays-silent')
      await selectors.workspaceMode(page, 'Workbench').click()
      await selectors.sidebarTab(page, 'Chat').click()
      await selectors.conversationHistory(page).click()
      await selectors.conversationChoice(page, titles[0]!).click()
      await page.waitForTimeout(100)
      await selectors.conversationHistory(page).click()
      const historyBefore = await feedbackSoundCount(page)
      await selectors.conversationChoice(page, titles[1]!).click()
      await selectors.conversationTitle(page, titles[1]!).waitFor()
      await waitForSoundCount(page, historyBefore + 1)
      await selectors.conversationHistory(page).click()
      const repeatedBefore = await feedbackSoundCount(page)
      await selectors.conversationChoice(page, titles[1]!).click()
      await page.waitForTimeout(100)
      strictEqual(
        await feedbackSoundCount(page),
        repeatedBefore,
        'Current sidebar conversation stays silent',
      )
      await step('sidebar-history-committed-feedback')
    } finally {
      await dispatch(page, orchestration, { type: 'session.delete', sessionId: otherId })
    }
  },
})

function waitForSoundCount(page: Page, expected: number) {
  return page.waitForFunction(
    (count) => Number(Reflect.get(window, 'physicalSoundCount') ?? 0) === count,
    expected,
  )
}
