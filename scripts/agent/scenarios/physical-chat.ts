import { ok, strictEqual } from 'node:assert/strict'
import type { Page } from 'playwright'
import { feedbackSoundCount, installFeedbackProbe } from '../feedback-probe'
import { selectors } from '../selectors'
import { cleanupAll } from '../scenario-cleanup'
import { dispatch } from './chat-verification'
import { isolatedNativeScenario, writeSettings } from './native-provider-verification'

export const physicalChat = isolatedNativeScenario({
  name: 'physical-chat',
  description:
    'Verify pointer feedback for chats, drafts and phone navigation while scrolling, keyboard actions and dragging stay silent.',
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
    await installFeedbackProbe(page)
    const scrollBefore = await feedbackSoundCount(page)
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
    strictEqual(await feedbackSoundCount(page), scrollBefore, 'Transcript scrolling stays silent')
    await step('scroll-without-entrances')
    const otherId = crypto.randomUUID()
    const titles = ['Feedback chat first', 'Feedback chat second']
    const draftTitle = 'Feedback chat saved draft'
    const originalViewport = page.viewportSize()
    let otherCreated = false
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
      otherCreated = true
      await selectors.sessionSearch(page).fill('Feedback chat')
      const first = selectors.sessionByTitle(page, titles[0]!)
      const second = selectors.sessionByTitle(page, titles[1]!)
      await expectPointerTick(page, () => first.click(), 'Current chat acknowledges another click')
      const before = await feedbackSoundCount(page)
      await second.hover()
      await page.waitForTimeout(100)
      strictEqual(await feedbackSoundCount(page), before, 'Hover stays silent')
      await page.mouse.down()
      strictEqual(await feedbackSoundCount(page), before, 'Pointer-down stays silent')
      await page.mouse.up()
      await page.waitForURL((url) => url.href.includes(otherId))
      await waitForSoundCount(page, before + 1)
      await step('current-and-different-chat-click-feedback')
      await expectPointerTick(
        page,
        () => first.click({ modifiers: ['ControlOrMeta'] }),
        'Pointer multiple selection acknowledges its click',
      )
      ok(page.url().includes(otherId), 'Multiple selection keeps the conversation open')
      const keyboardBefore = await feedbackSoundCount(page)
      await selectors.sessionRail(page).focus()
      await page.keyboard.press('End')
      await page.waitForURL((url) => url.href.includes(sessionId))
      await page.waitForTimeout(100)
      strictEqual(await feedbackSoundCount(page), keyboardBefore, 'Keyboard selection stays silent')
      await step('pointer-multiple-selection-and-silent-keyboard')
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
      await page.waitForTimeout(100)
      strictEqual(await feedbackSoundCount(page), dragBefore, 'Cancelling a drag stays silent')
      await step('dragging-stays-silent')

      const sessionAddress = page.url()
      const sessionComposer = await selectors.chatMessage(page).elementHandle()
      await selectors.chatNewSession(page).click()
      await page.waitForURL((url) => url.href !== sessionAddress)
      await sessionComposer?.waitForElementState('hidden')
      await selectors.chatMessage(page).fill(draftTitle)
      const draftAddress = page.url()
      await expectPointerTick(
        page,
        () => second.click(),
        'Leaving a draft acknowledges the chat click',
      )
      await page.waitForURL((url) => url.href.includes(otherId))
      const draft = selectors.recoverableDraft(page, draftTitle)
      await expectPointerTick(
        page,
        () => draft.click(),
        'Saved drafts acknowledge pointer recovery',
      )
      await page.waitForURL(draftAddress)
      strictEqual(await selectors.chatMessage(page).textContent(), draftTitle)
      await expectPointerTick(
        page,
        () => draft.click(),
        'The current draft acknowledges another click',
      )
      await expectPointerTick(
        page,
        () => second.click(),
        'A chat row acknowledges leaving the draft',
      )
      await page.waitForURL((url) => url.href.includes(otherId))
      const draftKeyboardBefore = await feedbackSoundCount(page)
      await selectors.recoverableDraftList(page).focus()
      await page.keyboard.press('Enter')
      await page.waitForURL(draftAddress)
      await page.waitForTimeout(100)
      strictEqual(
        await feedbackSoundCount(page),
        draftKeyboardBefore,
        'Keyboard draft recovery stays silent',
      )
      await step('saved-draft-pointer-and-keyboard-feedback')
      await second.click()
      await page.waitForURL((url) => url.href.includes(otherId))
      await selectors.discardDraft(page, draftTitle).click()
      await draft.waitFor({ state: 'hidden' })

      await selectors.workspaceMode(page, 'Workbench').click()
      await selectors.sidebarTab(page, 'Chat').click()
      await selectors.conversationHistory(page).click()
      await expectPointerTick(
        page,
        () => selectors.conversationChoice(page, titles[0]!).click(),
        'Sidebar conversation choices acknowledge pointer selection',
      )
      await selectors.conversationTitle(page, titles[0]!).waitFor()
      await selectors.conversationHistory(page).click()
      await expectPointerTick(
        page,
        () => selectors.conversationChoice(page, titles[1]!).click(),
        'A different sidebar conversation acknowledges pointer selection',
      )
      await selectors.conversationTitle(page, titles[1]!).waitFor()
      await selectors.conversationHistory(page).click()
      await expectPointerTick(
        page,
        () => selectors.conversationChoice(page, titles[1]!).click(),
        'The current sidebar conversation acknowledges another click',
      )
      await step('sidebar-history-pointer-feedback')

      await selectors.workspaceMode(page, 'Chat').click()
      await first.click()
      await page.waitForURL((url) => url.href.includes(sessionId))
      await page.setViewportSize({ width: 390, height: 844 })
      await selectors.phoneLevel(page, 'session').waitFor()
      await selectors.phoneBack(page).click()
      await selectors.phoneLevel(page, 'sessions').waitFor()
      const newestTitle = await selectors.sessionRows(page).first().getAttribute('title')
      ok(
        newestTitle && titles.includes(newestTitle),
        'The newest phone row is one of the fixture chats',
      )
      const newestId = newestTitle === titles[0] ? sessionId : otherId
      const olderTitle = newestTitle === titles[0] ? titles[1]! : titles[0]!
      const olderId = newestId === sessionId ? otherId : sessionId
      await expectPointerTick(
        page,
        () => selectors.sessionByTitle(page, newestTitle).click(),
        'The newest chat acknowledges opening from phone Sessions',
      )
      await page.waitForURL((url) => url.href.includes(newestId))
      await selectors.phoneLevel(page, 'session').waitFor()
      await step('phone-sessions-opens-newest-chat')
      await selectors.phoneBack(page).click()
      await selectors.phoneLevel(page, 'sessions').waitFor()
      await expectPointerTick(
        page,
        () => selectors.sessionByTitle(page, olderTitle).click(),
        'An older chat acknowledges opening from phone Sessions',
      )
      await page.waitForURL((url) => url.href.includes(olderId))
      await selectors.phoneLevel(page, 'session').waitFor()
      await step('phone-sessions-opens-older-chat')
      await selectors.phoneBack(page).click()
      await selectors.phoneLevel(page, 'sessions').waitFor()
      await expectPointerTick(
        page,
        () => selectors.sessionByTitle(page, newestTitle).click(),
        'The newest chat acknowledges reopening after returning to Sessions',
      )
      await page.waitForURL((url) => url.href.includes(newestId))
      await selectors.phoneLevel(page, 'session').waitFor()
      await step('phone-back-and-reopen-newest-chat')
    } finally {
      await cleanupAll([
        async () => {
          if (originalViewport) await page.setViewportSize(originalViewport)
        },
        async () => {
          await selectors.windowToolbar(page).waitFor()
          await selectors.workspaceMode(page, 'Chat').click()
          const remove = selectors.discardDraft(page, draftTitle)
          if (await remove.isVisible()) await remove.click()
        },
        async () => {
          if (otherCreated)
            await dispatch(page, orchestration, { type: 'session.delete', sessionId: otherId })
        },
      ])
    }
  },
})

function waitForSoundCount(page: Page, expected: number) {
  return page.waitForFunction(
    (count) => Number(Reflect.get(window, 'physicalSoundCount') ?? 0) === count,
    expected,
  )
}

async function expectPointerTick(page: Page, action: () => Promise<unknown>, message: string) {
  await page.waitForTimeout(60)
  const before = await feedbackSoundCount(page)
  await action()
  await waitForSoundCount(page, before + 1)
  await page.waitForTimeout(100)
  strictEqual(await feedbackSoundCount(page), before + 1, message)
}
